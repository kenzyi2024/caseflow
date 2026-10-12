import type { CaseResponse } from "@caseflow/shared";
import { money, date } from "../lib/format";

/** The VaCMS household record (read-only, ADR-0006). */
export function HouseholdPanel({ view }: { view: CaseResponse }) {
  const h = view.applicant;
  if (!h) return null;
  const rows: [string, string][] = [
    ["Household size", String(h.householdSize)],
    ["Elderly or disabled member", h.hasElderlyOrDisabledMember ? "Yes" : "No"],
    ["Other income", h.monthlyUnearnedIncomeCents ? `${money(h.monthlyUnearnedIncomeCents)}/mo${h.unearnedIncomeSource ? ` (${h.unearnedIncomeSource})` : ""}` : "None"],
    ["Rent or mortgage", `${money(h.monthlyShelterCostCents)}/mo`],
    ["Pays heating or cooling", h.paysHeatingOrCooling ? "Yes" : "No"],
    ["Countable resources", money(h.countableResourcesCents)],
    ["Broad-based categorical eligibility", h.broadBasedCategoricallyEligible ? "Yes" : "No"],
    ["Preferred language", h.preferredLanguage === "es" ? "Spanish" : "English"],
    ["Date of birth", date(h.dateOfBirth)],
    ["SSN", `•••-••-${h.ssn.slice(-4)}`],
  ];
  return (
    <section aria-labelledby="household-heading" className="cf-card">
      <h2 id="household-heading" className="cf-card__title">
        VaCMS household
      </h2>
      <dl className="cf-facts">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="font-sans-3xs text-base margin-bottom-0">Read-only from the VaCMS household extract (illustrative layout).</p>
    </section>
  );
}
