import { z } from "zod";
import { FactChangesSchema, type FactChanges, type IntakeResult, type NewCaseEvent } from "@caseflow/shared";
import { toAgentError } from "../agents/claude";
import { runIntake } from "../agents/intake";
import type { HouseholdSource, WageRecordSource } from "../integrations/ports";
import { determineEligibility } from "../rules/engine";
import { selectPolicy } from "../rules/policies";
import type { EventStore } from "../store/event-store";
import { verifyIncome } from "../verification/verify";
import { effectiveInput, projectCase, type CaseDocument, type CaseView } from "./projection";

/**
 * The case pipeline (SPEC §5, ADR-0002): a fixed sequence of steps, each recorded as an event.
 *
 *   intake (AI) → records (VaCMS + VEC adapters) → verification (code) → determination (rules engine)
 *   → stop: a BPS approves, revises facts (the engine re-determines), or pends for verification.
 *
 * Failure rule: any failed step routes the case to manual review with the reason recorded.
 * Nothing in here decides eligibility except the rules engine, and nothing finalizes a case except a BPS.
 */

export type IntakeFn = (pdf: Uint8Array, meta: { fileName: string }) => Promise<IntakeResult>;

export interface CaseServiceDeps {
  store: EventStore;
  households: HouseholdSource;
  wages: WageRecordSource;
  intake?: IntakeFn;
  intakeConcurrency?: number;
}

export class CaseError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "BUSY" | "INVALID_STATE" | "VALIDATION",
  ) {
    super(message);
  }
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const BPS_ACTOR = /^bps:[a-z0-9._-]{2,40}$/;

export class CaseService {
  private readonly running = new Set<string>();
  private readonly intake: IntakeFn;

  constructor(private readonly deps: CaseServiceDeps) {
    this.intake = deps.intake ?? ((pdf) => runIntake(pdf));
  }

  /** Open a CaseFlow case for every pending application in the VaCMS extract. */
  async syncFromVacms(): Promise<number> {
    const known = new Set(this.deps.store.caseNumbers());
    let opened = 0;
    for (const household of await this.deps.households.listHouseholds()) {
      if (known.has(household.caseNumber)) continue;
      this.append({ caseNumber: household.caseNumber, type: "case.opened", actor: "system:vacms-sync", payload: { source: "VaCMS HH-EXTRACT" } });
      opened++;
    }
    return opened;
  }

  listCases(): CaseView[] {
    return this.deps.store.caseNumbers().map((n) => this.getCase(n));
  }

  getCase(caseNumber: string): CaseView {
    const events = this.deps.store.events(caseNumber);
    if (events.length === 0) throw new CaseError(`Case ${caseNumber} not found`, "NOT_FOUND");
    return projectCase(caseNumber, events);
  }

  uploadDocument(caseNumber: string, actor: string, fileName: string, mediaType: string, content: Uint8Array): CaseDocument {
    this.assertActor(actor);
    const view = this.getCase(caseNumber);
    if (this.running.has(caseNumber)) throw new CaseError("The case is being processed; upload when it finishes.", "BUSY");
    if (view.status === "APPROVED") throw new CaseError("The case is approved; documents can no longer be added.", "INVALID_STATE");
    if (mediaType !== "application/pdf" || Buffer.from(content.subarray(0, 5)).toString("latin1") !== "%PDF-") {
      throw new CaseError("Only PDF documents are accepted.", "VALIDATION");
    }
    if (content.byteLength > MAX_UPLOAD_BYTES) throw new CaseError("Documents must be 10 MB or smaller.", "VALIDATION");

    const stored = this.deps.store.putDocument(caseNumber, fileName, mediaType, content);
    const existing = view.documents.find((d) => d.documentId === stored.documentId);
    if (existing) return existing;
    this.append({
      caseNumber,
      type: "document.uploaded",
      actor,
      payload: { documentId: stored.documentId, fileName, sha256: stored.sha256, sizeBytes: stored.sizeBytes },
    });
    return this.getCase(caseNumber).documents.find((d) => d.documentId === stored.documentId)!;
  }

  async runPipeline(caseNumber: string, trigger: string): Promise<CaseView> {
    const view = this.getCase(caseNumber);
    if (view.status === "APPROVED") throw new CaseError("The case is already approved.", "INVALID_STATE");
    if (this.running.has(caseNumber)) throw new CaseError("The pipeline is already running for this case.", "BUSY");
    this.running.add(caseNumber);
    const reasons: string[] = [];

    try {
      this.append({ caseNumber, type: "pipeline.started", actor: "system:pipeline", payload: { trigger } });
      await this.runSteps(caseNumber, view, reasons);
    } catch (error) {
      reasons.push(`Unexpected pipeline error: ${(error as Error).message}`);
    } finally {
      // Always close the run, so a case can never be stuck in PROCESSING.
      this.append({
        caseNumber,
        type: "pipeline.completed",
        actor: "system:pipeline",
        payload: { outcome: reasons.length > 0 ? "manual_review" : "awaiting_review", reasons },
      });
      this.running.delete(caseNumber);
    }
    return this.getCase(caseNumber);
  }

  private async runSteps(caseNumber: string, view: CaseView, reasons: string[]): Promise<void> {
    // 1. Intake: every document without a result (including earlier failures, which are retried).
    const pending = view.documents.filter((d) => !d.intake);
    await pool(pending, this.deps.intakeConcurrency ?? 2, async (d) => {
      const stored = this.deps.store.getDocument(d.documentId)!;
      try {
        const result = await this.intake(stored.content, { fileName: d.fileName });
        this.append({ caseNumber, type: "intake.completed", actor: "ai:intake", payload: { documentId: d.documentId, result } });
      } catch (error) {
        const { reason, message } = toAgentError(error);
        this.append({ caseNumber, type: "intake.failed", actor: "ai:intake", payload: { documentId: d.documentId, reason, message } });
      }
    });

    // 2. Records from the state's systems (read-only).
    const household = await this.deps.households.getHousehold(caseNumber);
    if (!household) {
      const message = `Case ${caseNumber} was not found in the VaCMS extract.`;
      this.append({ caseNumber, type: "records.failed", actor: "system:adapters", payload: { message } });
      reasons.push(message);
      return;
    }
    const wageRecords = await this.deps.wages.getWageRecords(household.ssn);
    this.append({ caseNumber, type: "records.fetched", actor: "system:adapters", payload: { household, wageRecords } });

    // 3. Verification (deterministic).
    const current = this.getCase(caseNumber);
    for (const d of current.documents.filter((doc) => doc.intakeError)) {
      reasons.push(`${d.fileName}: the AI could not read it (${d.intakeError!.message}). Review it and enter the income manually.`);
    }
    const verification = verifyIncome({
      household,
      wageRecords,
      policy: selectPolicy(household.applicationDate),
      documents: current.documents
        .filter((doc) => doc.intake)
        .map((doc) => ({ documentId: doc.documentId, fileName: doc.fileName, intake: doc.intake! })),
    });
    this.append({ caseNumber, type: "verification.completed", actor: "system:verification", payload: verification });
    for (const id of verification.excludedDocumentIds) {
      const d = current.documents.find((doc) => doc.documentId === id)!;
      reasons.push(`${d.fileName} could not be read reliably and was not counted.`);
    }

    // 4. Determination (rules engine only).
    try {
      const determination = determineEligibility(verification.eligibilityInput);
      this.append({
        caseNumber,
        type: "determination.completed",
        actor: "system:rules-engine",
        payload: { input: verification.eligibilityInput, determination, basis: "documents" },
      });
    } catch (error) {
      const message = `The rules engine could not determine eligibility: ${(error as Error).message}`;
      this.append({ caseNumber, type: "determination.failed", actor: "system:rules-engine", payload: { message } });
      reasons.push(message);
    }
  }

  /** A BPS corrects facts (with a reason); the rules engine re-determines. The BPS never edits the benefit itself. */
  reviseFacts(caseNumber: string, actor: string, changes: FactChanges, reason: string): CaseView {
    this.assertActor(actor);
    const view = this.getCase(caseNumber);
    this.assertNotRunning(caseNumber);
    if (!view.verification) throw new CaseError("Run the pipeline before revising facts.", "INVALID_STATE");
    if (view.status === "APPROVED") throw new CaseError("The case is already approved.", "INVALID_STATE");
    const parsed = FactChangesSchema.safeParse(changes);
    if (!parsed.success) throw new CaseError(parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION");

    this.append({ caseNumber, type: "bps.revised_facts", actor, payload: { changes: parsed.data, reason } });
    const input = effectiveInput(this.getCase(caseNumber))!;
    const determination = determineEligibility(input);
    this.append({ caseNumber, type: "determination.completed", actor: "system:rules-engine", payload: { input, determination, basis: "bps_revision" } });
    return this.getCase(caseNumber);
  }

  approve(caseNumber: string, actor: string, note: string | null): CaseView {
    this.assertActor(actor);
    const view = this.getCase(caseNumber);
    this.assertNotRunning(caseNumber);
    if (view.status !== "AWAITING_REVIEW") throw new CaseError(`A case in ${view.status} cannot be approved.`, "INVALID_STATE");
    const trimmed = note?.trim() || null;
    if (view.openActionFlags.length > 0 && (!trimmed || trimmed.length < 10)) {
      throw new CaseError(
        `${view.openActionFlags.length} action-required flag(s) are open. Resolve them, or explain in a note why the case can be approved anyway.`,
        "VALIDATION",
      );
    }
    this.append({ caseNumber, type: "bps.approved", actor, payload: { note: trimmed } });
    return this.getCase(caseNumber);
  }

  pend(caseNumber: string, actor: string, reason: string): CaseView {
    this.assertActor(actor);
    const view = this.getCase(caseNumber);
    this.assertNotRunning(caseNumber);
    if (!["AWAITING_REVIEW", "MANUAL_REVIEW"].includes(view.status)) {
      throw new CaseError(`A case in ${view.status} cannot be pended.`, "INVALID_STATE");
    }
    this.append({ caseNumber, type: "bps.pended", actor, payload: { reason } });
    return this.getCase(caseNumber);
  }

  private append(event: NewCaseEvent) {
    try {
      return this.deps.store.append(event);
    } catch (error) {
      // The store validates every event; surface schema violations (e.g. a too-short reason) as a 400, not a 500.
      if (error instanceof z.ZodError) throw new CaseError(error.issues.map((i) => i.message).join("; "), "VALIDATION");
      throw error;
    }
  }

  private assertActor(actor: string) {
    if (!BPS_ACTOR.test(actor)) throw new CaseError(`Invalid BPS id "${actor}"`, "VALIDATION");
  }

  private assertNotRunning(caseNumber: string) {
    if (this.running.has(caseNumber)) throw new CaseError("The pipeline is running for this case.", "BUSY");
  }
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}
