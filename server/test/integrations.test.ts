import { describe, expect, it } from "vitest";
import { CopybookError, parseCopybook } from "../src/integrations/copybook";
import { encodeRecord, parseFixedWidth } from "../src/integrations/fixed-width";
import { VACMS_HOUSEHOLD_LAYOUT, VacmsHouseholdExtract } from "../src/integrations/vacms";
import { VecWageMatchFile } from "../src/integrations/vec";
import { determineEligibility } from "../src/rules/engine";
import { toMonthlyCents } from "../src/rules/income";
import { selectPolicy } from "../src/rules/policies";
import { householdToRaw } from "../fixtures/encode";
import { SCENARIOS } from "../fixtures/scenarios";

const SAMPLE = `
      * comment lines are ignored
       01  SAMPLE-REC.
           05  ID              PIC X(4).
           05  AMOUNT          PIC 9(5)V99.
           05  NESTED.
               10  COUNT       PIC 99.
               10  CODE        PIC XX.
           05  FILLER          PIC X(3).
`;

describe("copybook parser", () => {
  it("computes offsets, lengths and implied decimals, including nested groups and FILLER", () => {
    const layout = parseCopybook(SAMPLE);
    expect(layout.recordName).toBe("SAMPLE-REC");
    expect(layout.recordLength).toBe(4 + 7 + 2 + 2 + 3);
    expect(layout.fields.map((f) => [f.name, f.offset, f.length, f.kind, f.scale])).toEqual([
      ["ID", 0, 4, "alphanumeric", 0],
      ["AMOUNT", 4, 7, "numeric", 2],
      ["COUNT", 11, 2, "numeric", 0],
      ["CODE", 13, 2, "alphanumeric", 0],
      ["FILLER", 15, 3, "alphanumeric", 0],
    ]);
  });

  it.each([
    ["signed fields", "01 R. 05 A PIC S9(5)."],
    ["packed decimal", "01 R. 05 A PIC 9(5) COMP-3."],
    ["OCCURS", "01 R. 05 A PIC X(2) OCCURS 3 TIMES."],
    ["REDEFINES", "01 R. 05 A PIC X(2). 05 B REDEFINES A PIC 99."],
    ["edited pictures", "01 R. 05 A PIC ZZ9."],
    ["two records", "01 R. 05 A PIC X. 01 S. 05 B PIC X."],
  ])("rejects %s instead of guessing", (_label, source) => {
    expect(() => parseCopybook(source)).toThrow(CopybookError);
  });

  it("reads the illustrative VaCMS household layout", () => {
    expect(VACMS_HOUSEHOLD_LAYOUT.recordName).toBe("HH-EXTRACT-REC");
    expect(VACMS_HOUSEHOLD_LAYOUT.recordLength).toBe(169);
  });
});

describe("fixed-width parsing", () => {
  const layout = parseCopybook(SAMPLE);
  const good = encodeRecord({ ID: "A1", AMOUNT: 90_000, COUNT: 3, CODE: "ES" }, layout);

  it("round-trips a record through encode and parse", () => {
    expect(good).toBe("A1  0090000" + "03ES" + "   ");
    expect(parseFixedWidth(good, layout).records[0]?.values).toEqual({ ID: "A1", AMOUNT: 90_000, COUNT: 3, CODE: "ES" });
  });

  it("rejects malformed lines with a line number and reason, and keeps the good ones", () => {
    const text = [good, good.slice(0, -1), good.replace("0090000", "00900X0"), "", good].join("\r\n");
    const { records, rejects } = parseFixedWidth(text, layout);
    expect(records.map((r) => r.line)).toEqual([1, 5]);
    expect(rejects).toEqual([
      { line: 2, reason: "Record length 17, expected 18 (SAMPLE-REC)" },
      { line: 3, reason: 'AMOUNT must be 7 digits, found "00900X0"' },
    ]);
  });

  it("refuses to encode values that do not fit instead of truncating", () => {
    expect(() => encodeRecord({ ID: "TOO-LONG", AMOUNT: 1, COUNT: 1, CODE: "EN" }, layout)).toThrow(/max 4/);
    expect(() => encodeRecord({ ID: "A", AMOUNT: 100_000_000, COUNT: 1, CODE: "EN" }, layout)).toThrow(/overflows/);
  });
});

describe("VaCMS household adapter", () => {
  const vacms = VacmsHouseholdExtract.fromFile();

  it("loads every synthetic household with no rejects", async () => {
    expect(vacms.rejects).toEqual([]);
    expect(await vacms.listHouseholds()).toHaveLength(SCENARIOS.length);
  });

  it("translates each extract record back into exactly the scenario's household", async () => {
    for (const scenario of SCENARIOS) {
      expect(await vacms.getHousehold(scenario.household.caseNumber)).toEqual(scenario.household);
    }
  });

  it("maps legacy conventions: LAST,FIRST M names, CCYYMMDD dates, Y/N flags, implied-decimal cents", async () => {
    const williams = await vacms.getHousehold("0130000103");
    expect(williams?.headOfHousehold).toEqual({ first: "DOROTHY", middle: "M", last: "WILLIAMS" });
    expect(williams?.dateOfBirth).toBe("1958-06-30");
    expect(williams?.hasElderlyOrDisabledMember).toBe(true);
    expect(williams?.monthlyUnearnedIncomeCents).toBe(180_000);
    expect(williams?.unearnedIncomeSource).toBe("SSA");
  });

  it("rejects records that are well-formed but semantically invalid, with a reason", () => {
    const raw = householdToRaw(SCENARIOS[0]!.household);
    const lines = [
      encodeRecord({ ...raw, "HH-DOB": 19880231 }, VACMS_HOUSEHOLD_LAYOUT),
      encodeRecord({ ...raw, "HH-CASE-NUMBER": "0130000199", "HH-ELD-DIS-IND": "?" }, VACMS_HOUSEHOLD_LAYOUT),
      encodeRecord({ ...raw, "HH-CASE-NUMBER": "0130000198", "HH-LANG-CD": "FR" }, VACMS_HOUSEHOLD_LAYOUT),
      encodeRecord(raw, VACMS_HOUSEHOLD_LAYOUT),
      encodeRecord(raw, VACMS_HOUSEHOLD_LAYOUT),
    ];
    const extract = VacmsHouseholdExtract.fromText(lines.join("\n"));
    expect(extract.rejects.map((r) => [r.line, r.reason])).toEqual([
      [1, "HH-DOB is not a valid date: 19880231"],
      [2, 'HH-ELD-DIS-IND must be Y or N, found "?"'],
      [3, 'HH-LANG-CD must be EN or ES, found "FR"'],
      [5, "Duplicate case number 0130000101"],
    ]);
  });

  it("returns undefined for an unknown case", async () => {
    expect(await vacms.getHousehold("9999999999")).toBeUndefined();
  });
});

describe("VEC wage-match adapter", () => {
  const vec = VecWageMatchFile.fromFile();

  it("returns only the requested person's wages, most recent quarter first", async () => {
    expect(vec.rejects).toEqual([]);
    const carter = await vec.getWageRecords("900412302");
    expect(carter.map((w) => [w.quarter, w.employerName, w.wagesCents])).toEqual([
      ["2026-Q2", "FERNWAY HOSPITALITY GROUP", 294_000],
      ["2026-Q2", "NORTHLIGHT COURIERS LLC", 468_000],
      ["2026-Q1", "FERNWAY HOSPITALITY GROUP", 310_000],
      ["2026-Q1", "NORTHLIGHT COURIERS LLC", 468_000],
    ]);
    expect(carter.every((w) => w.ssn === "900412302")).toBe(true);
  });

  it("returns no records for someone with no Virginia wages", async () => {
    expect(await vec.getWageRecords("900412303")).toEqual([]);
  });
});

describe("demo scenarios", () => {
  it("uses only synthetic SSNs (area 900–999, never assigned by the SSA)", () => {
    for (const s of SCENARIOS) expect(s.household.ssn).toMatch(/^9\d{8}$/);
  });

  it.each(SCENARIOS.map((s) => [s.id, s] as const))("%s produces the benefit quoted in the demo script", (_id, s) => {
    const policy = selectPolicy(s.household.applicationDate);
    const earned = s.jobs
      .filter((j) => j.reportedOnApplication)
      .reduce((sum, j) => sum + toMonthlyCents(j.grossPerPeriodCents, j.payFrequency, policy), 0);
    const d = determineEligibility({
      applicationDate: s.household.applicationDate,
      householdSize: s.household.householdSize,
      hasElderlyOrDisabledMember: s.household.hasElderlyOrDisabledMember,
      monthlyEarnedIncomeCents: earned,
      monthlyUnearnedIncomeCents: s.household.monthlyUnearnedIncomeCents,
      monthlyShelterCostCents: s.household.monthlyShelterCostCents,
      paysUtilities: s.household.paysHeatingOrCooling,
      countableResourcesCents: s.household.countableResourcesCents,
      broadBasedCategoricallyEligible: s.household.broadBasedCategoricallyEligible,
    });
    expect(d.eligibilityPath).toBe(s.expected.eligibilityPath);
    expect(d.monthlyBenefitCents).toBe(s.expected.monthlyBenefitCents);
  });
});
