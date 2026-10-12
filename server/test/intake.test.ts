import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeIntake, type IntakeModelOutput } from "../src/agents/intake";
import { extractPdfText } from "../src/agents/pdf-text";

// These tests exercise the deterministic checks around the model, so they never call the API.
const MODEL_META = { requested: "claude-opus-5-5", served: "claude-opus-5-5", effort: "low", latencyMs: 0, inputTokens: 0, outputTokens: 0 };
const doc = (name: string) => new Uint8Array(readFileSync(new URL(`../data/documents/${name}`, import.meta.url)));

/** What a correct model response looks like for patel-northlight-2026-10-02.pdf. */
const patelOutput = (): IntakeModelOutput => ({
  documentType: "pay_stub",
  documentDescription: "Advice of deposit from Northlight Couriers LLC",
  employeeName: { value: "ANIKA R PATEL", evidence: "Name: ANIKA R PATEL", confidence: 0.99 },
  employerName: { value: "NORTHLIGHT COURIERS LLC", evidence: "NORTHLIGHT COURIERS LLC", confidence: 0.99 },
  payPeriodStart: { value: "2026-09-16", evidence: "Period Beginning: 09/16/2026", confidence: 0.98 },
  payPeriodEnd: { value: "2026-09-30", evidence: "Period Ending: 09/30/2026", confidence: 0.98 },
  payDate: { value: "2026-10-02", evidence: "Check Date: 10/02/2026", confidence: 0.98 },
  payFrequency: { value: "semimonthly", evidence: "Pay Cycle: Semi-Monthly", confidence: 0.97 },
  grossPay: { value: "600.00", evidence: "Total Gross 600.00", confidence: 0.98 },
  netPay: { value: "497.10", evidence: "Net Deposit $497.10", confidence: 0.98 },
  ytdGrossPay: { value: "10800.00", evidence: "10,800.00", confidence: 0.95 },
  observations: [],
});

let patelText: string;
let johnsonText: string;
beforeAll(async () => {
  patelText = (await extractPdfText(doc("patel-northlight-2026-10-02.pdf")))!;
  johnsonText = (await extractPdfText(doc("johnson-fernway-2026-10-02.pdf")))!;
});

describe("intake post-processing", () => {
  it("accepts a correct extraction: cents, ISO dates, every quote verified, no flags", () => {
    const result = normalizeIntake(patelOutput(), patelText, MODEL_META);
    expect(result.needsManualReview).toBe(false);
    expect(result.flags).toEqual([]);
    expect(result.paystub?.grossPayCents.value).toBe(60_000);
    expect(result.paystub?.netPayCents.value).toBe(49_710);
    expect(result.paystub?.ytdGrossCents.value).toBe(1_080_000);
    expect(Object.values(result.paystub!).every((f) => f.evidenceVerified === true)).toBe(true);
  });

  it("catches a quote that is not on the document (hallucinated evidence)", () => {
    const output = patelOutput();
    output.grossPay = { value: "650.00", evidence: "Total Gross 650.00", confidence: 0.99 };
    const result = normalizeIntake(output, patelText, MODEL_META);
    expect(result.flags).toContainEqual(expect.objectContaining({ code: "EVIDENCE_NOT_FOUND", field: "grossPayCents", severity: "critical" }));
    expect(result.paystub?.grossPayCents.evidenceVerified).toBe(false);
    expect(result.needsManualReview).toBe(true);
  });

  it("catches a real quote that does not show the extracted value (e.g. year-to-date read as gross)", () => {
    const output = patelOutput();
    output.grossPay = { value: "10800.00", evidence: "Total Gross 600.00", confidence: 0.9 };
    const result = normalizeIntake(output, patelText, MODEL_META);
    expect(result.flags).toEqual([
      expect.objectContaining({ code: "EVIDENCE_NOT_FOUND", field: "grossPayCents", message: expect.stringContaining("does not show") }),
    ]);
    expect(result.needsManualReview).toBe(true);
  });

  it("accepts an inferred pay frequency but asks the BPS to confirm it", () => {
    const output: IntakeModelOutput = {
      ...patelOutput(),
      employeeName: { value: "BOB JOHNSON", evidence: "Employee: BOB JOHNSON", confidence: 0.99 },
      employerName: { value: "FERNWAY HOSPITALITY GROUP", evidence: "FERNWAY HOSPITALITY GROUP", confidence: 0.99 },
      payPeriodStart: { value: "2026-09-21", evidence: "09/21/2026", confidence: 0.98 },
      payPeriodEnd: { value: "2026-09-27", evidence: "09/27/2026", confidence: 0.98 },
      payDate: { value: "2026-10-02", evidence: "Pay Date: 10/02/2026", confidence: 0.98 },
      payFrequency: { value: "weekly", evidence: "Pay Period: 09/21/2026 - 09/27/2026", confidence: 0.7 },
      grossPay: { value: "410.00", evidence: "GROSS PAY 410.00", confidence: 0.98 },
      netPay: { value: "339.68", evidence: "NET PAY 339.68", confidence: 0.98 },
      ytdGrossPay: { value: "15990.00", evidence: "15,990.00", confidence: 0.95 },
      observations: ["Pay frequency is not printed; inferred weekly from a 7-day pay period."],
    };
    const result = normalizeIntake(output, johnsonText, MODEL_META);
    expect(result.flags).toEqual([expect.objectContaining({ code: "LOW_CONFIDENCE", field: "payFrequency", severity: "warning" })]);
    expect(result.needsManualReview).toBe(false);
  });

  it("flags impossible dates, periods that don't match the frequency, and net above gross", () => {
    const output = patelOutput();
    output.payPeriodStart = { value: "2026-09-31", evidence: "09/16/2026", confidence: 0.9 };
    output.payFrequency = { value: "weekly", evidence: "Pay Cycle: Semi-Monthly", confidence: 0.9 };
    output.netPay = { value: "700.00", evidence: "Net Deposit $497.10", confidence: 0.9 };
    const codes = normalizeIntake(output, patelText, MODEL_META).flags.map((f) => `${f.code}:${f.field}`);
    expect(codes).toContain("INVALID_VALUE:payPeriodStart");
    expect(codes).toContain("MISSING_FIELD:payPeriodStart");
    expect(codes).toContain("INCONSISTENT_AMOUNTS:netPayCents");

    const mismatch = patelOutput();
    mismatch.payFrequency = { value: "weekly", evidence: "Pay Cycle: Semi-Monthly", confidence: 0.9 };
    expect(normalizeIntake(mismatch, patelText, MODEL_META).flags.map((f) => f.code)).toContain("PERIOD_FREQUENCY_MISMATCH");
  });

  it("sends a pay stub missing its gross pay to manual review", () => {
    const output = patelOutput();
    output.grossPay = { value: "", evidence: "", confidence: 0 };
    const result = normalizeIntake(output, patelText, MODEL_META);
    expect(result.flags).toContainEqual(expect.objectContaining({ code: "MISSING_FIELD", field: "grossPayCents", severity: "critical" }));
    expect(result.needsManualReview).toBe(true);
  });

  it("rejects amounts it cannot parse and treats an unknown frequency as missing", () => {
    const output = patelOutput();
    output.grossPay = { value: "six hundred", evidence: "Total Gross 600.00", confidence: 0.9 };
    output.payFrequency = { value: "unknown", evidence: "", confidence: 0 };
    const codes = normalizeIntake(output, patelText, MODEL_META).flags.map((f) => `${f.code}:${f.field}:${f.severity}`);
    expect(codes).toContain("INVALID_VALUE:grossPayCents:critical");
    expect(codes).toContain("MISSING_FIELD:payFrequency:critical");
  });

  it("says so when evidence cannot be checked (no text layer, e.g. a scan)", () => {
    const result = normalizeIntake(patelOutput(), null, MODEL_META);
    expect(result.textLayer).toBe(false);
    expect(result.flags.map((f) => f.code)).toEqual(["NO_TEXT_LAYER"]);
    expect(result.paystub?.grossPayCents.evidenceVerified).toBeNull();
  });

  it("does not use a non-pay-stub document as income evidence", () => {
    const result = normalizeIntake(
      {
        ...patelOutput(),
        documentType: "other",
        documentDescription: "Electric utility bill",
      },
      "NORTHERN STAR ENERGY",
      MODEL_META,
    );
    expect(result.paystub).toBeNull();
    expect(result.flags).toEqual([expect.objectContaining({ code: "NOT_A_PAYSTUB", severity: "info" })]);
    expect(result.needsManualReview).toBe(false);
  });
});
