import { StepIndicator, StepIndicatorStep } from "@trussworks/react-uswds";
import type { CaseResponse } from "@caseflow/shared";

type StepStatus = "complete" | "current" | "incomplete";

/**
 * The fixed pipeline (ADR-0002) as a step indicator, driven by the case's events.
 * AI steps are labeled as such so it is always clear where the model is involved.
 */
export function PipelineProgress({ view }: { view: CaseResponse }) {
  const lastRun = view.timeline.map((e) => e.type).lastIndexOf("pipeline.started");
  const run = lastRun >= 0 ? view.timeline.slice(lastRun) : [];
  const has = (type: string) => run.some((e) => e.type === type);
  const processing = view.status === "PROCESSING";

  const done = {
    intake: has("records.fetched") || has("records.failed") || has("pipeline.completed"),
    records: has("records.fetched"),
    verification: has("verification.completed"),
    determination: Boolean(view.determination),
    review: Boolean(view.approval),
    notice: Boolean(view.notice),
  };
  const steps: { key: keyof typeof done; label: string }[] = [
    { key: "intake", label: "AI reads documents" },
    { key: "records", label: "VaCMS + VEC records" },
    { key: "verification", label: "Verify income" },
    { key: "determination", label: "Rules engine" },
    { key: "review", label: "BPS review" },
    { key: "notice", label: "AI drafts notice" },
  ];

  let currentAssigned = false;
  const statusOf = (key: keyof typeof done): StepStatus => {
    if (done[key]) return "complete";
    if (currentAssigned || lastRun < 0) return "incomplete";
    if (processing || ["AWAITING_REVIEW", "MANUAL_REVIEW", "PENDING_VERIFICATION", "APPROVED"].includes(view.status)) {
      currentAssigned = true;
      return "current";
    }
    return "incomplete";
  };
  const statuses = steps.map((s) => statusOf(s.key));
  // USWDS headlines the "current" step; when everything is done, headline the last one.
  if (!statuses.some((st) => st !== "complete")) statuses[statuses.length - 1] = "current";

  return (
    <section aria-labelledby="pipeline-heading" className="cf-card cf-pipeline">
      <h2 id="pipeline-heading" className="cf-card__title">
        Pipeline
      </h2>
      <StepIndicator headingLevel="h3" counters="small" className="margin-bottom-0">
        {steps.map((s, i) => (
          <StepIndicatorStep key={s.key} label={s.label} status={statuses[i]} />
        ))}
      </StepIndicator>
      <p className="cf-pipeline__status" aria-live="polite">
        {lastRun < 0 && "Not started. Upload the applicant's documents, then run the pipeline."}
        {processing && <PipelineMessage view={view} />}
        {view.status === "AWAITING_REVIEW" && "Waiting for your review."}
        {view.status === "MANUAL_REVIEW" && "Needs manual review before it can be approved."}
        {view.status === "PENDING_VERIFICATION" && "Pended for verification. Upload the new documents and run again."}
        {view.status === "APPROVED" && (view.noticeError ? "Approved. The notice could not be drafted automatically." : "Approved. Drafting the Notice of Action…")}
        {view.status === "NOTICE_READY" && "Approved. Notice of Action ready."}
      </p>
    </section>
  );
}

function PipelineMessage({ view }: { view: CaseResponse }) {
  const pending = view.documents.filter((d) => !d.intake && !d.intakeError).length;
  if (pending > 0) return <>Claude is reading {pending} document{pending === 1 ? "" : "s"}…</>;
  return <>Checking VaCMS and VEC records and applying Virginia SNAP rules…</>;
}
