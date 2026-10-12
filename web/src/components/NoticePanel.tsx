import { useState } from "react";
import { Alert, AlertHeading, AlertText, Button, ButtonGroup } from "@trussworks/react-uswds";
import type { CaseResponse, NoticeLanguage } from "@caseflow/shared";
import { dateTime } from "../lib/format";

/** The bilingual Notice of Action, plus proof of what the AI saw and which checks it passed (ADR-0007). */
export function NoticePanel({ view, onRetry }: { view: CaseResponse; onRetry: () => void }) {
  const notice = view.notice;
  const [language, setLanguage] = useState<NoticeLanguage | null>(null);

  if (view.noticeError && !notice) {
    return (
      <section aria-labelledby="notice-heading" className="cf-card">
        <h2 id="notice-heading" className="cf-card__title">
          Notice of Action
        </h2>
        <Alert type="error">
          <AlertHeading level="h3">The notice could not be drafted automatically</AlertHeading>
          <AlertText>
            {view.noticeError.message}
            {view.noticeError.guardErrors.length > 0 && (
              <ul>
                {view.noticeError.guardErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </AlertText>
        </Alert>
        <Button type="button" outline onClick={onRetry} className="margin-top-2">
          Try drafting again
        </Button>
      </section>
    );
  }
  if (!notice) return null;

  const shown = language ?? notice.preferredLanguage;
  const order: NoticeLanguage[] = notice.preferredLanguage === "es" ? ["es", "en"] : ["en", "es"];
  const label = { en: "English", es: "Español" } as const;

  return (
    <section aria-labelledby="notice-heading" className="cf-card">
      <div className="cf-card__header">
        <h2 id="notice-heading" className="cf-card__title margin-bottom-0">
          Notice of Action
        </h2>
        <ButtonGroup type="segmented" aria-label="Notice language">
          {order.map((l) => (
            <Button key={l} type="button" outline={shown !== l} onClick={() => setLanguage(l)} aria-pressed={shown === l}>
              {label[l]}
              {l === notice.preferredLanguage ? " (preferred)" : ""}
            </Button>
          ))}
        </ButtonGroup>
      </div>
      <p className="font-sans-2xs text-base">
        Drafted by {notice.model.served} in {(notice.model.latencyMs / 1000).toFixed(1)} s · passed {notice.guard.passedChecks.length} automated checks on
        attempt {notice.guard.attempts} ({notice.guard.passedChecks.join(", ")}) · {dateTime(notice.createdAt)}
      </p>
      <pre className="cf-notice" lang={shown} tabIndex={0} aria-label={`Notice text in ${label[shown]}`}>
        {notice.versions[shown].fullText}
      </pre>
      <details className="margin-top-2">
        <summary>What the AI saw (no name, SSN, case number or address)</summary>
        <pre className="cf-json">{JSON.stringify(notice.factsSentToModel, null, 2)}</pre>
      </details>
    </section>
  );
}
