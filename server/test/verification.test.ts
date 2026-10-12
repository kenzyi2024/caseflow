import { describe, expect, it } from "vitest";
import type { WageRecord } from "@caseflow/shared";
import { selectPolicy } from "../src/rules/policies";
import { compareNames, normalizeEmployer } from "../src/verification/names";
import { verifyIncome, type VerificationDocument } from "../src/verification/verify";
import { intakeFromExpected } from "../fixtures/fake-intake";
import { DOCUMENTS } from "../fixtures/paystubs";
import { SCENARIOS } from "../fixtures/scenarios";

const gonzalez = SCENARIOS.find((s) => s.id === "gonzalez")!;
const policy = selectPolicy(gonzalez.household.applicationDate);
const stubs = (overrides: Partial<(typeof DOCUMENTS)[number]["expected"]> = {}): VerificationDocument[] =>
  DOCUMENTS.filter((d) => d.scenarioId === "gonzalez" && d.kind === "paystub").map((d) => ({
    documentId: d.fileName,
    fileName: d.fileName,
    intake: intakeFromExpected({ ...d.expected, ...overrides }),
  }));
const vec = (wagesCents: number, employerName = "BLUESTONE MARKET CO"): WageRecord[] => [
  { ssn: gonzalez.household.ssn, employeeName: "GONZALEZ,MARIA", employerAccount: "4100482211", employerName, quarter: "2026-Q2", wagesCents },
];

describe("name comparison", () => {
  const robert = { first: "ROBERT", middle: "A", last: "JOHNSON" };
  it.each([
    ["ROBERT A JOHNSON", "match"],
    ["Robert Johnson", "match"],
    ["BOB JOHNSON", "nickname"],
    ["R JOHNSON", "nickname"],
    ["RICHARD JOHNSON", "mismatch"],
    ["ROBERT JOHNSTON", "mismatch"],
  ])("%s vs ROBERT A JOHNSON → %s", (printed, kind) => {
    expect(compareNames(printed, robert).kind).toBe(kind);
  });

  it("normalizes employer names across pay stubs and VEC filings", () => {
    expect(normalizeEmployer("Northlight Couriers, LLC")).toBe(normalizeEmployer("NORTHLIGHT COURIERS LLC"));
    expect(normalizeEmployer("Bluestone Market Co.")).toBe("BLUESTONE MARKET");
  });
});

describe("income verification", () => {
  it("converts semimonthly pay to monthly and finds no issues when VEC agrees", () => {
    const result = verifyIncome({ household: gonzalez.household, wageRecords: vec(600_000), documents: stubs(), policy });
    expect(result.reportedMonthlyEarnedCents).toBe(200_000);
    expect(result.vec).toMatchObject({ quarter: "2026-Q2", monthlyCents: 200_000 });
    expect(result.flags).toEqual([]);
  });

  it("flags a pay stub vs VEC difference above 10%, without changing income", () => {
    const within = verifyIncome({ household: gonzalez.household, wageRecords: vec(560_000), documents: stubs(), policy }); // 7% apart
    expect(within.flags).toEqual([]);
    const outside = verifyIncome({ household: gonzalez.household, wageRecords: vec(750_000), documents: stubs(), policy }); // 20% apart
    expect(outside.flags.map((f) => f.code)).toEqual(["INCOME_MISMATCH"]);
    expect(outside.eligibilityInput.monthlyEarnedIncomeCents).toBe(200_000);
  });

  it("uses only the most recent VEC quarter", () => {
    const older: WageRecord = { ...vec(0)[0]!, employerName: "OLD JOB INC", quarter: "2025-Q4", wagesCents: 900_000 };
    const result = verifyIncome({ household: gonzalez.household, wageRecords: [...vec(600_000), older], documents: stubs(), policy });
    expect(result.flags).toEqual([]);
  });

  it("flags pay stubs older than 30 days before the application", () => {
    const result = verifyIncome({ household: gonzalez.household, wageRecords: [], documents: stubs({ payDate: "2026-08-01" }), policy });
    expect(result.flags.map((f) => f.code)).toEqual(["STALE_PAYSTUB", "STALE_PAYSTUB"]);
  });

  it("requires action when the pay stub names someone else", () => {
    const result = verifyIncome({ household: gonzalez.household, wageRecords: [], documents: stubs({ employeeName: "LUIS GONZALEZ" }), policy });
    expect(result.flags.map((f) => `${f.code}:${f.severity}`)).toEqual(["IDENTITY_MISMATCH:action_required"]);
  });

  it("takes every other fact from the VaCMS household, not from the documents", () => {
    const { eligibilityInput } = verifyIncome({ household: gonzalez.household, wageRecords: [], documents: [], policy });
    expect(eligibilityInput).toMatchObject({
      householdSize: 3,
      monthlyEarnedIncomeCents: 0,
      monthlyShelterCostCents: 90_000,
      paysUtilities: true,
      broadBasedCategoricallyEligible: true,
    });
  });
});
