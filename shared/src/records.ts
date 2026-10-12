import { z } from "zod";

const cents = z.number().int().nonnegative();

export const PersonNameSchema = z.object({
  first: z.string().min(1),
  middle: z.string().nullable(),
  last: z.string().min(1),
});
export type PersonName = z.infer<typeof PersonNameSchema>;

/** A household as CaseFlow sees it, translated from the VaCMS extract (ADR-0006). */
export const HouseholdRecordSchema = z.object({
  caseNumber: z.string().min(1),
  localityFips: z.string().regex(/^\d{3}$/),
  headOfHousehold: PersonNameSchema,
  ssn: z.string().regex(/^\d{9}$/),
  dateOfBirth: z.iso.date(),
  applicationDate: z.iso.date(),
  householdSize: z.number().int().min(1).max(30),
  hasElderlyOrDisabledMember: z.boolean(),
  broadBasedCategoricallyEligible: z.boolean(),
  monthlyUnearnedIncomeCents: cents,
  unearnedIncomeSource: z.string().nullable(),
  monthlyShelterCostCents: cents,
  paysHeatingOrCooling: z.boolean(),
  countableResourcesCents: cents,
  preferredLanguage: z.enum(["en", "es"]),
  address: z.object({
    line1: z.string().min(1),
    city: z.string().min(1),
    state: z.string().length(2),
    zip: z.string().regex(/^\d{5}$/),
  }),
});
export type HouseholdRecord = z.infer<typeof HouseholdRecordSchema>;

/** One employer's quarterly wage report for one person, from the VEC wage match. An IEVS lead, not verified income. */
export const WageRecordSchema = z.object({
  ssn: z.string().regex(/^\d{9}$/),
  employeeName: z.string(),
  employerAccount: z.string(),
  employerName: z.string().min(1),
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/),
  wagesCents: cents,
});
export type WageRecord = z.infer<typeof WageRecordSchema>;
