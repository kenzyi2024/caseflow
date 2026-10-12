import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/api/app";
import { VacmsHouseholdExtract } from "../src/integrations/vacms";
import { VecWageMatchFile } from "../src/integrations/vec";
import { CaseService } from "../src/pipeline/case-service";
import { EventStore } from "../src/store/event-store";
import { fakeIntake } from "../fixtures/fake-intake";
import { fakeNoticeWriter } from "../fixtures/fake-notice";

const NOW = new Date("2026-10-12T14:00:00Z");
const USER = { "x-caseflow-user": "bps:kibrahim" };
const SAMPLES = new URL("../data/documents/", import.meta.url);
const CARTER = "0130000102";

let app: ReturnType<typeof createApp>;
let store: EventStore;

beforeEach(async () => {
  store = new EventStore(":memory:", () => NOW);
  const households = VacmsHouseholdExtract.fromFile();
  const service = new CaseService({ store, households, wages: VecWageMatchFile.fromFile(), intake: fakeIntake, noticeWriter: fakeNoticeWriter, now: () => NOW });
  await service.syncFromVacms();
  app = createApp({ service, store, households, now: () => NOW, samplesDir: SAMPLES });
});

const json = (body: unknown) => ({ method: "POST", headers: { ...USER, "content-type": "application/json" }, body: JSON.stringify(body) });

async function upload(caseNumber: string, fileName: string, type = "application/pdf") {
  const form = new FormData();
  form.append("file", new File([readFileSync(new URL(fileName, SAMPLES))], fileName, { type }));
  return app.request(`/api/cases/${caseNumber}/documents`, { method: "POST", headers: USER, body: form });
}

// Response bodies are JSON from our own API; tests read them loosely.
async function waitForStatus(caseNumber: string, statuses: string[]): Promise<any> {
  for (let i = 0; i < 100; i++) {
    const view: any = await (await app.request(`/api/cases/${caseNumber}`)).json();
    if (statuses.includes(view.status)) return view;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`case ${caseNumber} never reached ${statuses.join("/")}`);
}

describe("API", () => {
  it("lists the work queue with VaCMS details and the 30-day clock, before any processing", async () => {
    const res = await app.request("/api/cases");
    expect(res.status).toBe(200);
    const rows: any = await res.json();
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      caseNumber: "0130000101",
      applicant: { first: "MARIA", last: "GONZALEZ" },
      status: "RECEIVED",
      processingDeadline: "2026-11-04",
      daysRemaining: 23,
    });
  });

  it("includes the VaCMS applicant on a case that has not been processed yet", async () => {
    const view: any = await (await app.request("/api/cases/0130000101")).json();
    expect(view.status).toBe("RECEIVED");
    expect(view.household).toBeNull();
    expect(view.applicant.headOfHousehold.last).toBe("GONZALEZ");
    expect(view.daysRemaining).toBe(23);
  });

  it("answers errors with clear JSON and the right status codes", async () => {
    expect((await app.request("/api/cases/9999999999")).status).toBe(404);
    const noUser = await app.request(`/api/cases/${CARTER}/run`, { method: "POST" });
    expect(noUser.status).toBe(400);
    expect(await noUser.json()).toMatchObject({ code: "VALIDATION", error: expect.stringContaining("x-caseflow-user") });
    const notPdf = await upload(CARTER, "manifest.json", "application/json");
    expect(notPdf.status).toBe(400);
  });

  it("runs Carter's case end to end over HTTP: upload, run, lead, revise, approve, notice", async () => {
    expect((await upload(CARTER, "carter-northlight-2026-09-18.pdf")).status).toBe(201);
    expect((await upload(CARTER, "carter-northlight-2026-10-02.pdf")).status).toBe(201);

    expect((await app.request(`/api/cases/${CARTER}/run`, { method: "POST", headers: USER })).status).toBe(202);
    const reviewed = await waitForStatus(CARTER, ["AWAITING_REVIEW", "MANUAL_REVIEW"]);
    expect(reviewed.status).toBe("AWAITING_REVIEW");
    expect(reviewed.daysRemaining).toBe(24);
    expect(reviewed.determination.determination.monthlyBenefitCents).toBe(19_900);
    const lead = reviewed.openActionFlags[0];
    expect(lead.code).toBe("UNREPORTED_EMPLOYER");

    const blocked = await app.request(`/api/cases/${CARTER}/approve`, json({ note: null }));
    expect(blocked.status).toBe(400);

    const badRevision = await app.request(`/api/cases/${CARTER}/revise`, json({ changes: {}, reason: "x" }));
    expect(badRevision.status).toBe(400);

    const revised = await app.request(`/api/cases/${CARTER}/revise`, json({ changes: lead.suggestedChange.changes, reason: "VEC wage match; Fernway confirmed by phone." }));
    expect(revised.status).toBe(200);
    expect(((await revised.json()) as any).determination.determination.monthlyBenefitCents).toBe(2_500);

    expect((await app.request(`/api/cases/${CARTER}/approve`, json({}))).status).toBe(200);
    const ready = await waitForStatus(CARTER, ["NOTICE_READY"]);
    expect(ready.notice.versions.en.fullText).toContain("$25.00");
    expect(ready.notice.factsSentToModel).not.toHaveProperty("caseNumber");

    const queue: any = await (await app.request("/api/cases")).json();
    expect(queue.find((r: { caseNumber: string }) => r.caseNumber === CARTER)).toMatchObject({
      status: "NOTICE_READY",
      determination: { monthlyBenefitCents: 2_500, eligibilityPath: "BBCE" },
    });
  });

  it("serves an uploaded document back only within its own case", async () => {
    const doc: any = await (await upload(CARTER, "carter-northlight-2026-09-18.pdf")).json();
    const res = await app.request(`/api/cases/${CARTER}/documents/${doc.documentId}`);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect((await app.request(`/api/cases/0130000101/documents/${doc.documentId}`)).status).toBe(404);
  });

  it("lists and serves synthetic sample documents, rejecting path tricks", async () => {
    const samples: any = await (await app.request("/api/samples")).json();
    expect(samples).toContain("gonzalez-bluestone-2026-10-02.pdf");
    expect((await app.request("/api/samples/gonzalez-bluestone-2026-10-02.pdf")).status).toBe(200);
    expect((await app.request("/api/samples/..%2F..%2F.env")).status).toBe(404);
  });
});
