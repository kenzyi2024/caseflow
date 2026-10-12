import { z } from "zod";

/**
 * A value that depends on household size, as USDA and VDSS publish it:
 * explicit amounts for sizes 1..n, then a fixed increment per additional person.
 * Amounts are whole dollars, exactly as they appear in the source tables.
 */
export const SizeTableSchema = z.object({
  bySize: z.array(z.number().int().nonnegative()).min(1),
  eachAdditional: z.number().int().nonnegative(),
});
export type SizeTable = z.infer<typeof SizeTableSchema>;

export const IncomeFrequencySchema = z.enum(["weekly", "biweekly", "semimonthly", "monthly"]);
export type IncomeFrequency = z.infer<typeof IncomeFrequencySchema>;

export const PolicySourceSchema = z.object({
  label: z.string(),
  url: z.string().url().optional(),
  covers: z.string(),
});

/**
 * One effective-dated version of SNAP policy for Virginia. See ADR-0003.
 * `parameters` holds federal standards (identical in all 48 States + DC);
 * `stateOptions` holds the choices Virginia makes, as published in the VDSS SNAP Manual.
 */
export const PolicySchema = z.object({
  program: z.literal("SNAP"),
  version: z.string().regex(/^FY\d{4}$/),
  title: z.string(),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date(),
  jurisdiction: z.string(),
  parameters: z.object({
    grossIncomeLimit: SizeTableSchema,
    netIncomeLimit: SizeTableSchema,
    maxAllotment: SizeTableSchema,
    standardDeduction: SizeTableSchema,
    earnedIncomeDeductionRate: z.number().min(0).max(1),
    benefitReductionRate: z.number().min(0).max(1),
    excessShelterIncomeShare: z.number().min(0).max(1),
    shelterCap: z.number().int().nonnegative(),
    minimumBenefit: z.object({
      amount: z.number().int().nonnegative(),
      maxHouseholdSize: z.number().int().positive(),
    }),
    resourceLimit: z.object({
      standard: z.number().int().nonnegative(),
      elderlyOrDisabled: z.number().int().nonnegative(),
    }),
  }),
  stateOptions: z.object({
    state: z.string(),
    agency: z.string(),
    manualReference: z.string(),
    /** VDSS sets one statewide standard, tiered by persons in the residence (1–3, 4+). */
    standardUtilityAllowance: SizeTableSchema,
    /** Virginia BBCE: gross income up to 200% of poverty; resource and net income tests do not apply. */
    broadBasedCategoricalEligibility: z
      .object({
        grossIncomeLimit: SizeTableSchema,
        waivesResourceTest: z.boolean(),
        waivesNetIncomeTest: z.boolean(),
      })
      .nullable(),
    incomeConversionFactors: z.object({
      weekly: z.number().positive(),
      biweekly: z.number().positive(),
      semimonthly: z.number().positive(),
      monthly: z.literal(1),
    }),
  }),
  /** Values not yet confirmed against an official publication. Determinations that use them say so. */
  provisional: z.array(z.object({ field: z.string(), reason: z.string() })).default([]),
  sources: z.array(PolicySourceSchema).min(1),
  notes: z.array(z.string()).default([]),
});
export type Policy = z.infer<typeof PolicySchema>;

/** Look up a size-dependent amount (in whole dollars). */
export function lookupBySize(table: SizeTable, householdSize: number): number {
  if (!Number.isInteger(householdSize) || householdSize < 1) {
    throw new RangeError(`Invalid household size: ${householdSize}`);
  }
  const n = table.bySize.length;
  if (householdSize <= n) return table.bySize[householdSize - 1]!;
  return table.bySize[n - 1]! + (householdSize - n) * table.eachAdditional;
}
