import { readFileSync } from "node:fs";
import { WageRecordSchema, type WageRecord } from "@caseflow/shared";
import { assertField, parseCopybook } from "../copybook";
import { parseFixedWidth, type RawRecord } from "../fixed-width";
import { describeError, digits, MappingError, num, str } from "../mapping";
import type { IntegrationReject, WageRecordSource } from "../ports";

/** Illustrative VEC quarterly wage-match layout. Not the real VEC interface (see the copybook header and ADR-0006). */
export const VEC_WAGE_LAYOUT = parseCopybook(readFileSync(new URL("./QTR-WAGE.cpy", import.meta.url), "utf8"));
assertField(VEC_WAGE_LAYOUT, "WG-WAGES-AMT", { kind: "numeric", scale: 2 });

export const DEFAULT_VEC_WAGE_FILE = new URL("../../../data/vec/QTR-WAGE.DAT", import.meta.url);

export function toWageRecord(raw: RawRecord): WageRecord {
  const quarter = num(raw, "WG-QTR");
  if (quarter < 1 || quarter > 4) throw new MappingError(`WG-QTR must be 1-4, found ${quarter}`);
  return WageRecordSchema.parse({
    ssn: digits(raw, "WG-SSN", 9),
    employeeName: str(raw, "WG-EMPLOYEE-NAME"),
    employerAccount: digits(raw, "WG-EMPLOYER-ACCT", 10),
    employerName: str(raw, "WG-EMPLOYER-NAME"),
    quarter: `${digits(raw, "WG-YEAR", 4)}-Q${quarter}`,
    wagesCents: num(raw, "WG-WAGES-AMT"),
  });
}

/**
 * Read-only WageRecordSource backed by a VEC quarterly wage-match file.
 * Wage-match results are IEVS leads for the BPS to follow up (7 CFR 272.8), never verified income.
 */
export class VecWageMatchFile implements WageRecordSource {
  private constructor(
    private readonly bySsn: ReadonlyMap<string, WageRecord[]>,
    readonly rejects: readonly IntegrationReject[],
  ) {}

  static fromText(text: string, source = "VEC QTR-WAGE"): VecWageMatchFile {
    const { records, rejects: structural } = parseFixedWidth(text, VEC_WAGE_LAYOUT);
    const rejects: IntegrationReject[] = structural.map((r) => ({ source, ...r }));
    const bySsn = new Map<string, WageRecord[]>();

    for (const { line, values } of records) {
      try {
        const wage = toWageRecord(values);
        const list = bySsn.get(wage.ssn) ?? [];
        list.push(wage);
        bySsn.set(wage.ssn, list);
      } catch (error) {
        rejects.push({ source, line, reason: describeError(error) });
      }
    }
    for (const list of bySsn.values()) {
      // "2026-Q2" sorts lexically, so most recent quarter first, then employer name.
      list.sort((a, b) => b.quarter.localeCompare(a.quarter) || a.employerName.localeCompare(b.employerName));
    }
    return new VecWageMatchFile(bySsn, rejects);
  }

  static fromFile(path: URL | string = DEFAULT_VEC_WAGE_FILE): VecWageMatchFile {
    return VecWageMatchFile.fromText(readFileSync(path, "utf8"));
  }

  async getWageRecords(ssn: string): Promise<WageRecord[]> {
    return [...(this.bySsn.get(ssn) ?? [])];
  }
}
