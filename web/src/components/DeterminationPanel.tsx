import { Alert, AlertText, Table, Tag } from "@trussworks/react-uswds";
import type { CaseResponse, TraceStep } from "@caseflow/shared";
import { dateTime, money } from "../lib/format";

const OUTCOME: Record<TraceStep["outcome"], { label: string; className: string }> = {
  pass: { label: "Pass", className: "bg-success" },
  fail: { label: "Fail", className: "bg-secondary-dark" },
  info: { label: "Calculated", className: "bg-base" },
  not_applicable: { label: "Not applied", className: "cf-tag--muted" },
};

const PROVISIONAL_LABEL: Record<string, string> = {
  "stateOptions.standardUtilityAllowance": "Virginia standard utility allowance",
  "stateOptions.broadBasedCategoricalEligibility.grossIncomeLimit": "Virginia BBCE gross income limit (200% of poverty)",
};

/** The decision and the full rules-engine trace, every line cited (ADR-0003). */
export function DeterminationPanel({ view }: { view: CaseResponse }) {
  const record = view.determination;
  if (!record) return null;
  const d = record.determination;
  const previous = view.determinationHistory.slice(0, -1);

  return (
    <section aria-labelledby="determination-heading" className="cf-card">
      <h2 id="determination-heading" className="cf-card__title">
        Determination
      </h2>
      <div className="cf-decision">
        <div>
          <div className="cf-decision__label">{d.eligible ? "Eligible" : "Not eligible"}</div>
          <div className="cf-decision__amount">{d.eligible ? `${money(d.monthlyBenefitCents)}` : "$0.00"}</div>
          <div className="cf-decision__unit">per month</div>
        </div>
        <ul className="cf-decision__meta">
          <li>
            <Tag className="cf-tag bg-primary">{d.eligibilityPath === "BBCE" ? "Virginia BBCE path" : "Standard federal tests"}</Tag>
          </li>
          <li>
            Policy <strong>{d.policyVersion}</strong> · applied {d.applicationDate}
          </li>
          <li>
            {record.basis === "bps_revision" ? "Recalculated after a BPS fact revision" : "From documents and VaCMS / VEC records"} · {dateTime(record.createdAt)}
          </li>
          {previous.map((p) => (
            <li key={p.eventId} className="text-base">
              Earlier: {p.determination.eligible ? `${money(p.determination.monthlyBenefitCents)}/mo` : "not eligible"} (
              {p.basis === "bps_revision" ? "after revision" : "from documents"})
            </li>
          ))}
        </ul>
      </div>

      {d.provisionalValuesUsed.length > 0 && (
        <Alert type="warning" slim className="margin-top-2">
          <AlertText>
            This determination uses provisional {d.policyVersion} Virginia values that VDSS has not yet published:{" "}
            {d.provisionalValuesUsed.map((f) => PROVISIONAL_LABEL[f] ?? f).join("; ")}. Recheck when the FY2027 transmittal is issued.
          </AlertText>
        </Alert>
      )}

      <Table fullWidth compact className="cf-trace margin-top-2" caption="How the rules engine reached this result">
        <colgroup>
          <col style={{ width: "22%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "46%" }} />
          <col style={{ width: "20%" }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">Result</th>
            <th scope="col">Explanation</th>
            <th scope="col">Citation</th>
          </tr>
        </thead>
        <tbody>
          {d.trace.map((step) => (
            <tr key={step.rule}>
              <th scope="row">{step.title}</th>
              <td>
                <Tag className={`cf-tag ${OUTCOME[step.outcome].className}`}>{OUTCOME[step.outcome].label}</Tag>
              </td>
              <td>{step.detail}</td>
              <td className="cf-citation">{step.citation}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}
