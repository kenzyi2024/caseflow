import { z } from "zod";
import { IncomeFrequencySchema } from "./policy";

/**
 * A value read from a document, with the proof a BPS needs to trust it (ADR-0007):
 * the exact text it came from, the model's confidence, and whether code confirmed
 * that text is really on the document.
 */
const evidenced = <T extends z.ZodType>(value: T) =>
  z.object({
    value: value.nullable(),
    evidence: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    /** true: quote found in the PDF text and it shows this value; false: it doesn't; null: no text layer to check. */
    evidenceVerified: z.boolean().nullable(),
  });

export const PaystubExtractionSchema = z.object({
  employeeName: evidenced(z.string()),
  employerName: evidenced(z.string()),
  payPeriodStart: evidenced(z.iso.date()),
  payPeriodEnd: evidenced(z.iso.date()),
  payDate: evidenced(z.iso.date()),
  payFrequency: evidenced(IncomeFrequencySchema),
  grossPayCents: evidenced(z.number().int().nonnegative()),
  netPayCents: evidenced(z.number().int().nonnegative()),
  ytdGrossCents: evidenced(z.number().int().nonnegative()),
});
export type PaystubExtraction = z.infer<typeof PaystubExtractionSchema>;
export type PaystubField = keyof PaystubExtraction;

export const IntakeFlagCodeSchema = z.enum([
  "NOT_A_PAYSTUB",
  "MISSING_FIELD",
  "INVALID_VALUE",
  "EVIDENCE_NOT_FOUND",
  "LOW_CONFIDENCE",
  "NO_TEXT_LAYER",
  "PERIOD_FREQUENCY_MISMATCH",
  "INCONSISTENT_DATES",
  "INCONSISTENT_AMOUNTS",
]);

export const IntakeFlagSchema = z.object({
  code: IntakeFlagCodeSchema,
  severity: z.enum(["info", "warning", "critical"]),
  field: z.string().nullable(),
  message: z.string(),
});
export type IntakeFlag = z.infer<typeof IntakeFlagSchema>;

export const IntakeResultSchema = z.object({
  documentType: z.enum(["pay_stub", "other"]),
  documentDescription: z.string(),
  paystub: PaystubExtractionSchema.nullable(),
  /** Free-text notes from the model for the BPS (e.g. "net pay does not add up"). */
  observations: z.array(z.string()),
  flags: z.array(IntakeFlagSchema),
  /** Any critical flag: the document can't be used without a person looking at it. */
  needsManualReview: z.boolean(),
  textLayer: z.boolean(),
  model: z.object({
    requested: z.string(),
    served: z.string(),
    effort: z.string(),
    latencyMs: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
  }),
});
export type IntakeResult = z.infer<typeof IntakeResultSchema>;
