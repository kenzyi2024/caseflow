import type { CopybookLayout } from "./copybook";

/**
 * Field values exactly as the record stores them:
 * alphanumeric → right-trimmed string; numeric → integer in units of 10^-scale
 * (a PIC 9(5)V99 amount of "0090000" becomes 90000, i.e. cents).
 */
export type RawRecord = Record<string, string | number>;

export interface ParsedLine {
  line: number;
  values: RawRecord;
}

export interface RejectedLine {
  line: number;
  reason: string;
}

export interface FixedWidthResult {
  records: ParsedLine[];
  rejects: RejectedLine[];
}

/**
 * Parse a fixed-width file against its copybook layout.
 * Malformed lines are rejected with a reason and line number, never guessed at.
 */
export function parseFixedWidth(text: string, layout: CopybookLayout): FixedWidthResult {
  const records: ParsedLine[] = [];
  const rejects: RejectedLine[] = [];

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === "") return;
    if (raw.length !== layout.recordLength) {
      rejects.push({ line, reason: `Record length ${raw.length}, expected ${layout.recordLength} (${layout.recordName})` });
      return;
    }

    const values: RawRecord = {};
    for (const field of layout.fields) {
      if (field.filler) continue;
      const slice = raw.slice(field.offset, field.offset + field.length);
      if (field.kind === "alphanumeric") {
        values[field.name] = slice.trimEnd();
      } else if (/^\d+$/.test(slice)) {
        values[field.name] = Number(slice);
      } else {
        rejects.push({ line, reason: `${field.name} must be ${field.length} digits, found "${slice}"` });
        return;
      }
    }
    records.push({ line, values });
  });

  return { records, rejects };
}

/**
 * Encode one record. Used to produce synthetic interface files for the demo and tests;
 * CaseFlow never writes to the state's systems (ADR-0006).
 */
export function encodeRecord(values: RawRecord, layout: CopybookLayout): string {
  return layout.fields
    .map((field) => {
      if (field.filler) return " ".repeat(field.length);
      const value = values[field.name];
      if (value === undefined) throw new Error(`Missing value for ${field.name}`);
      if (field.kind === "alphanumeric") {
        const s = String(value);
        if (s.length > field.length) throw new Error(`${field.name} is ${s.length} chars, max ${field.length}: "${s}"`);
        return s.padEnd(field.length, " ");
      }
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error(`${field.name} must be a non-negative integer, got ${value}`);
      }
      const s = String(value);
      if (s.length > field.length) throw new Error(`${field.name} overflows PIC ${field.picture}: ${value}`);
      return s.padStart(field.length, "0");
    })
    .join("");
}
