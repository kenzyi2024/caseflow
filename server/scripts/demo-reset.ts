/**
 * Rebuilds the demo database with a realistic queue (run with the API server stopped):
 *   Gonzalez, Carter  → RECEIVED, untouched: worked live in the demo
 *   Johnson           → AWAITING_REVIEW, with a name-variant flag and an inferred pay frequency
 *   Williams          → AWAITING_REVIEW, Social Security only, no documents
 *   Nguyen, Patel     → NOTICE_READY, approved by a colleague, notices drafted
 *
 * Run:  npm run demo:reset            (real AI: ~6 intake calls + 2 notices, about $0.30)
 *       npm run demo:reset -- --offline   (no API calls: answer-key intake and template notices)
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { formatCents } from "@caseflow/shared";
import { VacmsHouseholdExtract } from "../src/integrations/vacms";
import { VecWageMatchFile } from "../src/integrations/vec";
import { CaseService } from "../src/pipeline/case-service";
import { EventStore } from "../src/store/event-store";
import { fakeIntake } from "../fixtures/fake-intake";
import { fakeNoticeWriter } from "../fixtures/fake-notice";

const offline = process.argv.includes("--offline");
const DB = fileURLToPath(new URL("../var/caseflow.db", import.meta.url));
const SAMPLES = new URL("../data/documents/", import.meta.url);
const COLLEAGUE = "bps:mlopez";

try {
  await fetch("http://localhost:8787/api/health", { signal: AbortSignal.timeout(500) });
  console.error("The API server is running. Stop it (Ctrl+C in the npm run dev terminal) before resetting the demo.");
  process.exit(1);
} catch {
  // Not running: safe to reset.
}
if (!offline && !process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to caseflow/.env, or run with --offline.");
  process.exit(1);
}

mkdirSync(dirname(DB), { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) if (existsSync(DB + suffix)) rmSync(DB + suffix);
const store = new EventStore(DB);
const service = new CaseService({
  store,
  households: VacmsHouseholdExtract.fromFile(),
  wages: VecWageMatchFile.fromFile(),
  ...(offline ? { intake: fakeIntake, noticeWriter: fakeNoticeWriter } : {}),
});
await service.syncFromVacms();

const pdf = (f: string) => new Uint8Array(readFileSync(new URL(f, SAMPLES)));
const plan: { caseNumber: string; files: string[]; approve: boolean }[] = [
  { caseNumber: "0130000104", files: ["nguyen-cedarline-2026-09-18.pdf", "nguyen-cedarline-2026-10-02.pdf"], approve: true },
  { caseNumber: "0130000106", files: ["patel-northlight-2026-09-18.pdf", "patel-northlight-2026-10-02.pdf"], approve: true },
  { caseNumber: "0130000105", files: ["johnson-fernway-2026-09-25.pdf", "johnson-fernway-2026-10-02.pdf"], approve: false },
  { caseNumber: "0130000103", files: [], approve: false },
];

console.log(`Resetting demo (${offline ? "offline" : "real AI"})…`);
let inputTokens = 0;
let outputTokens = 0;
await Promise.all(
  plan.map(async ({ caseNumber, files, approve }) => {
    for (const f of files) service.uploadDocument(caseNumber, COLLEAGUE, f, "application/pdf", pdf(f));
    let view = await service.runPipeline(caseNumber, COLLEAGUE);
    if (approve && view.status === "AWAITING_REVIEW") {
      service.approve(caseNumber, COLLEAGUE, null);
      view = await service.generateNotice(caseNumber);
    }
    for (const d of view.documents) {
      inputTokens += d.intake?.model.inputTokens ?? 0;
      outputTokens += d.intake?.model.outputTokens ?? 0;
    }
    inputTokens += view.notice?.model.inputTokens ?? 0;
    outputTokens += view.notice?.model.outputTokens ?? 0;
  }),
);

for (const view of service.listCases()) {
  const d = view.determination?.determination;
  const flags = view.verification?.flags.map((f) => f.code).join(", ") || "-";
  console.log(
    `  ${view.caseNumber}  ${view.status.padEnd(16)} ${d ? formatCents(d.monthlyBenefitCents).padStart(8) : "       -"}  flags: ${flags}` +
      (view.noticeError ? `  notice failed: ${view.noticeError.message}` : ""),
  );
}
if (!offline) console.log(`Tokens: ${inputTokens} in / ${outputTokens} out · ≈ $${((inputTokens * 4 + outputTokens * 20) / 1e6).toFixed(2)}`);
store.close();
