import {
  ceilToDollar,
  dollarsToCents,
  formatCents,
  lookupBySize,
  type DenialReason,
  type Determination,
  type EligibilityInput,
  type EligibilityPath,
  type Policy,
  type TraceStep,
} from "@caseflow/shared";
import { selectPolicy } from "./policies";

/** Citation helper: federal regulation first, then the VDSS SNAP Manual (Volume V) section that implements it. */
const cite = (cfr: string, vdss?: string) => (vdss ? `${cfr} · VDSS Manual Pt. ${vdss}` : cfr);

/**
 * Virginia SNAP eligibility and benefit calculation (simplified; see docs/SPEC.md §8).
 *
 * Deterministic by design (ADR-0002): same input + same policy version = same output.
 * Every number comes from the policy file (ADR-0003); every step appends a trace line
 * citing the federal regulation and the VDSS manual section, so the result can be explained and appealed.
 *
 * Two paths, in the order VDSS applies them (Manual Part XI.A, Part IX.B):
 *   BBCE      gross income ≤ 200% of poverty → resource and net income tests do not apply;
 *             net income still sets the benefit amount.
 *   STANDARD  households that are not BBCE-eligible, or exceed the BBCE limit:
 *             resource test + 130% gross test (waived for elderly/disabled) + 100% net test.
 */
export function determineEligibility(input: EligibilityInput, policy: Policy = selectPolicy(input.applicationDate)): Determination {
  const p = policy.parameters;
  const va = policy.stateOptions;
  const size = input.householdSize;
  const elderlyOrDisabled = input.hasElderlyOrDisabledMember;
  const trace: TraceStep[] = [];
  const denialReasons: DenialReason[] = [];
  const fieldsUsed = new Set<string>();
  const $ = formatCents;

  const policyStep: TraceStep = {
    rule: "policy_version",
    title: "Policy version",
    citation: `Effective-dated policy (ADR-0003) · ${va.manualReference}`,
    outcome: "info",
    detail: `Applied ${policy.version} (${policy.effectiveFrom} to ${policy.effectiveTo}) based on application date ${input.applicationDate}.`,
    values: { policyVersion: policy.version, applicationDate: input.applicationDate },
  };
  trace.push(policyStep);

  const grossIncomeCents = input.monthlyEarnedIncomeCents + input.monthlyUnearnedIncomeCents;

  // Categorical eligibility (Virginia BBCE)
  const bbce = va.broadBasedCategoricalEligibility;
  let path: EligibilityPath = "STANDARD";
  if (bbce && input.broadBasedCategoricallyEligible) {
    fieldsUsed.add("stateOptions.broadBasedCategoricalEligibility.grossIncomeLimit");
    const bbceLimitCents = dollarsToCents(lookupBySize(bbce.grossIncomeLimit, size));
    const withinBbce = grossIncomeCents <= bbceLimitCents;
    if (withinBbce) path = "BBCE";
    trace.push({
      rule: "categorical_eligibility",
      title: "Broad-based categorical eligibility (200% of poverty)",
      citation: cite("7 CFR 273.2(j)(2)", "XI.A, II.G.3"),
      outcome: withinBbce ? "pass" : "fail",
      detail: withinBbce
        ? `Gross monthly income ${$(grossIncomeCents)} ≤ Virginia BBCE limit ${$(bbceLimitCents)} for a household of ${size}. Resource and net income tests do not apply; net income still sets the benefit.`
        : `Gross monthly income ${$(grossIncomeCents)} > Virginia BBCE limit ${$(bbceLimitCents)}. Evaluated under the standard tests instead.`,
      values: { grossIncomeCents, bbceLimitCents, householdSize: size },
    });
  } else {
    trace.push({
      rule: "categorical_eligibility",
      title: "Broad-based categorical eligibility (200% of poverty)",
      citation: cite("7 CFR 273.2(j)(2)", "II.G.3"),
      outcome: "not_applicable",
      detail: "Household is not BBCE-eligible. Evaluated under the standard tests.",
      values: {},
    });
  }
  const onBbce = path === "BBCE";

  // Resources
  if (onBbce && bbce?.waivesResourceTest) {
    trace.push({
      rule: "resource_test",
      title: "Resource limit",
      citation: cite("7 CFR 273.8", "IX.B"),
      outcome: "not_applicable",
      detail: `Not applied: resource limits do not apply to BBCE households. Declared resources ${$(input.countableResourcesCents)}.`,
      values: { countableResourcesCents: input.countableResourcesCents },
    });
  } else {
    const resourceLimitCents = dollarsToCents(elderlyOrDisabled ? p.resourceLimit.elderlyOrDisabled : p.resourceLimit.standard);
    const resourcesPass = input.countableResourcesCents <= resourceLimitCents;
    if (!resourcesPass) denialReasons.push("RESOURCES_EXCEED_LIMIT");
    trace.push({
      rule: "resource_test",
      title: "Resource limit",
      citation: cite("7 CFR 273.8(b)", "IX.B"),
      outcome: resourcesPass ? "pass" : "fail",
      detail: `Countable resources ${$(input.countableResourcesCents)} ${resourcesPass ? "≤" : ">"} limit ${$(resourceLimitCents)}${elderlyOrDisabled ? " (elderly/disabled limit)" : ""}.`,
      values: { countableResourcesCents: input.countableResourcesCents, resourceLimitCents },
    });
  }

  // Gross income (130%)
  if (onBbce || elderlyOrDisabled) {
    trace.push({
      rule: "gross_income_test",
      title: "Gross income test (130% of poverty)",
      citation: cite("7 CFR 273.9(a)", "XI.A"),
      outcome: "not_applicable",
      detail: onBbce
        ? `Not applied: the BBCE 200% limit replaces the 130% test. Gross income ${$(grossIncomeCents)}.`
        : `Not applied: households with an elderly or disabled member only need to meet the net income test. Gross income ${$(grossIncomeCents)}.`,
      values: { grossIncomeCents },
    });
  } else {
    const grossLimitCents = dollarsToCents(lookupBySize(p.grossIncomeLimit, size));
    const grossPass = grossIncomeCents <= grossLimitCents;
    if (!grossPass) denialReasons.push("GROSS_INCOME_EXCEEDS_LIMIT");
    trace.push({
      rule: "gross_income_test",
      title: "Gross income test (130% of poverty)",
      citation: cite("7 CFR 273.9(a)(1)", "XI.A"),
      outcome: grossPass ? "pass" : "fail",
      detail: `Gross monthly income ${$(grossIncomeCents)} (earned ${$(input.monthlyEarnedIncomeCents)} + unearned ${$(input.monthlyUnearnedIncomeCents)}) ${grossPass ? "≤" : ">"} limit ${$(grossLimitCents)} for a household of ${size}.`,
      values: { grossIncomeCents, grossLimitCents, householdSize: size },
    });
  }

  // Deductions
  const earnedIncomeDeductionCents = Math.round(input.monthlyEarnedIncomeCents * p.earnedIncomeDeductionRate);
  trace.push({
    rule: "earned_income_deduction",
    title: "Earned income deduction",
    citation: cite("7 CFR 273.9(d)(2)", "X.A.2"),
    outcome: "info",
    detail: `${p.earnedIncomeDeductionRate * 100}% of earned income ${$(input.monthlyEarnedIncomeCents)} = ${$(earnedIncomeDeductionCents)}.`,
    values: { earnedIncomeDeductionCents, rate: p.earnedIncomeDeductionRate },
  });

  const standardDeductionCents = dollarsToCents(lookupBySize(p.standardDeduction, size));
  trace.push({
    rule: "standard_deduction",
    title: "Standard deduction",
    citation: cite("7 CFR 273.9(d)(1)", "X.A.1"),
    outcome: "info",
    detail: `Standard deduction for a household of ${size}: ${$(standardDeductionCents)}.`,
    values: { standardDeductionCents, householdSize: size },
  });

  const adjustedIncomeCents = Math.max(0, grossIncomeCents - earnedIncomeDeductionCents - standardDeductionCents);
  trace.push({
    rule: "adjusted_income",
    title: "Adjusted income",
    citation: cite("7 CFR 273.10(e)(1)", "X.A.4"),
    outcome: "info",
    detail: `${$(grossIncomeCents)} − ${$(earnedIncomeDeductionCents)} − ${$(standardDeductionCents)} = ${$(adjustedIncomeCents)}.`,
    values: { adjustedIncomeCents },
  });

  if (input.paysUtilities) fieldsUsed.add("stateOptions.standardUtilityAllowance");
  // VDSS tiers the utility standard by persons in the residence; CaseFlow assumes residence = SNAP household (SPEC §8).
  const utilityAllowanceCents = input.paysUtilities ? dollarsToCents(lookupBySize(va.standardUtilityAllowance, size)) : 0;
  const shelterCostsCents = input.monthlyShelterCostCents + utilityAllowanceCents;
  const halfAdjustedCents = Math.round(adjustedIncomeCents * p.excessShelterIncomeShare);
  const uncappedExcessCents = Math.max(0, shelterCostsCents - halfAdjustedCents);
  const shelterCapCents = dollarsToCents(p.shelterCap);
  const excessShelterDeductionCents = elderlyOrDisabled ? uncappedExcessCents : Math.min(uncappedExcessCents, shelterCapCents);
  const capApplied = !elderlyOrDisabled && uncappedExcessCents > shelterCapCents;
  trace.push({
    rule: "excess_shelter_deduction",
    title: "Excess shelter deduction",
    citation: cite("7 CFR 273.9(d)(6)(ii)", "X.A.4"),
    outcome: "info",
    detail:
      `Shelter costs ${$(shelterCostsCents)} (housing ${$(input.monthlyShelterCostCents)}` +
      (input.paysUtilities ? ` + Virginia standard utility allowance ${$(utilityAllowanceCents)} for ${size <= 3 ? "1–3" : "4+"} persons` : "") +
      `) − 50% of adjusted income ${$(halfAdjustedCents)} = ${$(uncappedExcessCents)}` +
      (capApplied ? `, capped at ${$(shelterCapCents)}` : elderlyOrDisabled ? " (no cap: elderly/disabled household)" : "") +
      `. Deduction: ${$(excessShelterDeductionCents)}.`,
    values: { shelterCostsCents, utilityAllowanceCents, halfAdjustedCents, uncappedExcessCents, shelterCapCents, excessShelterDeductionCents },
  });

  // Net income (100%)
  const netIncomeCents = Math.max(0, adjustedIncomeCents - excessShelterDeductionCents);
  const netLimitCents = dollarsToCents(lookupBySize(p.netIncomeLimit, size));
  if (onBbce && bbce?.waivesNetIncomeTest) {
    trace.push({
      rule: "net_income_test",
      title: "Net income test (100% of poverty)",
      citation: cite("7 CFR 273.9(a)(2)", "XI.A"),
      outcome: "not_applicable",
      detail: `Not applied to BBCE households. Net income ${$(netIncomeCents)} (adjusted ${$(adjustedIncomeCents)} − shelter ${$(excessShelterDeductionCents)}) still sets the benefit.`,
      values: { netIncomeCents, netLimitCents, householdSize: size },
    });
  } else {
    const netPass = netIncomeCents <= netLimitCents;
    if (!netPass) denialReasons.push("NET_INCOME_EXCEEDS_LIMIT");
    trace.push({
      rule: "net_income_test",
      title: "Net income test (100% of poverty)",
      citation: cite("7 CFR 273.9(a)(2)", "XI.A"),
      outcome: netPass ? "pass" : "fail",
      detail: `Net income ${$(netIncomeCents)} (adjusted ${$(adjustedIncomeCents)} − shelter ${$(excessShelterDeductionCents)}) ${netPass ? "≤" : ">"} limit ${$(netLimitCents)} for a household of ${size}.`,
      values: { netIncomeCents, netLimitCents, householdSize: size },
    });
  }

  // Benefit
  const maxAllotmentCents = dollarsToCents(lookupBySize(p.maxAllotment, size));
  const householdContributionCents = ceilToDollar(Math.round(netIncomeCents * p.benefitReductionRate));
  let monthlyBenefitCents = 0;

  if (denialReasons.length === 0) {
    const calculatedCents = Math.max(0, maxAllotmentCents - householdContributionCents);
    const minimumApplies = size <= p.minimumBenefit.maxHouseholdSize;
    const minimumCents = dollarsToCents(p.minimumBenefit.amount);
    monthlyBenefitCents = minimumApplies ? Math.max(calculatedCents, minimumCents) : calculatedCents;
    if (monthlyBenefitCents === 0) denialReasons.push("ZERO_BENEFIT");

    trace.push({
      rule: "benefit_calculation",
      title: "Monthly benefit",
      citation: cite("7 CFR 273.10(e)(2)", "XIII"),
      outcome: monthlyBenefitCents > 0 ? "pass" : "fail",
      detail:
        `Maximum allotment ${$(maxAllotmentCents)} − 30% of net income rounded up ${$(householdContributionCents)} = ${$(calculatedCents)}` +
        (minimumApplies && calculatedCents < minimumCents ? `; raised to the ${$(minimumCents)} minimum benefit for households of 1–2` : "") +
        (monthlyBenefitCents === 0 ? ". No benefit is payable, so the application is denied" : "") +
        `. Benefit: ${$(monthlyBenefitCents)}.`,
      values: { maxAllotmentCents, householdContributionCents, calculatedCents, monthlyBenefitCents },
    });
  } else {
    trace.push({
      rule: "benefit_calculation",
      title: "Monthly benefit",
      citation: cite("7 CFR 273.10(e)(2)", "XIII"),
      outcome: "not_applicable",
      detail: "Not calculated: the household did not meet one or more eligibility tests above.",
      values: {},
    });
  }

  const provisionalValuesUsed = policy.provisional.filter((pv) => fieldsUsed.has(pv.field)).map((pv) => pv.field);
  if (provisionalValuesUsed.length > 0) {
    policyStep.detail += ` Uses provisional values pending official publication: ${policy.provisional
      .filter((pv) => provisionalValuesUsed.includes(pv.field))
      .map((pv) => `${pv.field} (${pv.reason})`)
      .join("; ")}.`;
  }

  return {
    eligible: denialReasons.length === 0,
    eligibilityPath: path,
    monthlyBenefitCents,
    denialReasons,
    policyVersion: policy.version,
    applicationDate: input.applicationDate,
    provisionalValuesUsed,
    computed: {
      grossIncomeCents,
      earnedIncomeDeductionCents,
      standardDeductionCents,
      adjustedIncomeCents,
      shelterCostsCents,
      excessShelterDeductionCents,
      netIncomeCents,
      householdContributionCents,
      maxAllotmentCents,
    },
    trace,
  };
}
