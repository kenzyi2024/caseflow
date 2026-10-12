import type { CaseEvent, CaseResponse } from "@caseflow/shared";
import { EVENT_LABEL, actor, dateTime, money } from "../lib/format";

/** One-line detail for the events where it matters. */
function detail(e: CaseEvent): string | null {
  switch (e.type) {
    case "document.uploaded":
      return e.payload.fileName;
    case "intake.completed":
      return e.payload.result.documentType === "pay_stub"
        ? `${e.payload.result.paystub?.employerName.value ?? "pay stub"}, gross ${money(e.payload.result.paystub?.grossPayCents.value)}`
        : e.payload.result.documentDescription;
    case "intake.failed":
    case "records.failed":
    case "determination.failed":
      return e.payload.message;
    case "verification.completed":
      return e.payload.flags.length ? `${e.payload.flags.length} flag(s): ${e.payload.flags.map((f) => f.code).join(", ")}` : "no flags";
    case "determination.completed":
      return `${e.payload.determination.eligible ? `${money(e.payload.determination.monthlyBenefitCents)}/mo` : "not eligible"} · ${e.payload.determination.policyVersion}`;
    case "pipeline.completed":
      return e.payload.outcome === "manual_review" ? "needs manual review" : "ready for review";
    case "bps.revised_facts":
    case "bps.pended":
      return e.payload.reason;
    case "bps.approved":
      return e.payload.note;
    case "notice.failed":
      return e.payload.message;
    default:
      return null;
  }
}

/** The append-only event log, as the auditor sees it (ADR-0005). Newest first. */
export function AuditTimeline({ view }: { view: CaseResponse }) {
  const events = [...view.timeline].reverse();
  return (
    <section aria-labelledby="audit-heading" className="cf-card">
      <h2 id="audit-heading" className="cf-card__title">
        Audit trail <span className="text-normal font-sans-sm">({view.timeline.length} events, append-only)</span>
      </h2>
      <ol className="cf-timeline" aria-live="polite">
        {events.map((e) => {
          const who = actor(e.actor);
          const extra = detail(e);
          return (
            <li key={e.id} className={`cf-timeline__item cf-timeline__item--${who.kind}`}>
              <div className="cf-timeline__head">
                <span className="cf-timeline__label">{EVENT_LABEL[e.type] ?? e.type}</span>
                <time dateTime={e.createdAt}>{dateTime(e.createdAt)}</time>
              </div>
              <div className="cf-timeline__actor">{who.label}</div>
              {extra && <div className="cf-timeline__detail">{extra}</div>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
