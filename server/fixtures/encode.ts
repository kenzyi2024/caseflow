import type { HouseholdRecord, WageRecord } from "@caseflow/shared";
import type { RawRecord } from "../src/integrations/fixed-width";

/** Inverse of the adapters' mapping: CaseFlow types → interface-file field values. For synthetic fixtures only. */

const yyyymmdd = (iso: string) => Number(iso.replaceAll("-", ""));
const yn = (b: boolean) => (b ? "Y" : "N");

export function householdToRaw(h: HouseholdRecord): RawRecord {
  const { first, middle, last } = h.headOfHousehold;
  return {
    "HH-CASE-NUMBER": h.caseNumber,
    "HH-LOCALITY-FIPS": Number(h.localityFips),
    "HH-HEAD-NAME": `${last},${first}${middle ? ` ${middle}` : ""}`,
    "HH-SSN": Number(h.ssn),
    "HH-DOB": yyyymmdd(h.dateOfBirth),
    "HH-APPL-DATE": yyyymmdd(h.applicationDate),
    "HH-SIZE": h.householdSize,
    "HH-ELD-DIS-IND": yn(h.hasElderlyOrDisabledMember),
    "HH-BBCE-IND": yn(h.broadBasedCategoricallyEligible),
    "HH-UNEARNED-AMT": h.monthlyUnearnedIncomeCents,
    "HH-UNEARNED-SRC": h.unearnedIncomeSource ?? "NONE",
    "HH-SHELTER-AMT": h.monthlyShelterCostCents,
    "HH-HEAT-COOL-IND": yn(h.paysHeatingOrCooling),
    "HH-RESOURCES-AMT": h.countableResourcesCents,
    "HH-LANG-CD": h.preferredLanguage.toUpperCase(),
    "HH-ADDR-LINE-1": h.address.line1,
    "HH-ADDR-CITY": h.address.city,
    "HH-ADDR-STATE": h.address.state,
    "HH-ADDR-ZIP": Number(h.address.zip),
  };
}

export function wageToRaw(w: WageRecord): RawRecord {
  const [year, quarter] = w.quarter.split("-Q");
  return {
    "WG-SSN": Number(w.ssn),
    "WG-EMPLOYEE-NAME": w.employeeName,
    "WG-EMPLOYER-ACCT": Number(w.employerAccount),
    "WG-EMPLOYER-NAME": w.employerName,
    "WG-YEAR": Number(year),
    "WG-QTR": Number(quarter),
    "WG-WAGES-AMT": w.wagesCents,
  };
}
