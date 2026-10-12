import { Alert, AlertText, Table, Tag } from "@trussworks/react-uswds";
import type { CaseResponse, PaystubField } from "@caseflow/shared";
import { api } from "../lib/api";
import { FIELD_LABEL, FREQUENCY, date, money } from "../lib/format";

const FIELDS: PaystubField[] = ["employeeName", "employerName", "payPeriodStart", "payPeriodEnd", "payDate", "payFrequency", "grossPayCents", "netPayCents", "ytdGrossCents"];

function display(field: PaystubField, value: string | number | null): string {
  if (value === null) return "—";
  if (field.endsWith("Cents")) return money(value as number);
  if (field === "payFrequency") return FREQUENCY[value as string] ?? String(value);
  if (field.startsWith("pay") && typeof value === "string" && /^\d{4}-/.test(value)) return date(value);
  return String(value);
}

/** What the intake agent read from each document, with the evidence and the code's verification of it (ADR-0007). */
export function DocumentsPanel({ view }: { view: CaseResponse }) {
  if (view.documents.length === 0) return null;
  return (
    <section aria-labelledby="documents-heading" className="cf-card">
      <h2 id="documents-heading" className="cf-card__title">
        Documents <span className="text-normal font-sans-sm">({view.documents.length})</span>
      </h2>
      {view.documents.map((doc) => (
        <details key={doc.documentId} className="cf-doc" open={view.documents.length <= 2}>
          <summary>
            <span className="cf-doc__name">{doc.fileName}</span>
            {doc.intake?.documentType === "pay_stub" && <Tag className="cf-tag bg-primary">Pay stub</Tag>}
            {doc.intake?.documentType === "other" && <Tag className="cf-tag bg-base">Not a pay stub</Tag>}
            {doc.intakeError && <Tag className="cf-tag bg-secondary-dark">Could not read</Tag>}
            {doc.intake?.needsManualReview && <Tag className="cf-tag bg-secondary-dark">Needs review</Tag>}
            {!doc.intake && !doc.intakeError && <Tag className="cf-tag cf-tag--muted">Not read yet</Tag>}
          </summary>

          <p className="font-sans-2xs text-base margin-y-1">
            <a href={api.documentUrl(view.caseNumber, doc.documentId)} target="_blank" rel="noreferrer">
              Open PDF
            </a>
            {doc.intake && (
              <>
                {" "}
                · read by {doc.intake.model.served} in {(doc.intake.model.latencyMs / 1000).toFixed(1)} s · evidence {doc.intake.textLayer ? "checked against the PDF text" : "not checkable (no text layer)"}
              </>
            )}
          </p>

          {doc.intakeError && (
            <Alert type="error" slim>
              <AlertText>{doc.intakeError.message}</AlertText>
            </Alert>
          )}

          {doc.intake?.documentType === "other" && <p className="margin-top-0">{doc.intake.documentDescription}. Not used as income evidence.</p>}

          {doc.intake?.paystub && (
            <Table fullWidth compact className="cf-fields">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Value</th>
                  <th scope="col">Evidence on the document</th>
                  <th scope="col" className="text-right">
                    Confidence
                  </th>
                  <th scope="col">Verified</th>
                </tr>
              </thead>
              <tbody>
                {FIELDS.map((f) => {
                  const x = doc.intake!.paystub![f];
                  return (
                    <tr key={f} className={x.confidence < 0.8 || x.evidenceVerified === false ? "cf-row-alert" : undefined}>
                      <th scope="row">{FIELD_LABEL[f]}</th>
                      <td className="text-tabular">{display(f, x.value)}</td>
                      <td>{x.evidence ? <q className="cf-evidence">{x.evidence}</q> : "—"}</td>
                      <td className="text-right text-tabular">{Math.round(x.confidence * 100)}%</td>
                      <td>
                        {x.evidenceVerified === true && <span className="cf-ok">✓ on document</span>}
                        {x.evidenceVerified === false && <span className="cf-bad">✗ not found</span>}
                        {x.evidenceVerified === null && <span className="text-base">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}

          {doc.intake && doc.intake.flags.filter((f) => f.code !== "NOT_A_PAYSTUB").length > 0 && (
            <ul className="cf-intake-flags">
              {doc.intake.flags
                .filter((f) => f.code !== "NOT_A_PAYSTUB")
                .map((f, i) => (
                  <li key={i} className={f.severity === "critical" ? "cf-bad" : undefined}>
                    {f.message}
                  </li>
                ))}
            </ul>
          )}
          {doc.intake && doc.intake.observations.length > 0 && (
            <p className="font-sans-xs">
              <strong>Model notes:</strong> {doc.intake.observations.join(" ")}
            </p>
          )}
        </details>
      ))}
    </section>
  );
}
