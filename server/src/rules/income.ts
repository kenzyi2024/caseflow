import type { Cents, IncomeFrequency, Policy } from "@caseflow/shared";

/**
 * Convert a per-paycheck amount to a monthly amount using Virginia's conversion factors
 * (22VAC40-601-20; 7 CFR 273.10(c)(2)): weekly × 4.3, biweekly × 2.15, semimonthly × 2.
 */
export function toMonthlyCents(amountCents: Cents, frequency: IncomeFrequency, policy: Policy): Cents {
  return Math.round(amountCents * policy.stateOptions.incomeConversionFactors[frequency]);
}
