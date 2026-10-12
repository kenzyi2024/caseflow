import { z } from "zod";
import type { PersonName } from "@caseflow/shared";
import type { RawRecord } from "./fixed-width";

/** Translation helpers from interface-file conventions to CaseFlow types. Throw on anything unexpected. */

export class MappingError extends Error {}

export function str(raw: RawRecord, field: string): string {
  const v = raw[field];
  if (typeof v !== "string") throw new MappingError(`${field} is not alphanumeric`);
  return v;
}

export function num(raw: RawRecord, field: string): number {
  const v = raw[field];
  if (typeof v !== "number") throw new MappingError(`${field} is not numeric`);
  return v;
}

/** Zero-padded digits, e.g. an SSN or ZIP stored as PIC 9(n). */
export function digits(raw: RawRecord, field: string, length: number): string {
  return String(num(raw, field)).padStart(length, "0");
}

/** "Y"/"N" indicator → boolean. */
export function indicator(raw: RawRecord, field: string): boolean {
  const v = str(raw, field);
  if (v === "Y") return true;
  if (v === "N") return false;
  throw new MappingError(`${field} must be Y or N, found "${v}"`);
}

/** CCYYMMDD → ISO date, rejecting impossible dates such as 20260231. */
export function isoDate(raw: RawRecord, field: string): string {
  const s = digits(raw, field, 8);
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) {
    throw new MappingError(`${field} is not a valid date: ${s}`);
  }
  return iso;
}

/** "LAST,FIRST M" → structured name. Case is kept as stored; the UI formats for display. */
export function personName(raw: RawRecord, field: string): PersonName {
  const v = str(raw, field);
  const [last, rest] = v.split(",").map((part) => part.trim());
  if (!last || !rest) throw new MappingError(`${field} must be "LAST,FIRST [MIDDLE]", found "${v}"`);
  const [first, ...middle] = rest.split(/\s+/);
  return { first: first!, middle: middle.length ? middle.join(" ") : null, last };
}

/** One readable line for a data-quality report. */
export function describeError(error: unknown): string {
  if (error instanceof z.ZodError) return z.prettifyError(error).replace(/\s*\n\s*/g, " ");
  if (error instanceof Error) return error.message;
  return String(error);
}
