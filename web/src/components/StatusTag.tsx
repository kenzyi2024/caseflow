import { Tag } from "@trussworks/react-uswds";
import type { CaseStatus } from "@caseflow/shared";
import { STATUS } from "../lib/format";

export function StatusTag({ status }: { status: CaseStatus }) {
  return <Tag className={`cf-tag ${STATUS[status].tag}`}>{STATUS[status].label}</Tag>;
}

export function DaysTag({ days }: { days: number | null }) {
  if (days === null) return <span>—</span>;
  const tone = days < 0 ? "bg-secondary-dark" : days <= 5 ? "bg-secondary" : days <= 10 ? "bg-accent-warm-dark" : "bg-base";
  return <Tag className={`cf-tag ${tone}`}>{days < 0 ? `${-days} days overdue` : `${days} days left`}</Tag>;
}
