import type { PersonName } from "@caseflow/shared";

/** Common English nicknames → formal first names. Small on purpose: it raises a soft flag, never a match. */
const NICKNAMES: Record<string, string[]> = {
  ROBERT: ["BOB", "BOBBY", "ROB", "ROBBIE"],
  WILLIAM: ["BILL", "BILLY", "WILL", "LIAM"],
  JAMES: ["JIM", "JIMMY", "JAMIE"],
  MICHAEL: ["MIKE", "MIKEY"],
  ELIZABETH: ["LIZ", "BETH", "BETTY", "ELIZA"],
  JOSEPH: ["JOE", "JOEY"],
  THOMAS: ["TOM", "TOMMY"],
  RICHARD: ["RICK", "RICH", "DICK"],
  MARGARET: ["MAGGIE", "PEGGY", "MEG"],
  KATHERINE: ["KATE", "KATIE", "KATHY"],
  DOROTHY: ["DOT", "DOTTIE"],
  ANTHONY: ["TONY"],
  JOSE: ["PEPE"],
};

export type NameComparison =
  | { kind: "match" }
  | { kind: "nickname"; printedFirst: string; recordFirst: string }
  | { kind: "mismatch"; reason: string };

const tokens = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Compare a name printed on a document ("FIRST [MIDDLE] LAST") with the VaCMS name.
 * Exact first + last = match; known nickname or initial = nickname (soft flag); otherwise mismatch.
 */
export function compareNames(printed: string, record: PersonName): NameComparison {
  const words = tokens(printed);
  const last = record.last.toUpperCase();
  const first = record.first.toUpperCase();
  if (!words.includes(last)) return { kind: "mismatch", reason: `last name ${last} not found in "${printed}"` };

  const printedFirst = words[0]!;
  if (printedFirst === first) return { kind: "match" };
  if (NICKNAMES[first]?.includes(printedFirst) || (printedFirst.length === 1 && first.startsWith(printedFirst))) {
    return { kind: "nickname", printedFirst, recordFirst: first };
  }
  return { kind: "mismatch", reason: `first name ${printedFirst} does not match ${first}` };
}

/** Employer names differ in punctuation and suffixes between pay stubs and VEC filings. */
export function normalizeEmployer(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w, i, all) => !(i === all.length - 1 && /^(LLC|INC|CO|CORP|CORPORATION|COMPANY|LTD|LP)$/.test(w)))
    .join(" ");
}
