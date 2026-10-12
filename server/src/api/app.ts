import { readdirSync, readFileSync } from "node:fs";
import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { FactChangesSchema, PROCESSING_STANDARD_DAYS, type CaseResponse, type CaseSummary, type HouseholdRecord } from "@caseflow/shared";
import type { HouseholdSource } from "../integrations/ports";
import { CaseError, type CaseService } from "../pipeline/case-service";
import type { CaseView } from "../pipeline/projection";
import { POLICIES } from "../rules/policies";
import type { EventStore } from "../store/event-store";

/**
 * HTTP API for the BPS-facing UI. Thin by design: validation and every rule live in CaseService.
 * Identity: a BPS picker in the UI sends X-CaseFlow-User (stands in for agency SSO; SPEC §9).
 */

export interface ApiDeps {
  service: CaseService;
  store: EventStore;
  households: HouseholdSource;
  now?: () => Date;
  /** Folder of synthetic sample documents the UI can attach (demo convenience). */
  samplesDir?: URL;
}

const ACTOR_HEADER = "x-caseflow-user";
const STATUS_FOR: Record<CaseError["code"], 400 | 404 | 409> = { VALIDATION: 400, NOT_FOUND: 404, BUSY: 409, INVALID_STATE: 409 };

const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);

export function createApp(deps: ApiDeps) {
  const { service, store, households } = deps;
  const now = deps.now ?? (() => new Date());
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now());
  const app = new Hono().basePath("/api");

  const actor = (c: Context) => {
    const user = c.req.header(ACTOR_HEADER);
    if (!user) throw new CaseError(`Missing ${ACTOR_HEADER} header (the signed-in BPS).`, "VALIDATION");
    return user;
  };

  const deadlineFor = (applicationDate: string) =>
    new Date(Date.parse(`${applicationDate}T00:00:00Z`) + PROCESSING_STANDARD_DAYS * 86_400_000).toISOString().slice(0, 10);

  const withDeadline = async (view: CaseView): Promise<CaseResponse> => {
    const applicant = view.household ?? (await households.getHousehold(view.caseNumber)) ?? null;
    const processingDeadline = view.processingDeadline ?? (applicant ? deadlineFor(applicant.applicationDate) : null);
    return {
      ...view,
      applicationDate: view.applicationDate ?? applicant?.applicationDate ?? null,
      processingDeadline,
      daysRemaining: processingDeadline ? daysBetween(today(), processingDeadline) : null,
      applicant,
    };
  };

  app.onError((error, c) => {
    if (error instanceof CaseError) return c.json({ error: error.message, code: error.code }, STATUS_FOR[error.code]);
    console.error(error);
    return c.json({ error: "Unexpected server error", code: "INTERNAL" }, 500);
  });

  app.get("/health", (c) =>
    c.json({ status: "ok", policies: POLICIES.map(({ version, effectiveFrom, effectiveTo }) => ({ version, effectiveFrom, effectiveTo })) }),
  );

  app.get("/policies", (c) =>
    c.json(
      POLICIES.map((p) => ({
        version: p.version,
        title: p.title,
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.effectiveTo,
        manualReference: p.stateOptions.manualReference,
        provisional: p.provisional,
        sources: p.sources,
      })),
    ),
  );

  /** The BPS work queue. Household details come from VaCMS even before a case has been processed. */
  app.get("/cases", async (c) => {
    const byCase = new Map<string, HouseholdRecord>((await households.listHouseholds()).map((h) => [h.caseNumber, h]));
    const rows = service.listCases().map((view): CaseSummary => {
      const household = view.household ?? byCase.get(view.caseNumber) ?? null;
      const deadline = household ? deadlineFor(household.applicationDate) : null;
      const flags = view.verification?.flags ?? [];
      const d = view.determination?.determination;
      return {
        caseNumber: view.caseNumber,
        applicant: household?.headOfHousehold ?? null,
        householdSize: household?.householdSize ?? null,
        applicationDate: household?.applicationDate ?? null,
        processingDeadline: deadline,
        daysRemaining: deadline ? daysBetween(today(), deadline) : null,
        status: view.status,
        documents: view.documents.length,
        flags: {
          actionRequired: view.openActionFlags.length,
          warnings: flags.filter((f) => f.severity === "warning").length + view.documents.flatMap((doc) => doc.intake?.flags ?? []).filter((f) => f.severity === "warning").length,
        },
        determination: d ? { eligible: d.eligible, monthlyBenefitCents: d.monthlyBenefitCents, eligibilityPath: d.eligibilityPath, policyVersion: d.policyVersion } : null,
        lastActivity: view.timeline.at(-1)?.createdAt ?? null,
      };
    });
    return c.json(rows);
  });

  app.get("/cases/:caseNumber", async (c) => c.json(await withDeadline(service.getCase(c.req.param("caseNumber")))));

  app.post(
    "/cases/:caseNumber/documents",
    bodyLimit({ maxSize: 10 * 1024 * 1024 + 64 * 1024, onError: (c) => c.json({ error: "Documents must be 10 MB or smaller.", code: "VALIDATION" }, 413) }),
    async (c) => {
      const user = actor(c);
      const body = await c.req.parseBody();
      const file = body["file"];
      if (!(file instanceof File)) throw new CaseError('Send the document as multipart form field "file".', "VALIDATION");
      const document = service.uploadDocument(c.req.param("caseNumber"), user, file.name, file.type, new Uint8Array(await file.arrayBuffer()));
      return c.json(document, 201);
    },
  );

  app.get("/cases/:caseNumber/documents/:documentId", (c) => {
    const doc = store.getDocument(c.req.param("documentId"));
    if (!doc || doc.caseNumber !== c.req.param("caseNumber")) throw new CaseError("Document not found", "NOT_FOUND");
    return c.body(Buffer.from(doc.content), 200, {
      "Content-Type": doc.mediaType,
      "Content-Disposition": `inline; filename="${doc.fileName.replace(/"/g, "")}"`,
    });
  });

  /** Start the pipeline; progress arrives on /api/stream. */
  app.post("/cases/:caseNumber/run", (c) => {
    const user = actor(c);
    const caseNumber = c.req.param("caseNumber");
    service.runPipeline(caseNumber, user).catch((error) => console.error(`pipeline ${caseNumber}`, error));
    return c.json({ accepted: true, caseNumber }, 202);
  });

  app.post(
    "/cases/:caseNumber/revise",
    zValidator("json", z.object({ changes: FactChangesSchema, reason: z.string() }), (result, c) => {
      if (!result.success) return c.json({ error: result.error.issues.map((i) => i.message).join("; "), code: "VALIDATION" }, 400);
    }),
    async (c) => {
      const { changes, reason } = c.req.valid("json");
      return c.json(await withDeadline(service.reviseFacts(c.req.param("caseNumber"), actor(c), changes, reason)));
    },
  );

  app.post(
    "/cases/:caseNumber/approve",
    zValidator("json", z.object({ note: z.string().nullable().optional() })),
    async (c) => {
      const caseNumber = c.req.param("caseNumber");
      const view = service.approve(caseNumber, actor(c), c.req.valid("json").note ?? null);
      service.generateNotice(caseNumber).catch((error) => console.error(`notice ${caseNumber}`, error));
      return c.json(await withDeadline(view));
    },
  );

  app.post("/cases/:caseNumber/pend", zValidator("json", z.object({ reason: z.string() })), async (c) =>
    c.json(await withDeadline(service.pend(c.req.param("caseNumber"), actor(c), c.req.valid("json").reason))),
  );

  /** Re-draft the notice (e.g. after a notice.failed). */
  app.post("/cases/:caseNumber/notice", (c) => {
    actor(c);
    const caseNumber = c.req.param("caseNumber");
    service.generateNotice(caseNumber).catch((error) => console.error(`notice ${caseNumber}`, error));
    return c.json({ accepted: true, caseNumber }, 202);
  });

  /** Live event feed for the UI: one SSE message per appended event (metadata only; the UI refetches the case). */
  app.get("/stream", (c) =>
    streamSSE(c, async (stream) => {
      const only = c.req.query("case");
      const unsubscribe = store.subscribe((e) => {
        if (only && e.caseNumber !== only) return;
        void stream.writeSSE({
          id: String(e.id),
          event: "case-event",
          data: JSON.stringify({ id: e.id, caseNumber: e.caseNumber, type: e.type, actor: e.actor, createdAt: e.createdAt }),
        });
      });
      let open = true;
      stream.onAbort(() => {
        open = false;
        unsubscribe();
      });
      while (open) {
        await stream.writeSSE({ event: "ping", data: "" });
        await stream.sleep(15_000);
      }
    }),
  );

  /** Synthetic sample documents, so the demo can attach them through the normal upload path. */
  app.get("/samples", (c) => {
    if (!deps.samplesDir) return c.json([]);
    return c.json(readdirSync(deps.samplesDir).filter((f) => f.endsWith(".pdf")).sort());
  });

  app.get("/samples/:fileName", (c) => {
    const fileName = c.req.param("fileName");
    if (!deps.samplesDir || !/^[a-z0-9-]+\.pdf$/.test(fileName)) throw new CaseError("Sample not found", "NOT_FOUND");
    try {
      return c.body(readFileSync(new URL(fileName, deps.samplesDir)), 200, { "Content-Type": "application/pdf" });
    } catch {
      throw new CaseError("Sample not found", "NOT_FOUND");
    }
  });

  return app;
}
