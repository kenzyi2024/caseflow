import type { IntakeResult, PaystubExtraction, PaystubField } from "@caseflow/shared";
import { DOCUMENTS, type ExpectedIntake } from "./paystubs";

/**
 * A stand-in for the intake agent in offline tests: returns a perfect extraction from the answer key,
 * shaped exactly like a real IntakeResult (including the inferred-frequency flag on Johnson's stubs).
 * The real agent is measured separately by the eval harness.
 */

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

const MODEL = { requested: "fake", served: "fake", effort: "low", latencyMs: 0, inputTokens: 0, outputTokens: 0 };

export function intakeFromExpected(expected: ExpectedIntake, opts: { inferredFrequency?: boolean } = {}): IntakeResult {
  if (expected.documentType === "other") {
    return {
      documentType: "other",
      documentDescription: "Utility bill",
      paystub: null,
      observations: [],
      flags: [{ code: "NOT_A_PAYSTUB", severity: "info", field: null, message: "Not a pay stub: Utility bill. Not used as income evidence." }],
      needsManualReview: false,
      textLayer: true,
      model: MODEL,
    };
  }
  const paystub = Object.fromEntries(
    FIELDS.map((f) => [
      f,
      {
        value: expected[f],
        evidence: String(expected[f]),
        confidence: f === "payFrequency" && opts.inferredFrequency ? 0.7 : 0.97,
        evidenceVerified: true,
      },
    ]),
  ) as PaystubExtraction;
  return {
    documentType: "pay_stub",
    documentDescription: `Pay stub from ${expected.employerName}`,
    paystub,
    observations: [],
    flags: opts.inferredFrequency
      ? [{ code: "LOW_CONFIDENCE", severity: "warning", field: "payFrequency", message: "Model confidence 0.70 for payFrequency." }]
      : [],
    needsManualReview: false,
    textLayer: true,
    model: MODEL,
  };
}

/** Intake function for CaseService, keyed by uploaded file name. */
export async function fakeIntake(_pdf: Uint8Array, { fileName }: { fileName: string }): Promise<IntakeResult> {
  const spec = DOCUMENTS.find((d) => d.fileName === fileName);
  if (!spec) throw new Error(`No answer key for ${fileName}`);
  return intakeFromExpected(spec.expected, { inferredFrequency: spec.kind === "paystub" && !spec.printFrequency });
}
