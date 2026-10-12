/**
 * Intake eval: runs the real intake agent on every synthetic document and scores each
 * extracted field against the answer key in server/data/documents/manifest.json.
 *
 * Run: npm run eval            (default effort)
 *      npm run eval -- --effort=medium
 * Costs real API usage (about 11 calls); results are written to evals/results/ (git-ignored).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IntakeResult, PaystubField } from "@caseflow/shared";
import { INTAKE_EFFORT, runIntake } from "../server/src/agents/intake";
import type { Effort } from "../server/src/agents/claude";
import type { ExpectedIntake } from "../server/fixtures/paystubs";

const PRICE_PER_MTOK = { input: 4, output: 20 }; // Claude Opus 5.5, USD
const CONCURRENCY = 4;
const FIELDS: PaystubField[] = [
  "employeeName",
  "employerName",
  "payPeriodStart",
  "payPeriodEnd",
  "payDate",
  "payFrequency",
  "grossPayCents",
  "netPayCents",
  "ytdGrossCents",
];

interface ManifestEntry {
  fileName: string;
  scenarioId: string;
  kind: string;
  expected: ExpectedIntake;
}

interface DocResult {
  fileName: string;
  ok: boolean;
  documentTypeCorrect: boolean;
  fieldsCorrect: number;
  fieldsTotal: number;
  mismatches: { field: string; expected: unknown; got: unknown }[];
  flags: string[];
  needsManualReview: boolean;
  evidenceVerified: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  servedBy: string;
  error?: string;
}

const effortArg = process.argv.find((a) => a.startsWith("--effort="))?.split("=")[1];
const effort = (effortArg ?? INTAKE_EFFORT) as Effort;
const docsDir = new URL("../server/data/documents/", import.meta.url);
const manifest: ManifestEntry[] = JSON.parse(readFileSync(new URL("manifest.json", docsDir), "utf8"));

const normalize = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").toUpperCase() : v);

function score(entry: ManifestEntry, result: IntakeResult): Omit<DocResult, "fileName" | "latencyMs" | "inputTokens" | "outputTokens" | "servedBy"> {
  const documentTypeCorrect = result.documentType === entry.expected.documentType;
  const mismatches: DocResult["mismatches"] = [];
  if (!documentTypeCorrect) mismatches.push({ field: "documentType", expected: entry.expected.documentType, got: result.documentType });

  let fieldsCorrect = 0;
  let evidenceVerified = 0;
  const fieldsTotal = entry.expected.documentType === "pay_stub" ? FIELDS.length : 0;
  if (fieldsTotal > 0) {
    for (const field of FIELDS) {
      const got = result.paystub?.[field].value ?? null;
      if (normalize(got) === normalize(entry.expected[field])) fieldsCorrect++;
      else mismatches.push({ field, expected: entry.expected[field], got });
      if (result.paystub?.[field].evidenceVerified) evidenceVerified++;
    }
  }
  return {
    ok: mismatches.length === 0,
    documentTypeCorrect,
    fieldsCorrect,
    fieldsTotal,
    mismatches,
    flags: result.flags.map((f) => `${f.code}${f.field ? `:${f.field}` : ""}`),
    needsManualReview: result.needsManualReview,
    evidenceVerified,
  };
}

async function evaluate(entry: ManifestEntry): Promise<DocResult> {
  const pdf = new Uint8Array(readFileSync(new URL(entry.fileName, docsDir)));
  const started = Date.now();
  try {
    const result = await runIntake(pdf, { effort });
    return {
      fileName: entry.fileName,
      ...score(entry, result),
      latencyMs: result.model.latencyMs,
      inputTokens: result.model.inputTokens,
      outputTokens: result.model.outputTokens,
      servedBy: result.model.served,
    };
  } catch (error) {
    return {
      fileName: entry.fileName,
      ok: false,
      documentTypeCorrect: false,
      fieldsCorrect: 0,
      fieldsTotal: entry.expected.documentType === "pay_stub" ? FIELDS.length : 0,
      mismatches: [],
      flags: [],
      needsManualReview: true,
      evidenceVerified: 0,
      latencyMs: Date.now() - started,
      inputTokens: 0,
      outputTokens: 0,
      servedBy: "-",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!);
      }
    }),
  );
  return results;
}

console.log(`Intake eval · ${manifest.length} documents · effort=${effort}\n`);
const results = await pool(manifest, CONCURRENCY, evaluate);

for (const r of results) {
  const fields = r.fieldsTotal ? `${r.fieldsCorrect}/${r.fieldsTotal} fields` : "classification";
  const flags = r.flags.length ? `  flags: ${r.flags.join(", ")}` : "";
  console.log(`${r.ok ? "✓" : "✗"} ${r.fileName.padEnd(40)} ${fields.padEnd(14)} ${String(r.latencyMs).padStart(6)} ms${flags}`);
  for (const m of r.mismatches) console.log(`    ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}`);
  if (r.error) console.log(`    error: ${r.error}`);
}

const fieldsTotal = results.reduce((s, r) => s + r.fieldsTotal, 0);
const fieldsCorrect = results.reduce((s, r) => s + r.fieldsCorrect, 0);
const evidenceVerified = results.reduce((s, r) => s + r.evidenceVerified, 0);
const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
const inputTokens = results.reduce((s, r) => s + r.inputTokens, 0);
const outputTokens = results.reduce((s, r) => s + r.outputTokens, 0);
const cost = (inputTokens * PRICE_PER_MTOK.input + outputTokens * PRICE_PER_MTOK.output) / 1e6;
const pct = (n: number, d: number) => `${d ? ((100 * n) / d).toFixed(1) : "0.0"}%`;

const summary = {
  documents: results.length,
  documentsFullyCorrect: results.filter((r) => r.ok).length,
  classificationAccuracy: pct(results.filter((r) => r.documentTypeCorrect).length, results.length),
  fieldAccuracy: pct(fieldsCorrect, fieldsTotal),
  evidenceVerified: pct(evidenceVerified, fieldsTotal),
  sentToManualReview: results.filter((r) => r.needsManualReview).length,
  errors: results.filter((r) => r.error).length,
  latencyMs: { median: latencies[Math.floor(latencies.length / 2)], max: latencies.at(-1) },
  tokens: { input: inputTokens, output: outputTokens },
  estimatedCostUsd: Number(cost.toFixed(4)),
  effort,
};

console.log(`
Documents fully correct  ${summary.documentsFullyCorrect}/${summary.documents}
Classification accuracy  ${summary.classificationAccuracy}
Field accuracy           ${summary.fieldAccuracy} (${fieldsCorrect}/${fieldsTotal})
Evidence verified        ${summary.evidenceVerified}
Sent to manual review    ${summary.sentToManualReview}
Errors                   ${summary.errors}
Latency                  median ${summary.latencyMs.median} ms · max ${summary.latencyMs.max} ms
Tokens                   ${inputTokens} in / ${outputTokens} out · ≈ $${cost.toFixed(2)}`);

const outDir = new URL("./results/", import.meta.url);
mkdirSync(outDir, { recursive: true });
const outFile = new URL(`intake-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, outDir);
writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2));
console.log(`\nSaved ${outFile.pathname}`);
process.exitCode = summary.documentsFullyCorrect === summary.documents ? 0 : 1;
