import { Alert, AlertHeading, AlertText } from "@trussworks/react-uswds";
import { usePolicies } from "../lib/hooks";
import { date } from "../lib/format";

/** Policy as versioned data (ADR-0003): what each version is, where its numbers come from, what is provisional. */
export function PoliciesPage() {
  const { data: policies, error } = usePolicies();
  return (
    <>
      <h1 className="margin-top-0">Policy versions</h1>
      <p className="usa-intro margin-top-0">
        Virginia SNAP rules are stored as versioned data. Each application is decided under the version in effect on its application date.
      </p>
      {error && <Alert type="error" slim><AlertText>{error}</AlertText></Alert>}
      {policies?.map((p) => (
        <section key={p.version} className="cf-card margin-bottom-3" aria-labelledby={`policy-${p.version}`}>
          <h2 id={`policy-${p.version}`} className="margin-top-0">
            {p.version} <span className="text-normal font-sans-sm">· {date(p.effectiveFrom)} to {date(p.effectiveTo)}</span>
          </h2>
          <p className="margin-top-0">{p.title}</p>
          <p className="font-sans-2xs text-base">{p.manualReference}</p>
          {p.provisional.length > 0 && (
            <Alert type="warning">
              <AlertHeading level="h3">Provisional values</AlertHeading>
              <AlertText>
                <ul className="margin-y-0">
                  {p.provisional.map((pv) => (
                    <li key={pv.field}>
                      <code>{pv.field}</code>: {pv.reason}
                    </li>
                  ))}
                </ul>
              </AlertText>
            </Alert>
          )}
          <h3 className="font-sans-sm">Sources</h3>
          <ul className="font-sans-xs">
            {p.sources.map((s) => (
              <li key={s.label}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.label}
                  </a>
                ) : (
                  s.label
                )}
                <span className="text-base"> · covers {s.covers}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
