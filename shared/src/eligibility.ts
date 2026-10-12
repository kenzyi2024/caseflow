import { z } from "zod";

const cents = z.number().int().nonnegative();

/** Everything the rules engine needs. Monthly amounts, in cents. */
export const EligibilityInputSchema = z.object({
  applicationDate: z.iso.date(),
  householdSize: z.number().int().min(1).max(30),
  hasElderlyOrDisabledMember: z.boolean(),
  monthlyEarnedIncomeCents: cents,
  monthlyUnearnedIncomeCents: cents,
  monthlyShelterCostCents: cents,
  paysUtilities: z.boolean(),
  countableResourcesCents: cents,
  /** Virginia confers BBCE on most applicants (VDSS Manual Part II.G.3). False routes to the standard federal tests. */
  broadBasedCategoricallyEligible: z.boolean(),
});
export type EligibilityInput = z.infer<typeof EligibilityInputSchema>;

export const DenialReasonSchema = z.enum([
  "RESOURCES_EXCEED_LIMIT",
  "GROSS_INCOME_EXCEEDS_LIMIT",
  "NET_INCOME_EXCEEDS_LIMIT",
  "ZERO_BENEFIT",
]);
export type DenialReason = z.infer<typeof DenialReasonSchema>;

/** One line of the explanation: what rule ran, under which citation, with which numbers. */
export const TraceStepSchema = z.object({
  rule: z.string(),
  title: z.string(),
  citation: z.string(),
  outcome: z.enum(["pass", "fail", "info", "not_applicable"]),
  detail: z.string(),
  values: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
});
export type TraceStep = z.infer<typeof TraceStepSchema>;

export const EligibilityPathSchema = z.enum(["BBCE", "STANDARD"]);
export type EligibilityPath = z.infer<typeof EligibilityPathSchema>;

export const DeterminationSchema = z.object({
  eligible: z.boolean(),
  eligibilityPath: EligibilityPathSchema,
  monthlyBenefitCents: cents,
  denialReasons: z.array(DenialReasonSchema),
  policyVersion: z.string(),
  applicationDate: z.iso.date(),
  /** Policy fields marked provisional that this determination actually relied on. */
  provisionalValuesUsed: z.array(z.string()),
  computed: z.object({
    grossIncomeCents: cents,
    earnedIncomeDeductionCents: cents,
    standardDeductionCents: cents,
    adjustedIncomeCents: cents,
    shelterCostsCents: cents,
    excessShelterDeductionCents: cents,
    netIncomeCents: cents,
    householdContributionCents: cents,
    maxAllotmentCents: cents,
  }),
  trace: z.array(TraceStepSchema),
});
export type Determination = z.infer<typeof DeterminationSchema>;
