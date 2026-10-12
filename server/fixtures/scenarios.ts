import type { HouseholdRecord, IncomeFrequency } from "@caseflow/shared";

/**
 * Synthetic demo households. Single source of truth for the VaCMS extract, the VEC wage file,
 * the pay stub PDFs and the eval answer key.
 *
 * Everything here is invented:
 * - SSNs use area numbers 900–999, which the SSA never assigns.
 * - Names, streets and employers are fictional.
 * - ZIP codes are real Arlington ZIPs so the context reads correctly.
 * Each scenario exists to demonstrate one thing; `purpose` says what.
 */

export interface Job {
  employerName: string;
  employerAccount: string;
  payFrequency: IncomeFrequency;
  grossPerPeriodCents: number;
  /** Did the applicant report this job and provide a pay stub? */
  reportedOnApplication: boolean;
  /** Name as printed on the pay stub, when it differs from the VaCMS record. */
  nameOnPaystub?: string;
}

export interface VecQuarter {
  employerAccount: string;
  employerName: string;
  quarter: `${number}-Q${1 | 2 | 3 | 4}`;
  wagesCents: number;
}

export interface Scenario {
  id: string;
  purpose: string;
  household: HouseholdRecord;
  jobs: Job[];
  vecWages: VecQuarter[];
  /** Outcome using only the income the applicant reported (before any BPS action on flags). Hand-calculated. */
  expected: { eligibilityPath: "BBCE" | "STANDARD"; monthlyBenefitCents: number };
}

const ARLINGTON = { city: "ARLINGTON", state: "VA" } as const;

const EMPLOYERS = {
  bluestone: { employerName: "BLUESTONE MARKET CO", employerAccount: "4100482211" },
  northlight: { employerName: "NORTHLIGHT COURIERS LLC", employerAccount: "4100519034" },
  fernway: { employerName: "FERNWAY HOSPITALITY GROUP", employerAccount: "4100377850" },
  cedarline: { employerName: "CEDARLINE AUTO CARE LLC", employerAccount: "4100602117" },
} as const;

const base = {
  localityFips: "013", // Arlington County
  broadBasedCategoricallyEligible: true,
  hasElderlyOrDisabledMember: false,
  monthlyUnearnedIncomeCents: 0,
  unearnedIncomeSource: null,
  preferredLanguage: "en",
} as const;

export const SCENARIOS: Scenario[] = [
  {
    id: "gonzalez",
    purpose: "Clean case: the pay stub matches VEC wages. Family of 3, FY2027 BBCE, $568/month. Notice in Spanish.",
    household: {
      ...base,
      caseNumber: "0130000101",
      headOfHousehold: { first: "MARIA", middle: "L", last: "GONZALEZ" },
      ssn: "900412301",
      dateOfBirth: "1988-04-17",
      applicationDate: "2026-10-05",
      householdSize: 3,
      monthlyShelterCostCents: 90_000,
      paysHeatingOrCooling: true,
      countableResourcesCents: 50_000,
      preferredLanguage: "es",
      address: { line1: "1450 LARKSPUR CT APT 3B", ...ARLINGTON, zip: "22204" },
    },
    jobs: [{ ...EMPLOYERS.bluestone, payFrequency: "semimonthly", grossPerPeriodCents: 100_000, reportedOnApplication: true }],
    vecWages: [
      { ...EMPLOYERS.bluestone, quarter: "2026-Q2", wagesCents: 600_000 },
      { ...EMPLOYERS.bluestone, quarter: "2026-Q1", wagesCents: 585_000 },
    ],
    expected: { eligibilityPath: "BBCE", monthlyBenefitCents: 56_800 },
  },
  {
    id: "carter",
    purpose:
      "IEVS lead: VEC shows a second employer the applicant did not report. Pay stub alone gives $199/month; with the VEC wages it would be $25.",
    household: {
      ...base,
      caseNumber: "0130000102",
      headOfHousehold: { first: "JAMES", middle: "D", last: "CARTER" },
      ssn: "900412302",
      dateOfBirth: "1979-11-02",
      applicationDate: "2026-10-06",
      householdSize: 1,
      monthlyShelterCostCents: 115_000,
      paysHeatingOrCooling: true,
      countableResourcesCents: 20_000,
      address: { line1: "2210 JUNIPER HOLLOW RD APT 112", ...ARLINGTON, zip: "22206" },
    },
    jobs: [
      { ...EMPLOYERS.northlight, payFrequency: "biweekly", grossPerPeriodCents: 78_000, reportedOnApplication: true },
      { ...EMPLOYERS.fernway, payFrequency: "biweekly", grossPerPeriodCents: 49_000, reportedOnApplication: false },
    ],
    vecWages: [
      { ...EMPLOYERS.northlight, quarter: "2026-Q2", wagesCents: 468_000 },
      { ...EMPLOYERS.fernway, quarter: "2026-Q2", wagesCents: 294_000 },
      { ...EMPLOYERS.northlight, quarter: "2026-Q1", wagesCents: 468_000 },
      { ...EMPLOYERS.fernway, quarter: "2026-Q1", wagesCents: 310_000 },
    ],
    expected: { eligibilityPath: "BBCE", monthlyBenefitCents: 19_900 },
  },
  {
    id: "williams",
    purpose: "Elderly applicant with Social Security only: no pay stub needed. Minimum benefit of $25.",
    household: {
      ...base,
      caseNumber: "0130000103",
      headOfHousehold: { first: "DOROTHY", middle: "M", last: "WILLIAMS" },
      ssn: "900412303",
      dateOfBirth: "1958-06-30",
      applicationDate: "2026-10-07",
      householdSize: 1,
      hasElderlyOrDisabledMember: true,
      monthlyUnearnedIncomeCents: 180_000,
      unearnedIncomeSource: "SSA",
      monthlyShelterCostCents: 70_000,
      paysHeatingOrCooling: true,
      countableResourcesCents: 390_000,
      address: { line1: "805 SYCAMORE BEND APT 4", ...ARLINGTON, zip: "22203" },
    },
    jobs: [],
    vecWages: [],
    expected: { eligibilityPath: "BBCE", monthlyBenefitCents: 2_500 },
  },
  {
    id: "nguyen",
    purpose: "Family of 4 with high rent: the excess shelter deduction hits the $769 cap. $722/month.",
    household: {
      ...base,
      caseNumber: "0130000104",
      headOfHousehold: { first: "THANH", middle: "V", last: "NGUYEN" },
      ssn: "900412304",
      dateOfBirth: "1985-02-11",
      applicationDate: "2026-10-08",
      householdSize: 4,
      monthlyShelterCostCents: 160_000,
      paysHeatingOrCooling: true,
      countableResourcesCents: 120_000,
      address: { line1: "3301 CEDAR KNOLL DR", ...ARLINGTON, zip: "22207" },
    },
    jobs: [{ ...EMPLOYERS.cedarline, payFrequency: "semimonthly", grossPerPeriodCents: 125_000, reportedOnApplication: true }],
    vecWages: [
      { ...EMPLOYERS.cedarline, quarter: "2026-Q2", wagesCents: 750_000 },
      { ...EMPLOYERS.cedarline, quarter: "2026-Q1", wagesCents: 750_000 },
    ],
    expected: { eligibilityPath: "BBCE", monthlyBenefitCents: 72_200 },
  },
  {
    id: "johnson",
    purpose: "Identity check: the pay stub says 'BOB JOHNSON', VaCMS says 'ROBERT A JOHNSON'. Weekly pay × 4.3. $339/month.",
    household: {
      ...base,
      caseNumber: "0130000105",
      headOfHousehold: { first: "ROBERT", middle: "A", last: "JOHNSON" },
      ssn: "900412305",
      dateOfBirth: "1971-09-23",
      applicationDate: "2026-10-08",
      householdSize: 2,
      monthlyShelterCostCents: 105_000,
      paysHeatingOrCooling: false,
      countableResourcesCents: 0,
      address: { line1: "1720 FOXGLOVE LN APT 210", ...ARLINGTON, zip: "22201" },
    },
    jobs: [
      { ...EMPLOYERS.fernway, payFrequency: "weekly", grossPerPeriodCents: 41_000, reportedOnApplication: true, nameOnPaystub: "BOB JOHNSON" },
    ],
    vecWages: [
      { ...EMPLOYERS.fernway, quarter: "2026-Q2", wagesCents: 533_000 },
      { ...EMPLOYERS.fernway, quarter: "2026-Q1", wagesCents: 533_000 },
    ],
    expected: { eligibilityPath: "BBCE", monthlyBenefitCents: 33_900 },
  },
  {
    id: "patel",
    purpose: "$5,000 in savings: eligible because Virginia BBCE waives the resource test. Maximum benefit of $808.",
    household: {
      ...base,
      caseNumber: "0130000106",
      headOfHousehold: { first: "ANIKA", middle: "R", last: "PATEL" },
      ssn: "900412306",
      dateOfBirth: "1992-12-05",
      applicationDate: "2026-10-09",
      householdSize: 3,
      monthlyShelterCostCents: 130_000,
      paysHeatingOrCooling: true,
      countableResourcesCents: 500_000,
      address: { line1: "4012 HAWTHORN RIDGE CT", ...ARLINGTON, zip: "22205" },
    },
    jobs: [{ ...EMPLOYERS.northlight, payFrequency: "semimonthly", grossPerPeriodCents: 60_000, reportedOnApplication: true }],
    vecWages: [
      { ...EMPLOYERS.northlight, quarter: "2026-Q2", wagesCents: 360_000 },
      { ...EMPLOYERS.northlight, quarter: "2026-Q1", wagesCents: 360_000 },
    ],
    expected: { eligibilityPath: "BBCE", monthlyBenefitCents: 80_800 },
  },
];

/** Wage records for people who are not CaseFlow applicants, so lookups must filter by SSN. */
export const UNRELATED_VEC_WAGES = [
  { ssn: "900419901", employeeName: "DOE,ALEX", ...EMPLOYERS.bluestone, quarter: "2026-Q2", wagesCents: 412_000 },
  { ssn: "900419902", employeeName: "ROE,SAM", ...EMPLOYERS.cedarline, quarter: "2026-Q2", wagesCents: 298_000 },
] as const;
