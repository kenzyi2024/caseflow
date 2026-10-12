/**
 * Minimal COBOL copybook reader for fixed-width interface layouts (ADR-0006).
 *
 * Supported: level numbers, group items, elementary items with PIC X(n), 9(n), 9(n)V9(m)
 * (repeated symbols such as XX or 99 also work), and FILLER.
 * Anything else (signed S9, COMP/COMP-3 packed fields, OCCURS, REDEFINES, edited pictures)
 * is rejected loudly rather than mis-parsed: a wrong offset silently corrupts every field after it.
 */

export type FieldKind = "alphanumeric" | "numeric";

export interface CopybookField {
  name: string;
  level: number;
  picture: string;
  kind: FieldKind;
  /** Zero-based character offset within the record. */
  offset: number;
  length: number;
  /** Implied decimal places (the digits after V). 2 for money stored as cents. */
  scale: number;
  filler: boolean;
}

export interface CopybookLayout {
  recordName: string;
  recordLength: number;
  fields: CopybookField[];
}

export class CopybookError extends Error {}

const UNSUPPORTED = /\b(COMP(?:-\d)?|COMPUTATIONAL(?:-\d)?|BINARY|PACKED-DECIMAL|OCCURS|REDEFINES|SIGN|VALUE)\b/;

export function parseCopybook(source: string): CopybookLayout {
  const code = source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("*"))
    .map((line) => line.replace(/\*>.*$/, ""))
    .join(" ");

  const statements = code
    .split(/\.(?=\s|$)/)
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  let recordName: string | null = null;
  const fields: CopybookField[] = [];
  let offset = 0;

  for (const stmt of statements) {
    const match = /^(\d{2}) ([A-Z0-9-]+)(?: (.*))?$/i.exec(stmt);
    if (!match) throw new CopybookError(`Cannot parse copybook statement: "${stmt}"`);
    const level = Number(match[1]);
    const name = match[2]!.toUpperCase();
    const rest = (match[3] ?? "").toUpperCase();

    if (UNSUPPORTED.test(rest)) throw new CopybookError(`Unsupported clause in ${name}: "${rest}"`);

    const pic = /^PIC(?:TURE)?(?: IS)? (\S+)$/.exec(rest);
    if (!pic) {
      if (rest) throw new CopybookError(`Unsupported clause in ${name}: "${rest}"`);
      // Group item: contributes no length of its own.
      if (level === 1) {
        if (recordName) throw new CopybookError(`Multiple 01-level records (${recordName}, ${name}) are not supported`);
        recordName = name;
      }
      continue;
    }

    const { kind, length, scale } = parsePicture(pic[1]!, name);
    fields.push({ name, level, picture: pic[1]!, kind, offset, length, scale, filler: name === "FILLER" });
    offset += length;
  }

  if (!recordName) throw new CopybookError("Copybook has no 01-level record");
  if (fields.length === 0) throw new CopybookError(`Record ${recordName} has no elementary fields`);
  const names = fields.filter((f) => !f.filler).map((f) => f.name);
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate) throw new CopybookError(`Duplicate field name ${duplicate}`);

  return { recordName, recordLength: offset, fields };
}

function parsePicture(picture: string, field: string): { kind: FieldKind; length: number; scale: number } {
  let alnum = 0;
  let integerDigits = 0;
  let scale = 0;
  let afterV = false;
  let consumed = 0;

  for (const m of picture.matchAll(/([X9V])(?:\((\d+)\))?/g)) {
    if (m.index !== consumed) break;
    consumed += m[0].length;
    const count = m[2] ? Number(m[2]) : 1;
    if (m[1] === "X") alnum += count;
    else if (m[1] === "V") {
      if (afterV || m[2]) throw new CopybookError(`Invalid V in PIC ${picture} (${field})`);
      afterV = true;
    } else if (afterV) scale += count;
    else integerDigits += count;
  }

  if (consumed !== picture.length) throw new CopybookError(`Unsupported PIC ${picture} (${field})`);
  if (alnum > 0 && integerDigits + scale > 0) throw new CopybookError(`Mixed alphanumeric/numeric PIC ${picture} (${field})`);
  if (alnum > 0) {
    if (afterV) throw new CopybookError(`V in alphanumeric PIC ${picture} (${field})`);
    return { kind: "alphanumeric", length: alnum, scale: 0 };
  }
  if (integerDigits + scale === 0) throw new CopybookError(`Empty PIC ${picture} (${field})`);
  return { kind: "numeric", length: integerDigits + scale, scale };
}

/** Fail fast if a layout no longer matches what the mapping code assumes (e.g. money no longer in cents). */
export function assertField(layout: CopybookLayout, name: string, expected: { kind: FieldKind; scale?: number }): void {
  const field = layout.fields.find((f) => f.name === name);
  if (!field) throw new CopybookError(`${layout.recordName} has no field ${name}`);
  if (field.kind !== expected.kind || (expected.scale !== undefined && field.scale !== expected.scale)) {
    throw new CopybookError(
      `${name} is ${field.kind} scale ${field.scale}; mapping expects ${expected.kind}${expected.scale !== undefined ? ` scale ${expected.scale}` : ""}`,
    );
  }
}
