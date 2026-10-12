import {
  PROCESSING_STANDARD_DAYS,
  type CaseEvent,
  type CaseEventOf,
  type CaseView,
  type EligibilityInput,
} from "@caseflow/shared";

export type { CaseDocument, CaseView, DeterminationRecord } from "@caseflow/shared";

/**
 * Current state of a case, rebuilt from its events every time (ADR-0005).
 * Pure: the same events always produce the same view.
 */

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function projectCase(caseNumber: string, events: CaseEvent[]): CaseView {
  const view: CaseView = {
    caseNumber,
    status: "RECEIVED",
    manualReviewReasons: [],
    household: null,
    applicationDate: null,
    processingDeadline: null,
    documents: [],
    wageRecords: [],
    verification: null,
    revisions: [],
    determination: null,
    determinationHistory: [],
    openActionFlags: [],
    approval: null,
    pended: null,
    notice: null,
    noticeError: null,
    timeline: events,
  };

  let running = false;
  let lastOutcome: CaseEventOf<"pipeline.completed">["payload"] | null = null;
  const doc = (id: string) => view.documents.find((d) => d.documentId === id);

  for (const e of events) {
    switch (e.type) {
      case "case.opened":
        break;
      case "document.uploaded":
        view.documents.push({ ...e.payload, uploadedAt: e.createdAt, intake: null, intakeError: null });
        break;
      case "pipeline.started":
        running = true;
        break;
      case "intake.completed": {
        const d = doc(e.payload.documentId);
        if (d) Object.assign(d, { intake: e.payload.result, intakeError: null });
        break;
      }
      case "intake.failed": {
        const d = doc(e.payload.documentId);
        if (d) Object.assign(d, { intake: null, intakeError: { reason: e.payload.reason, message: e.payload.message } });
        break;
      }
      case "records.fetched":
        view.household = e.payload.household;
        view.wageRecords = e.payload.wageRecords;
        view.applicationDate = e.payload.household.applicationDate;
        view.processingDeadline = addDays(e.payload.household.applicationDate, PROCESSING_STANDARD_DAYS);
        break;
      case "records.failed":
      case "determination.failed":
        break;
      case "verification.completed":
        view.verification = { ...e.payload, eventId: e.id };
        view.revisions = [];
        break;
      case "determination.completed": {
        const record = { eventId: e.id, createdAt: e.createdAt, ...e.payload };
        view.determination = record;
        view.determinationHistory.push(record);
        view.approval = null;
        view.pended = null;
        view.notice = null;
        view.noticeError = null;
        if (e.payload.basis === "bps_revision") {
          // A BPS entering verified facts resolves manual review.
          view.status = "AWAITING_REVIEW";
          view.manualReviewReasons = [];
        }
        break;
      }
      case "pipeline.completed":
        running = false;
        lastOutcome = e.payload;
        view.status = e.payload.outcome === "manual_review" ? "MANUAL_REVIEW" : "AWAITING_REVIEW";
        view.manualReviewReasons = e.payload.reasons;
        break;
      case "bps.revised_facts":
        view.revisions.push({ eventId: e.id, actor: e.actor, createdAt: e.createdAt, ...e.payload });
        break;
      case "bps.approved":
        view.approval = { actor: e.actor, createdAt: e.createdAt, note: e.payload.note };
        view.status = "APPROVED";
        break;
      case "bps.pended":
        view.pended = { actor: e.actor, createdAt: e.createdAt, reason: e.payload.reason };
        view.status = "PENDING_VERIFICATION";
        break;
      case "notice.drafted":
        view.notice = { ...e.payload, eventId: e.id, createdAt: e.createdAt };
        view.noticeError = null;
        if (view.approval) view.status = "NOTICE_READY";
        break;
      case "notice.failed":
        view.noticeError = { ...e.payload, createdAt: e.createdAt };
        break;
    }
  }

  if (running) view.status = "PROCESSING";
  else if (!lastOutcome && !view.determination) view.status = "RECEIVED";

  // Action-required flags stay open until a BPS revises facts against this verification.
  view.openActionFlags =
    view.verification && view.revisions.length === 0 ? view.verification.flags.filter((f) => f.severity === "action_required") : [];

  return view;
}

/** The facts for the next determination: the verification's facts with every later BPS revision applied in order. */
export function effectiveInput(view: CaseView): EligibilityInput | null {
  if (!view.verification) return null;
  return view.revisions.reduce<EligibilityInput>((input, r) => ({ ...input, ...r.changes }), view.verification.eligibilityInput);
}
