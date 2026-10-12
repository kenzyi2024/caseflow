import { useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, AlertHeading, AlertText } from "@trussworks/react-uswds";
import { useCase } from "../lib/hooks";
import { api } from "../lib/api";
import { date, personName, titleCase } from "../lib/format";
import { ActionsPanel, type ActionsHandle } from "../components/ActionsPanel";
import { AuditTimeline } from "../components/AuditTimeline";
import { DeterminationPanel } from "../components/DeterminationPanel";
import { DocumentsPanel } from "../components/DocumentsPanel";
import { HouseholdPanel } from "../components/HouseholdPanel";
import { NoticePanel } from "../components/NoticePanel";
import { PipelineProgress } from "../components/PipelineProgress";
import { DaysTag, StatusTag } from "../components/StatusTag";
import { VerificationPanel } from "../components/VerificationPanel";

export function CasePage() {
  const { caseNumber = "" } = useParams();
  const { data: view, error } = useCase(caseNumber);
  const actions = useRef<ActionsHandle>(null);

  if (error) {
    return (
      <Alert type="error" slim>
        <AlertText>
          {error} <Link to="/">Back to the work queue</Link>
        </AlertText>
      </Alert>
    );
  }
  if (!view) return <p>Loading case {caseNumber}…</p>;

  const h = view.applicant;
  const canRevise = Boolean(view.determination) && !["APPROVED", "NOTICE_READY", "PROCESSING"].includes(view.status);

  return (
    <>
      <nav aria-label="Breadcrumb" className="cf-breadcrumb">
        <Link to="/">Work queue</Link> <span aria-hidden="true">›</span> Case {view.caseNumber}
      </nav>

      <div className="cf-case-header">
        <div>
          <h1 className="margin-y-0">{personName(h?.headOfHousehold)}</h1>
          <p className="margin-y-05 text-base">
            Case {view.caseNumber} · applied {date(view.applicationDate)} · decision due {date(view.processingDeadline)}
            {h && (
              <>
                {" "}
                · {titleCase(h.address.line1)}, {titleCase(h.address.city)} {h.address.state}
              </>
            )}
          </p>
        </div>
        <div className="cf-case-header__tags">
          <StatusTag status={view.status} />
          <DaysTag days={view.daysRemaining} />
        </div>
      </div>

      <PipelineProgress view={view} />

      {view.status === "MANUAL_REVIEW" && view.manualReviewReasons.length > 0 && (
        <Alert type="error" className="margin-top-3">
          <AlertHeading level="h2">Manual review needed</AlertHeading>
          <AlertText>
            <ul className="margin-y-0">
              {view.manualReviewReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            A BPS can complete the case by entering verified facts (Revise facts).
          </AlertText>
        </Alert>
      )}
      {view.pended && view.status === "PENDING_VERIFICATION" && (
        <Alert type="info" slim className="margin-top-3">
          <AlertText>
            Pended by {view.pended.actor.replace("bps:", "")}: {view.pended.reason}
          </AlertText>
        </Alert>
      )}

      <div className="grid-row grid-gap-lg margin-top-3">
        <div className="desktop:grid-col-8">
          <NoticePanel view={view} onRetry={() => void api.retryNotice(view.caseNumber)} />
          <DeterminationPanel view={view} />
          <VerificationPanel view={view} canRevise={canRevise} onApplySuggestion={(flag) => actions.current?.openRevise(flag)} />
          <DocumentsPanel view={view} />
        </div>
        <aside className="desktop:grid-col-4" aria-label="Case actions and history">
          <ActionsPanel ref={actions} view={view} />
          <HouseholdPanel view={view} />
          <AuditTimeline view={view} />
        </aside>
      </div>
    </>
  );
}
