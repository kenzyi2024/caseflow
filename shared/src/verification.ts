import { z } from "zod";
import { EligibilityInputSchema } from "./eligibility";
import { IncomeFrequencySchema } from "./policy";

const cents = z.number().int().nonnegative();

export const VerificationFlagCodeSchema = z.enum([
  "UNREPORTED_EMPLOYER",
  "INCOME_MISMATCH",
  "NAME_VARIANT",
  "IDENTITY_MISMATCH",
  "STALE_PAYSTUB",
  "FREQUENCY_CONFLICT",
  "DOCUMENT_NEEDS_REVIEW",
]);
export type VerificationFlagCode = z.infer<typeof VerificationFlagCodeSchema>;

/** Fields a BPS may correct; the rules engine then re-determines (the BPS changes facts, never the benefit). */
export const FactChangesSchema = z
  .object({
    monthlyEarnedIncomeCents: cents,
    monthlyUnearnedIncomeCents: cents,
    monthlyShelterCostCents: cents,
    paysUtilities: z.boolean(),
    countableResourcesCents: cents,
  })
  .partial()
  .refine((c) => Object.keys(c).length > 0, "At least one fact must change");
export type FactChanges = z.infer<typeof FactChangesSchema>;

export const VerificationFlagSchema = z.object({
  code: VerificationFlagCodeSchema,
  severity: z.enum(["info", "warning", "action_required"]),
  message: z.string(),
  citation: z.string(),
  documentId: z.string().nullable(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  /** A one-click correction the UI can offer the BPS, e.g. "add VEC wages for this employer". */
  suggestedChange: z.object({ label: z.string(), changes: FactChangesSchema }).nullable(),
});
export type VerificationFlag = z.infer<typeof VerificationFlagSchema>;

export const IncomeSourceSchema = z.object({
  employerName: z.string(),
  payFrequency: IncomeFrequencySchema,
  documentIds: z.array(z.string()),
  grossPerPeriodCents: cents,
  monthlyCents: cents,
});
export type IncomeSource = z.infer<typeof IncomeSourceSchema>;

export const VerificationResultSchema = z.object({
  incomeSources: z.array(IncomeSourceSchema),
  reportedMonthlyEarnedCents: cents,
  vec: z.object({
    quarter: z.string().nullable(),
    monthlyCents: cents,
    byEmployer: z.array(z.object({ employerName: z.string(), wagesCents: cents, monthlyCents: cents, matchesPaystub: z.boolean() })),
  }),
  flags: z.array(VerificationFlagSchema),
  usedDocumentIds: z.array(z.string()),
  excludedDocumentIds: z.array(z.string()),
  /** The facts the rules engine will use, before any BPS revision. */
  eligibilityInput: EligibilityInputSchema,
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
