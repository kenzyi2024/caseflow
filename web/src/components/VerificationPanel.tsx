import { Alert, AlertHeading, AlertText, Button, Table } from "@trussworks/react-uswds";
import type { CaseResponse, VerificationFlag } from "@caseflow/shared";
import { FREQUENCY, money } from "../lib/format";

const SEVERITY: Record<VerificationFlag["severity"], { alert: "error" | "warning" | "info"; label: string }> = {
  action_required: { alert: "error", label: "Action required" },
  warning: { alert: "warning", label: "Check" },
  info: { alert: "info", label: "Note" },
};

/** Pay stubs vs VEC wage match, and every verification flag with its citation and suggested fix. */
export function VerificationPanel({
  view,
  canRevise,
  onApplySuggestion,
}: {
  view: CaseResponse;
  canRevise: boolean;
  onApplySuggestion: (flag: VerificationFlag) => void;
}) {
  const v = view.verification;
  if (!v) return null;
  const resolved = view.revisions.length > 0;

  return (
    <section aria-labelledby="verification-heading" className="cf-card">
      <h2 id="verification-heading" className="cf-card__title">
        Income verification
      </h2>

      {v.flags.length === 0 && (
        <Alert type="success" slim>
          <AlertText>Pay stubs match the VEC wage record and the VaCMS household. No issues found.</AlertText>
        </Alert>
      )}

      {v.flags.map((flag, i) => (
        <Alert key={`${flag.code}-${i}`} type={SEVERITY[flag.severity].alert} className="margin-bottom-2">
          <AlertHeading level="h3">
            {SEVERITY[flag.severity].label}: {flag.code.replaceAll("_", " ").toLowerCase()}
            {resolved && flag.severity === "action_required" && <span className="cf-resolved"> · addressed by a fact revision</span>}
          </AlertHeading>
          <AlertText>
            {flag.message}
            <span className="cf-citation display-block margin-top-05">{flag.citation}</span>
          </AlertText>
          {flag.suggestedChange && canRevise && !resolved && (
            <Button type="button" className="margin-top-1" onClick={() => onApplySuggestion(flag)}>
              {flag.suggestedChange.label}…
            </Button>
          )}
        </Alert>
      ))}

      <Table fullWidth compact className="margin-top-2" caption="Monthly earned income: pay stubs compared with the VEC wage match">
        <thead>
          <tr>
            <th scope="col">Employer</th>
            <th scope="col">Pay stubs</th>
            <th scope="col" className="text-right">
              Monthly (stubs)
            </th>
            <th scope="col" className="text-right">
              Monthly (VEC {v.vec.quarter ?? "—"})
            </th>
          </tr>
        </thead>
        <tbody>
          {v.incomeSources.map((s) => {
            const vec = v.vec.byEmployer.find((r) => r.employerName === s.employerName);
            return (
              <tr key={s.employerName}>
                <th scope="row">{s.employerName}</th>
                <td>
                  {s.documentIds.length} × {money(s.grossPerPeriodCents)} {FREQUENCY[s.payFrequency]?.toLowerCase()}
                </td>
                <td className="text-right text-tabular">{money(s.monthlyCents)}</td>
                <td className="text-right text-tabular">{vec ? money(vec.monthlyCents) : "—"}</td>
              </tr>
            );
          })}
          {v.vec.byEmployer
            .filter((r) => !r.matchesPaystub)
            .map((r) => (
              <tr key={r.employerName} className="cf-row-alert">
                <th scope="row">{r.employerName}</th>
                <td>No pay stub provided</td>
                <td className="text-right">—</td>
                <td className="text-right text-tabular">{money(r.monthlyCents)}</td>
              </tr>
            ))}
          {v.incomeSources.length === 0 && v.vec.byEmployer.length === 0 && (
            <tr>
              <td colSpan={4}>No earned income on pay stubs or in VEC records.</td>
            </tr>
          )}
        </tbody>
      </Table>
      <p className="font-sans-2xs text-base margin-bottom-0">
        Pay converted to monthly with Virginia's factors (weekly × 4.3, every 2 weeks × 2.15, twice a month × 2). VEC monthly = quarter ÷ 3. Wage-match
        differences are leads to follow up (IEVS), never applied automatically.
      </p>
    </section>
  );
}
