import { formatCents, type CaseStatus, type PersonName } from "@caseflow/shared";

export const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : formatCents(cents));

const title = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export const personName = (n: PersonName | null | undefined) =>
  n ? [title(n.first), n.middle ? `${n.middle.charAt(0)}.` : null, title(n.last)].filter(Boolean).join(" ") : "Unknown applicant";

export const titleCase = title;

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

/** ISO date (YYYY-MM-DD) → "Oct 5, 2026". */
export const date = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(`${iso}T00:00:00Z`)) : "—");
/** ISO timestamp → local "Oct 12, 2:05:31 PM". */
export const dateTime = (iso: string) => timeFmt.format(new Date(iso));

export const STATUS: Record<CaseStatus, { label: string; tag: string }> = {
  RECEIVED: { label: "Received", tag: "bg-base" },
  PROCESSING: { label: "Processing", tag: "bg-accent-cool-darker" },
  MANUAL_REVIEW: { label: "Manual review", tag: "bg-secondary-dark" },
  AWAITING_REVIEW: { label: "Ready for review", tag: "bg-accent-warm-dark" },
  PENDING_VERIFICATION: { label: "Pending verification", tag: "bg-primary" },
  APPROVED: { label: "Approved", tag: "bg-success" },
  NOTICE_READY: { label: "Notice ready", tag: "bg-success-dark" },
};

export const FREQUENCY: Record<string, string> = { weekly: "Weekly", biweekly: "Every 2 weeks", semimonthly: "Twice a month", monthly: "Monthly" };

/** Who did it: AI, deterministic system step, or a person. */
export function actor(id: string): { kind: "ai" | "system" | "bps"; label: string } {
  const [kind, name = ""] = id.split(":");
  const labels: Record<string, string> = {
    intake: "Intake agent",
    notice: "Notice agent",
    "rules-engine": "Rules engine",
    verification: "Verification",
    adapters: "VaCMS / VEC adapters",
    pipeline: "Pipeline",
    "vacms-sync": "VaCMS sync",
  };
  if (kind === "ai") return { kind: "ai", label: `AI · ${labels[name] ?? name}` };
  if (kind === "bps") return { kind: "bps", label: `BPS · ${name}` };
  return { kind: "system", label: labels[name] ?? name };
}

export const EVENT_LABEL: Record<string, string> = {
  "case.opened": "Case opened from VaCMS",
  "document.uploaded": "Document uploaded",
  "pipeline.started": "Pipeline started",
  "intake.completed": "Document read",
  "intake.failed": "Document could not be read",
  "records.fetched": "VaCMS household and VEC wages retrieved",
  "records.failed": "Records lookup failed",
  "verification.completed": "Income verified",
  "determination.completed": "Eligibility determined",
  "determination.failed": "Determination failed",
  "pipeline.completed": "Pipeline finished",
  "bps.revised_facts": "Facts revised",
  "bps.approved": "Determination approved",
  "bps.pended": "Pended for verification",
  "notice.drafted": "Notice of Action drafted",
  "notice.failed": "Notice could not be drafted",
};

export const FIELD_LABEL: Record<string, string> = {
  employeeName: "Employee",
  employerName: "Employer",
  payPeriodStart: "Period start",
  payPeriodEnd: "Period end",
  payDate: "Pay date",
  payFrequency: "Frequency",
  grossPayCents: "Gross pay",
  netPayCents: "Net pay",
  ytdGrossCents: "YTD gross",
};

export const dollarsToCents = (dollars: string) => Math.round(Number(dollars.replace(/[$,\s]/g, "")) * 100);
export const centsToDollarString = (cents: number) => (cents / 100).toFixed(2);
