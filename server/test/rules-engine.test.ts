import { describe, expect, it } from "vitest";
import { lookupBySize, type EligibilityInput } from "@caseflow/shared";
import { determineEligibility } from "../src/rules/engine";
import { toMonthlyCents } from "../src/rules/income";
import { NoPolicyInEffectError, POLICIES, selectPolicy } from "../src/rules/policies";

const FY27_DATE = "2026-10-12";
const FY26_DATE = "2026-09-30";

/** A Virginia household. Most Virginia applicants are BBCE-eligible (VDSS Manual Part II.G.3). */
const household = (overrides: Partial<EligibilityInput> = {}): EligibilityInput => ({
  applicationDate: FY27_DATE,
  householdSize: 3,
  hasElderlyOrDisabledMember: false,
  monthlyEarnedIncomeCents: 0,
  monthlyUnearnedIncomeCents: 0,
  monthlyShelterCostCents: 0,
  paysUtilities: false,
  countableResourcesCents: 0,
  broadBasedCategoricallyEligible: true,
  ...overrides,
});
const notBbce = (overrides: Partial<EligibilityInput> = {}) => household({ broadBasedCategoricallyEligible: false, ...overrides });

// Expected values below were calculated by hand, step by step, from the policy files.
describe("benefit calculation (Virginia)", () => {
  it("working family of 3 in Arlington under FY2027: $568/month", () => {
    // gross 2,000 ≤ BBCE limit 4,553 → BBCE path
    // 2,000 − EID 400 − std 217 = 1,383 adjusted
    // shelter: rent 900 + VA utility standard 375 (1–3 persons) = 1,275 − 691.50 = 583.50 excess (under 769 cap)
    // net 799.50 → 30% = 239.85 → round up 240 → 808 − 240 = 568
    const d = determineEligibility(
      household({ monthlyEarnedIncomeCents: 200_000, monthlyShelterCostCents: 90_000, paysUtilities: true, countableResourcesCents: 50_000 }),
    );
    expect(d.eligible).toBe(true);
    expect(d.eligibilityPath).toBe("BBCE");
    expect(d.policyVersion).toBe("FY2027");
    expect(d.computed.adjustedIncomeCents).toBe(138_300);
    expect(d.computed.excessShelterDeductionCents).toBe(58_350);
    expect(d.computed.netIncomeCents).toBe(79_950);
    expect(d.computed.householdContributionCents).toBe(24_000);
    expect(d.monthlyBenefitCents).toBe(56_800);
  });

  it("same family, applied one day before the FY2027 change: $541/month under FY2026", () => {
    // std 209 → adjusted 1,391; shelter 1,275 − 695.50 = 579.50; net 811.50 → 30% = 243.45 → 244 → 785 − 244 = 541
    const d = determineEligibility(
      household({ applicationDate: FY26_DATE, monthlyEarnedIncomeCents: 200_000, monthlyShelterCostCents: 90_000, paysUtilities: true }),
    );
    expect(d.policyVersion).toBe("FY2026");
    expect(d.computed.netIncomeCents).toBe(81_150);
    expect(d.monthlyBenefitCents).toBe(54_100);
  });

  it("uses the 4+ person Virginia utility standard and caps excess shelter for non-elderly households", () => {
    // size 4, gross 2,500 → adjusted 1,771; shelter 1,600 + 476 = 2,076 − 885.50 = 1,190.50 → capped at 769
    // net 1,002 → 30% = 300.60 → 301 → 1,023 − 301 = 722
    const d = determineEligibility(
      household({ householdSize: 4, monthlyEarnedIncomeCents: 250_000, monthlyShelterCostCents: 160_000, paysUtilities: true }),
    );
    const shelter = d.trace.find((s) => s.rule === "excess_shelter_deduction")!;
    expect(shelter.values.utilityAllowanceCents).toBe(47_600);
    expect(d.computed.excessShelterDeductionCents).toBe(76_900);
    expect(d.monthlyBenefitCents).toBe(72_200);
    expect(shelter.detail).toContain("capped");
  });

  it("raises 1–2 person households to the minimum benefit", () => {
    // elderly, unearned 1,800: adjusted 1,583; shelter 700 + 375 = 1,075 − 791.50 = 283.50 (no cap)
    // net 1,299.50 → 30% = 389.85 → 390 > 306 max allotment → $0 calculated → $25 minimum
    const d = determineEligibility(
      household({
        householdSize: 1,
        hasElderlyOrDisabledMember: true,
        monthlyUnearnedIncomeCents: 180_000,
        monthlyShelterCostCents: 70_000,
        paysUtilities: true,
      }),
    );
    expect(d.eligible).toBe(true);
    expect(d.computed.netIncomeCents).toBe(129_950);
    expect(d.monthlyBenefitCents).toBe(2_500);
  });
});

describe("Virginia broad-based categorical eligibility (BBCE)", () => {
  it("makes a household eligible that the standard 130% gross test would deny", () => {
    const input = { householdSize: 1, monthlyEarnedIncomeCents: 180_000 }; // $1,800 > $1,729 (130%) but ≤ $2,660 (200%)
    expect(determineEligibility(notBbce(input)).denialReasons).toEqual(["GROSS_INCOME_EXCEEDS_LIMIT"]);
    const d = determineEligibility(household(input));
    expect(d.eligible).toBe(true);
    expect(d.eligibilityPath).toBe("BBCE");
  });

  it("treats income exactly at the 200% limit as within it ('may not exceed')", () => {
    const atLimit = determineEligibility(household({ householdSize: 1, monthlyEarnedIncomeCents: 266_000 })); // FY2027 limit $2,660
    expect(atLimit.eligibilityPath).toBe("BBCE");
    const oneCentOver = determineEligibility(household({ householdSize: 1, monthlyEarnedIncomeCents: 266_001 }));
    expect(oneCentOver.eligibilityPath).toBe("STANDARD");
  });

  it("waives the resource test (VDSS Manual Part IX.B)", () => {
    const input = { monthlyEarnedIncomeCents: 100_000, countableResourcesCents: 500_000 };
    expect(determineEligibility(notBbce(input)).denialReasons).toEqual(["RESOURCES_EXCEED_LIMIT"]);
    const d = determineEligibility(household(input));
    expect(d.eligible).toBe(true);
    expect(d.trace.find((s) => s.rule === "resource_test")?.outcome).toBe("not_applicable");
  });

  it("waives the net income test, but net income still sets the benefit", () => {
    // size 3, unearned 4,500 ≤ BBCE 4,553; net 4,283 → 30% = 1,285 > 808 → $0 → denied (no minimum for 3+)
    const d = determineEligibility(household({ monthlyUnearnedIncomeCents: 450_000 }));
    expect(d.eligibilityPath).toBe("BBCE");
    expect(d.trace.find((s) => s.rule === "net_income_test")?.outcome).toBe("not_applicable");
    expect(d.denialReasons).toEqual(["ZERO_BENEFIT"]);
    expect(d.monthlyBenefitCents).toBe(0);
  });

  it("falls back to the standard tests above the 200% limit", () => {
    const d = determineEligibility(household({ householdSize: 1, monthlyEarnedIncomeCents: 300_000, countableResourcesCents: 900_000 }));
    expect(d.eligibilityPath).toBe("STANDARD");
    expect(d.trace.find((s) => s.rule === "categorical_eligibility")?.outcome).toBe("fail");
    expect(d.denialReasons).toEqual(["RESOURCES_EXCEED_LIMIT", "GROSS_INCOME_EXCEEDS_LIMIT", "NET_INCOME_EXCEEDS_LIMIT"]);
  });
});

describe("standard federal tests (households not BBCE-eligible)", () => {
  it("exempts elderly/disabled households from the gross income test", () => {
    const d = determineEligibility(
      notBbce({ householdSize: 1, hasElderlyOrDisabledMember: true, monthlyUnearnedIncomeCents: 180_000, monthlyShelterCostCents: 70_000, paysUtilities: true }),
    );
    expect(d.trace.find((s) => s.rule === "gross_income_test")?.outcome).toBe("not_applicable");
    expect(d.eligible).toBe(true);
  });

  it("denies when net income exceeds 100% of poverty even if gross passes", () => {
    // gross 1,700 ≤ 1,729; net 1,700 − 217 = 1,483 > 1,330
    const d = determineEligibility(notBbce({ householdSize: 1, monthlyUnearnedIncomeCents: 170_000 }));
    expect(d.denialReasons).toEqual(["NET_INCOME_EXCEEDS_LIMIT"]);
  });

  it("applies the elderly/disabled resource limit for the policy year in force", () => {
    const input = notBbce({ householdSize: 1, hasElderlyOrDisabledMember: true, monthlyUnearnedIncomeCents: 90_000, countableResourcesCents: 460_000 });
    expect(determineEligibility(input).denialReasons).not.toContain("RESOURCES_EXCEED_LIMIT"); // FY2027 limit 4,750
    expect(determineEligibility({ ...input, applicationDate: FY26_DATE }).denialReasons).toContain("RESOURCES_EXCEED_LIMIT"); // FY2026 limit 4,500
  });
});

describe("explainability, provenance and determinism", () => {
  it("cites a federal regulation and a VDSS manual section on every rule step", () => {
    const d = determineEligibility(household({ monthlyEarnedIncomeCents: 200_000 }));
    expect(d.trace.length).toBeGreaterThanOrEqual(9);
    for (const step of d.trace.filter((s) => s.rule !== "policy_version")) {
      expect(step.citation).toMatch(/7 CFR/);
      expect(step.citation).toMatch(/VDSS Manual Pt\./);
    }
  });

  it("flags provisional FY2027 Virginia values only when the determination relies on them", () => {
    const fy27 = determineEligibility(household({ monthlyEarnedIncomeCents: 200_000, paysUtilities: true }));
    expect(fy27.provisionalValuesUsed).toEqual([
      "stateOptions.standardUtilityAllowance",
      "stateOptions.broadBasedCategoricalEligibility.grossIncomeLimit",
    ]);
    expect(fy27.trace[0]!.detail).toContain("provisional");

    expect(determineEligibility(notBbce({ monthlyEarnedIncomeCents: 200_000 })).provisionalValuesUsed).toEqual([]);
    expect(determineEligibility(household({ applicationDate: FY26_DATE, paysUtilities: true })).provisionalValuesUsed).toEqual([]);
  });

  it("returns identical results for identical input", () => {
    const input = household({ monthlyEarnedIncomeCents: 213_337, monthlyShelterCostCents: 101_111, paysUtilities: true });
    expect(determineEligibility(input)).toEqual(determineEligibility(input));
  });
});

describe("income conversion (22VAC40-601-20)", () => {
  const policy = selectPolicy(FY27_DATE);
  it.each([
    ["weekly", 50_000, 215_000],
    ["biweekly", 100_000, 215_000],
    ["semimonthly", 100_000, 200_000],
    ["monthly", 100_000, 100_000],
  ] as const)("converts %s pay of %i cents to %i cents a month", (frequency, perCheck, monthly) => {
    expect(toMonthlyCents(perCheck, frequency, policy)).toBe(monthly);
  });
});

describe("policy versions", () => {
  it("selects the version in effect on the application date", () => {
    expect(selectPolicy("2026-09-30").version).toBe("FY2026");
    expect(selectPolicy("2026-10-01").version).toBe("FY2027");
  });

  it("refuses to decide when no policy is in effect", () => {
    expect(() => selectPolicy("2025-09-30")).toThrow(NoPolicyInEffectError);
    expect(() => selectPolicy("2027-10-01")).toThrow(NoPolicyInEffectError);
  });

  it("has contiguous, non-overlapping effective ranges", () => {
    const sorted = [...POLICIES].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = new Date(`${sorted[i - 1]!.effectiveTo}T00:00:00Z`);
      prevEnd.setUTCDate(prevEnd.getUTCDate() + 1);
      expect(prevEnd.toISOString().slice(0, 10)).toBe(sorted[i]!.effectiveFrom);
    }
  });

  it("reproduces the VDSS Transmittal #36 tables for FY2026", () => {
    const fy26 = selectPolicy(FY26_DATE);
    const bbceLimit = fy26.stateOptions.broadBasedCategoricalEligibility!.grossIncomeLimit;
    expect(lookupBySize(bbceLimit, 1)).toBe(2608);
    expect(lookupBySize(bbceLimit, 9)).toBe(9025 + 916);
    expect(lookupBySize(fy26.stateOptions.standardUtilityAllowance, 3)).toBe(375);
    expect(lookupBySize(fy26.stateOptions.standardUtilityAllowance, 7)).toBe(476);
    expect(fy26.parameters.shelterCap).toBe(744);
    expect(fy26.provisional).toEqual([]);
  });

  it("extends size tables beyond 8 people with the per-person increment", () => {
    const fy27 = selectPolicy(FY27_DATE).parameters;
    expect(lookupBySize(fy27.grossIncomeLimit, 10)).toBe(6037 + 2 * 616);
    expect(lookupBySize(fy27.maxAllotment, 10)).toBe(1841 + 2 * 225);
    expect(lookupBySize(fy27.standardDeduction, 10)).toBe(308);
  });
});
