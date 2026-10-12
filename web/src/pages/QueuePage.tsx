import { Link, useNavigate } from "react-router-dom";
import { Alert, AlertText, Table } from "@trussworks/react-uswds";
import { useCases } from "../lib/hooks";
import { date, money, personName } from "../lib/format";
import { DaysTag, StatusTag } from "../components/StatusTag";

export function QueuePage() {
  const { data: cases, error } = useCases();
  const navigate = useNavigate();

  const needsAction = cases?.filter((c) => c.status === "MANUAL_REVIEW" || c.flags.actionRequired > 0).length ?? 0;
  const readyForReview = cases?.filter((c) => c.status === "AWAITING_REVIEW").length ?? 0;
  const notStarted = cases?.filter((c) => c.status === "RECEIVED").length ?? 0;

  return (
    <>
      <h1 className="margin-top-0">Work queue</h1>
      <p className="usa-intro margin-top-0">SNAP applications from VaCMS for Arlington County. Federal rules require a decision within 30 days.</p>

      {error && (
        <Alert type="error" slim>
          <AlertText>{error} Is the API running (npm run dev)?</AlertText>
        </Alert>
      )}

      {cases && (
        <>
          <ul className="cf-stats" aria-label="Queue summary">
            <li>
              <span className="cf-stats__value">{cases.length}</span> open applications
            </li>
            <li>
              <span className="cf-stats__value">{notStarted}</span> not started
            </li>
            <li>
              <span className="cf-stats__value">{readyForReview}</span> ready for review
            </li>
            <li className={needsAction ? "cf-stats__alert" : undefined}>
              <span className="cf-stats__value">{needsAction}</span> need action
            </li>
          </ul>

          <Table fullWidth striped className="cf-queue">
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">Applicant</th>
                <th scope="col">Household</th>
                <th scope="col">Applied</th>
                <th scope="col">Decision due</th>
                <th scope="col">Status</th>
                <th scope="col">Flags</th>
                <th scope="col" className="text-right">
                  Benefit
                </th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.caseNumber} className="cf-row-link" onClick={() => navigate(`/cases/${c.caseNumber}`)}>
                  <th scope="row">
                    <Link to={`/cases/${c.caseNumber}`} onClick={(e) => e.stopPropagation()}>
                      {c.caseNumber}
                    </Link>
                  </th>
                  <td>{personName(c.applicant)}</td>
                  <td>{c.householdSize ?? "—"}</td>
                  <td>{date(c.applicationDate)}</td>
                  <td>
                    <DaysTag days={c.daysRemaining} />
                  </td>
                  <td>
                    <StatusTag status={c.status} />
                  </td>
                  <td>
                    {c.flags.actionRequired > 0 && <span className="cf-flag cf-flag--action">{c.flags.actionRequired} action needed</span>}
                    {c.flags.warnings > 0 && (
                      <span className="cf-flag cf-flag--warning">
                        {c.flags.warnings} to check
                      </span>
                    )}
                    {c.flags.actionRequired === 0 && c.flags.warnings === 0 && <span className="text-base">—</span>}
                  </td>
                  <td className="text-right text-tabular">
                    {c.determination ? (c.determination.eligible ? `${money(c.determination.monthlyBenefitCents)}/mo` : "Not eligible") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
      {!cases && !error && <p>Loading cases…</p>}
    </>
  );
}
