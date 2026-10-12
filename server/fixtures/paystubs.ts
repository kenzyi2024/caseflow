import type { IncomeFrequency } from "@caseflow/shared";
import { SCENARIOS, type Job, type Scenario } from "./scenarios";

/**
 * Synthetic documents for intake: two recent pay stubs per reported job, plus a
 * non-pay-stub distractor. Each carries its answer key for the eval harness.
 */

export interface ExpectedIntake {
  documentType: "pay_stub" | "other";
  employeeName: string | null;
  employerName: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  payDate: string | null;
  payFrequency: IncomeFrequency | null;
  grossPayCents: number | null;
  netPayCents: number | null;
  ytdGrossCents: number | null;
}

export interface PaystubSpec {
  kind: "paystub";
  fileName: string;
  scenarioId: string;
  template: "A" | "B";
  /** Johnson's employer doesn't print the frequency, so intake must infer it from the period dates. */
  printFrequency: boolean;
  employer: { name: string; address: string };
  employeeName: string;
  employeeAddress: string;
  employeeId: string;
  ssnLast4: string;
  hours: number;
  rateCents: number;
  deductions: { label: string; cents: number }[];
  expected: ExpectedIntake;
}

export interface OtherDocSpec {
  kind: "utility_bill";
  fileName: string;
  scenarioId: string;
  lines: string[];
  expected: ExpectedIntake;
}

export type DocumentSpec = PaystubSpec | OtherDocSpec;

const EMPLOYER_DETAILS: Record<string, { address: string; template: "A" | "B"; printFrequency: boolean }> = {
  "BLUESTONE MARKET CO": { address: "2800 QUARRY STONE RD, FALLS CHURCH VA 22042", template: "A", printFrequency: true },
  "NORTHLIGHT COURIERS LLC": { address: "455 BEACON POINT DR, ALEXANDRIA VA 22314", template: "B", printFrequency: true },
  "FERNWAY HOSPITALITY GROUP": { address: "1900 FERNWAY PLZ, ARLINGTON VA 22202", template: "A", printFrequency: false },
  "CEDARLINE AUTO CARE LLC": { address: "77 CEDARLINE CT, FAIRFAX VA 22030", template: "B", printFrequency: true },
};

/** The two most recent pay periods before the October 2026 applications, with their sequence number in the year. */
const SCHEDULES: Record<IncomeFrequency, { start: string; end: string; payDate: string; periodNumber: number }[]> = {
  weekly: [
    { start: "2026-09-14", end: "2026-09-20", payDate: "2026-09-25", periodNumber: 38 },
    { start: "2026-09-21", end: "2026-09-27", payDate: "2026-10-02", periodNumber: 39 },
  ],
  biweekly: [
    { start: "2026-08-30", end: "2026-09-12", payDate: "2026-09-18", periodNumber: 19 },
    { start: "2026-09-13", end: "2026-09-26", payDate: "2026-10-02", periodNumber: 20 },
  ],
  semimonthly: [
    { start: "2026-09-01", end: "2026-09-15", payDate: "2026-09-18", periodNumber: 17 },
    { start: "2026-09-16", end: "2026-09-30", payDate: "2026-10-02", periodNumber: 18 },
  ],
  monthly: [
    { start: "2026-08-01", end: "2026-08-31", payDate: "2026-09-01", periodNumber: 8 },
    { start: "2026-09-01", end: "2026-09-30", payDate: "2026-10-01", periodNumber: 9 },
  ],
};

const slug = (s: string) => s.toLowerCase().split(/\s+/)[0]!;

function paystubsFor(scenario: Scenario, job: Job): PaystubSpec[] {
  const details = EMPLOYER_DETAILS[job.employerName];
  if (!details) throw new Error(`No pay stub details for ${job.employerName}`);
  const { first, middle, last } = scenario.household.headOfHousehold;
  const employeeName = job.nameOnPaystub ?? [first, middle, last].filter(Boolean).join(" ");
  const gross = job.grossPerPeriodCents;
  const hours = gross / job.hourlyRateCents;
  if (!Number.isInteger(hours * 100)) throw new Error(`${job.employerName}: gross ${gross} is not hours × rate`);

  const deductions = [
    { label: "Federal Income Tax", cents: Math.round(gross * 0.06) },
    { label: "Virginia State Tax", cents: Math.round(gross * 0.035) },
    { label: "Social Security", cents: Math.round(gross * 0.062) },
    { label: "Medicare", cents: Math.round(gross * 0.0145) },
  ];
  const net = gross - deductions.reduce((sum, d) => sum + d.cents, 0);
  const a = scenario.household.address;

  return SCHEDULES[job.payFrequency].map((period) => ({
    kind: "paystub",
    fileName: `${scenario.id}-${slug(job.employerName)}-${period.payDate}.pdf`,
    scenarioId: scenario.id,
    template: details.template,
    printFrequency: details.printFrequency,
    employer: { name: job.employerName, address: details.address },
    employeeName,
    employeeAddress: `${a.line1}, ${a.city} ${a.state} ${a.zip}`,
    employeeId: `E${scenario.household.caseNumber.slice(-4)}`,
    ssnLast4: scenario.household.ssn.slice(-4),
    hours,
    rateCents: job.hourlyRateCents,
    deductions,
    expected: {
      documentType: "pay_stub",
      employeeName,
      employerName: job.employerName,
      payPeriodStart: period.start,
      payPeriodEnd: period.end,
      payDate: period.payDate,
      payFrequency: job.payFrequency,
      grossPayCents: gross,
      netPayCents: net,
      ytdGrossCents: gross * period.periodNumber,
    },
  }));
}

const NOT_A_PAYSTUB: ExpectedIntake = {
  documentType: "other",
  employeeName: null,
  employerName: null,
  payPeriodStart: null,
  payPeriodEnd: null,
  payDate: null,
  payFrequency: null,
  grossPayCents: null,
  netPayCents: null,
  ytdGrossCents: null,
};

export const DOCUMENTS: DocumentSpec[] = [
  ...SCENARIOS.flatMap((s) => s.jobs.filter((j) => j.reportedOnApplication).flatMap((j) => paystubsFor(s, j))),
  {
    kind: "utility_bill",
    fileName: "gonzalez-utility-bill-2026-09-22.pdf",
    scenarioId: "gonzalez",
    lines: [
      "NORTHERN STAR ENERGY (fictional)",
      "Residential Electric Service Statement",
      "Statement Date: 09/22/2026",
      "Account Number: 7781-2201-04",
      "Service Address: 1450 LARKSPUR CT APT 3B, ARLINGTON VA 22204",
      "Account Holder: MARIA L GONZALEZ",
      "Service Period: 08/20/2026 - 09/19/2026",
      "Usage: 812 kWh",
      "Current Charges: $142.17",
      "Amount Due: $142.17",
      "Due Date: 10/12/2026",
    ],
    expected: NOT_A_PAYSTUB,
  },
];
