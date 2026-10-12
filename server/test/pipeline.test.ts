import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { IntakeResult } from "@caseflow/shared";
import { AgentError } from "../src/agents/claude";
import { VacmsHouseholdExtract } from "../src/integrations/vacms";
import { VecWageMatchFile } from "../src/integrations/vec";
import { CaseError, CaseService, type IntakeFn } from "../src/pipeline/case-service";
import { EventStore } from "../src/store/event-store";
import { fakeIntake } from "../fixtures/fake-intake";
import { DOCUMENTS } from "../fixtures/paystubs";

const NOW = new Date("2026-10-12T14:00:00Z");
const BPS = "bps:kibrahim";
const CASE = { gonzalez: "0130000101", carter: "0130000102", williams: "0130000103", johnson: "0130000105" } as const;

const pdf = (fileName: string) => new Uint8Array(readFileSync(new URL(`../data/documents/${fileName}`, import.meta.url)));
const docsFor = (scenarioId: string) => DOCUMENTS.filter((d) => d.scenarioId === scenarioId && d.kind === "paystub").map((d) => d.fileName);

let store: EventStore;
const makeService = (intake: IntakeFn = fakeIntake) =>
  new CaseService({ store, households: VacmsHouseholdExtract.fromFile(), wages: VecWageMatchFile.fromFile(), intake });

async function prepare(service: CaseService, scenarioId: keyof typeof CASE, files = docsFor(scenarioId)) {
  await service.syncFromVacms();
  for (const f of files) service.uploadDocument(CASE[scenarioId], BPS, f, "application/pdf", pdf(f));
  return service.runPipeline(CASE[scenarioId], "test");
}

beforeEach(() => {
  store = new EventStore(":memory:", () => NOW);
});

describe("pipeline: demo scenarios end to end", () => {
  it("Gonzalez: clean case goes to review with $568 and an ordered audit trail", async () => {
    const view = await prepare(makeService(), "gonzalez");
    expect(view.status).toBe("AWAITING_REVIEW");
    expect(view.verification?.flags).toEqual([]);
    expect(view.verification?.incomeSources).toEqual([
      expect.objectContaining({ employerName: "BLUESTONE MARKET CO", payFrequency: "semimonthly", grossPerPeriodCents: 100_000, monthlyCents: 200_000 }),
    ]);
    expect(view.determination?.determination.monthlyBenefitCents).toBe(56_800);
    expect(view.processingDeadline).toBe("2026-11-04");
    expect(view.timeline.map((e) => `${e.type}|${e.actor}`)).toEqual([
      "case.opened|system:vacms-sync",
      `document.uploaded|${BPS}`,
      `document.uploaded|${BPS}`,
      "pipeline.started|system:pipeline",
      "intake.completed|ai:intake",
      "intake.completed|ai:intake",
      "records.fetched|system:adapters",
      "verification.completed|system:verification",
      "determination.completed|system:rules-engine",
      "pipeline.completed|system:pipeline",
    ]);
  });

  it("Carter: VEC lead for an unreported employer; BPS adds the wages, engine re-determines $199 → $25", async () => {
    const service = makeService();
    const view = await prepare(service, "carter");
    expect(view.determination?.determination.monthlyBenefitCents).toBe(19_900);
    const lead = view.openActionFlags.find((f) => f.code === "UNREPORTED_EMPLOYER")!;
    expect(lead.details).toMatchObject({ employerName: "FERNWAY HOSPITALITY GROUP", quarter: "2026-Q2", estimatedMonthlyCents: 98_000 });
    expect(lead.suggestedChange?.changes).toEqual({ monthlyEarnedIncomeCents: 167_700 + 98_000 });

    // An open IEVS lead can't be silently approved.
    expect(() => service.approve(CASE.carter, BPS, null)).toThrow(/action-required/);

    const revised = service.reviseFacts(CASE.carter, BPS, lead.suggestedChange!.changes, "VEC shows Fernway wages; employer confirmed by phone 10/12.");
    expect(revised.status).toBe("AWAITING_REVIEW");
    expect(revised.openActionFlags).toEqual([]);
    expect(revised.determination?.basis).toBe("bps_revision");
    expect(revised.determination?.determination.monthlyBenefitCents).toBe(2_500);
    expect(revised.determinationHistory.map((d) => d.determination.monthlyBenefitCents)).toEqual([19_900, 2_500]);

    const approved = service.approve(CASE.carter, BPS, null);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approval?.actor).toBe(BPS);
  });

  it("Johnson: nickname on the pay stub is a soft identity flag; weekly pay × 4.3 gives $339", async () => {
    const view = await prepare(makeService(), "johnson");
    expect(view.status).toBe("AWAITING_REVIEW");
    expect(view.verification?.flags.map((f) => `${f.code}:${f.severity}`)).toEqual(["NAME_VARIANT:warning"]);
    expect(view.documents.every((d) => d.intake?.flags.some((f) => f.code === "LOW_CONFIDENCE"))).toBe(true);
    expect(view.determination?.determination.monthlyBenefitCents).toBe(33_900);
  });

  it("Williams: no documents needed; Social Security from VaCMS gives the $25 minimum", async () => {
    const view = await prepare(makeService(), "williams", []);
    expect(view.status).toBe("AWAITING_REVIEW");
    expect(view.determination?.input.monthlyUnearnedIncomeCents).toBe(180_000);
    expect(view.determination?.determination.monthlyBenefitCents).toBe(2_500);
  });

  it("ignores a non-pay-stub document instead of counting it", async () => {
    const files = [...docsFor("gonzalez"), "gonzalez-utility-bill-2026-09-22.pdf"];
    const view = await prepare(makeService(), "gonzalez", files);
    expect(view.documents).toHaveLength(3);
    expect(view.verification?.usedDocumentIds).toHaveLength(2);
    expect(view.determination?.determination.monthlyBenefitCents).toBe(56_800);
  });
});

describe("pipeline: failure rule (AI failure never blocks or decides a case)", () => {
  it("routes to manual review when intake fails, and a BPS can complete the case by entering verified income", async () => {
    let calls = 0;
    const flaky: IntakeFn = async (bytes, meta) => {
      if (calls++ === 0) throw new AgentError("The model declined to process this document.", "refusal");
      return fakeIntake(bytes, meta);
    };
    const service = makeService(flaky);
    const view = await prepare(service, "gonzalez");
    expect(view.status).toBe("MANUAL_REVIEW");
    expect(view.manualReviewReasons[0]).toMatch(/could not read it/);
    expect(view.documents.filter((d) => d.intakeError)).toHaveLength(1);
    expect(() => service.approve(CASE.gonzalez, BPS, "Looks fine to me")).toThrow(CaseError);

    const revised = service.reviseFacts(CASE.gonzalez, BPS, { monthlyEarnedIncomeCents: 200_000 }, "Read both pay stubs myself: $1,000 semimonthly.");
    expect(revised.status).toBe("AWAITING_REVIEW");
    expect(revised.determination?.determination.monthlyBenefitCents).toBe(56_800);
  });

  it("excludes a document intake marked for manual review and says why", async () => {
    const unreadable: IntakeFn = async (bytes, meta) => {
      const result = await fakeIntake(bytes, meta);
      return meta.fileName.endsWith("10-02.pdf") ? ({ ...result, needsManualReview: true, flags: [{ code: "EVIDENCE_NOT_FOUND", severity: "critical", field: "grossPayCents", message: "Quote not found" }] } satisfies IntakeResult) : result;
    };
    const view = await prepare(makeService(unreadable), "gonzalez");
    expect(view.status).toBe("MANUAL_REVIEW");
    expect(view.verification?.excludedDocumentIds).toHaveLength(1);
    expect(view.openActionFlags.map((f) => f.code)).toEqual(["DOCUMENT_NEEDS_REVIEW"]);
  });

  it("never leaves a case stuck in PROCESSING, even on an unexpected error", async () => {
    const service = new CaseService({
      store,
      households: { getHousehold: async () => { throw new Error("VaCMS connection reset"); }, listHouseholds: async () => (await VacmsHouseholdExtract.fromFile().listHouseholds()) },
      wages: VecWageMatchFile.fromFile(),
      intake: fakeIntake,
    });
    const view = await prepare(service, "williams", []);
    expect(view.status).toBe("MANUAL_REVIEW");
    expect(view.manualReviewReasons).toEqual(["Unexpected pipeline error: VaCMS connection reset"]);
  });

  it("refuses to run the same case twice at once", async () => {
    const service = makeService(async (b, m) => new Promise((resolve) => setTimeout(() => resolve(fakeIntake(b, m)), 20)));
    await service.syncFromVacms();
    service.uploadDocument(CASE.gonzalez, BPS, docsFor("gonzalez")[0]!, "application/pdf", pdf(docsFor("gonzalez")[0]!));
    const first = service.runPipeline(CASE.gonzalez, "test");
    expect(() => service.runPipeline(CASE.gonzalez, "test")).toThrow(expect.objectContaining({ code: "BUSY" }));
    await first;
  });
});

describe("BPS actions and validation", () => {
  it("requires a real reason to revise or pend, and a known actor format", async () => {
    const service = makeService();
    await prepare(service, "gonzalez");
    expect(() => service.reviseFacts(CASE.gonzalez, BPS, { countableResourcesCents: 0 }, "short")).toThrow(/at least 10/);
    expect(() => service.reviseFacts(CASE.gonzalez, BPS, {}, "A perfectly good reason")).toThrow(/At least one fact/);
    expect(() => service.pend(CASE.gonzalez, "someone", "Waiting for employer letter")).toThrow(/Invalid BPS id/);
    const pended = service.pend(CASE.gonzalez, BPS, "Waiting for employer verification letter.");
    expect(pended.status).toBe("PENDING_VERIFICATION");
  });

  it("accepts only PDFs, and stores a re-uploaded file once", async () => {
    const service = makeService();
    await service.syncFromVacms();
    expect(() => service.uploadDocument(CASE.gonzalez, BPS, "notes.txt", "text/plain", new TextEncoder().encode("hello"))).toThrow(/Only PDF/);
    const [f] = docsFor("gonzalez");
    const a = service.uploadDocument(CASE.gonzalez, BPS, f!, "application/pdf", pdf(f!));
    const b = service.uploadDocument(CASE.gonzalez, BPS, f!, "application/pdf", pdf(f!));
    expect(b.documentId).toBe(a.documentId);
    expect(service.getCase(CASE.gonzalez).documents).toHaveLength(1);
  });
});

describe("event store integrity (ADR-0005)", () => {
  it("rejects UPDATE and DELETE at the database level", async () => {
    await prepare(makeService(), "gonzalez");
    expect(() => store.rawExec("UPDATE events SET actor = 'bps:someone-else'")).toThrow(/append-only/);
    expect(() => store.rawExec("DELETE FROM events")).toThrow(/append-only/);
    expect(() => store.rawExec("DELETE FROM documents")).toThrow(/immutable/);
    expect(store.events(CASE.gonzalez)).toHaveLength(10);
  });

  it("validates events before writing them", async () => {
    await makeService().syncFromVacms();
    expect(() =>
      store.append({ caseNumber: CASE.gonzalez, type: "bps.pended", actor: BPS, payload: { reason: "too short" } }),
    ).toThrow();
    expect(store.events(CASE.gonzalez).map((e) => e.type)).toEqual(["case.opened"]);
  });
});
