import {
  formatCents,
  type HouseholdRecord,
  type IncomeFrequency,
  type IncomeSource,
  type IntakeResult,
  type Policy,
  type VerificationFlag,
  type VerificationResult,
  type WageRecord,
} from "@caseflow/shared";
import { toMonthlyCents } from "../rules/income";
import { compareNames, normalizeEmployer } from "./names";

/**
 * Income verification (SPEC F5). Deterministic: no AI (ADR-0002).
 *
 * - Builds monthly earned income from the pay stubs intake accepted, using Virginia's conversion factors.
 * - Compares it with the VEC quarterly wage match. Under IEVS, a wage-match difference is a lead for the
 *   BPS to follow up, not proof: it raises a flag and a suggested correction, it never changes income by itself.
 * - Checks the name on each pay stub against VaCMS, and that stubs are recent.
 */

export const INCOME_MISMATCH_THRESHOLD = 0.1;
export const PAYSTUB_MAX_AGE_DAYS = 30;

const CITE = {
  ievs: "7 CFR 272.8 (IEVS) · VDSS Manual Pt. XI.C",
  identity: "7 CFR 273.2(f)(1)(vii)",
  recency: "7 CFR 273.10(c)(1)(ii)",
  conversion: "7 CFR 273.10(c)(2) · 22VAC40-601-20",
  guardrails: "ADR-0007",
};

export interface VerificationDocument {
  documentId: string;
  fileName: string;
  intake: IntakeResult;
}

export interface VerificationInput {
  household: HouseholdRecord;
  wageRecords: WageRecord[];
  documents: VerificationDocument[];
  policy: Policy;
}

const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);

export function verifyIncome({ household, wageRecords, documents, policy }: VerificationInput): VerificationResult {
  const flags: VerificationFlag[] = [];
  const name = household.headOfHousehold;
  const recordName = [name.first, name.middle, name.last].filter(Boolean).join(" ");

  // 1. Which documents can be used as income evidence.
  const used: VerificationDocument[] = [];
  const excludedDocumentIds: string[] = [];
  for (const doc of documents) {
    if (doc.intake.documentType !== "pay_stub" || !doc.intake.paystub) continue;
    if (doc.intake.needsManualReview) {
      excludedDocumentIds.push(doc.documentId);
      flags.push({
        code: "DOCUMENT_NEEDS_REVIEW",
        severity: "action_required",
        message: `${doc.fileName} could not be read reliably, so it is not counted. Review it and enter the income manually.`,
        citation: CITE.guardrails,
        documentId: doc.documentId,
        details: { reasons: doc.intake.flags.filter((f) => f.severity === "critical").map((f) => f.message).join(" ") },
        suggestedChange: null,
      });
      continue;
    }
    used.push(doc);
  }

  // 2. Identity and recency, per pay stub.
  const checkedNames = new Set<string>();
  for (const doc of used) {
    const stub = doc.intake.paystub!;
    const printed = stub.employeeName.value;
    if (printed && !checkedNames.has(printed)) {
      checkedNames.add(printed);
      const comparison = compareNames(printed, name);
      if (comparison.kind === "nickname") {
        flags.push({
          code: "NAME_VARIANT",
          severity: "warning",
          message: `Pay stub name "${printed}" differs from VaCMS "${recordName}". "${comparison.printedFirst}" is a common form of "${comparison.recordFirst}". Confirm it is the same person.`,
          citation: CITE.identity,
          documentId: doc.documentId,
          details: { printed, record: recordName },
          suggestedChange: null,
        });
      } else if (comparison.kind === "mismatch") {
        flags.push({
          code: "IDENTITY_MISMATCH",
          severity: "action_required",
          message: `Pay stub name "${printed}" does not match VaCMS "${recordName}" (${comparison.reason}). Verify identity before counting this income.`,
          citation: CITE.identity,
          documentId: doc.documentId,
          details: { printed, record: recordName },
          suggestedChange: null,
        });
      }
    }
    const payDate = stub.payDate.value;
    if (payDate && daysBetween(payDate, household.applicationDate) > PAYSTUB_MAX_AGE_DAYS) {
      flags.push({
        code: "STALE_PAYSTUB",
        severity: "warning",
        message: `${doc.fileName} was paid ${payDate}, more than ${PAYSTUB_MAX_AGE_DAYS} days before the ${household.applicationDate} application.`,
        citation: CITE.recency,
        documentId: doc.documentId,
        details: { payDate, applicationDate: household.applicationDate },
        suggestedChange: null,
      });
    }
  }

  // 3. Monthly income per employer from the accepted pay stubs.
  const byEmployer = new Map<string, VerificationDocument[]>();
  for (const doc of used) {
    const key = normalizeEmployer(doc.intake.paystub!.employerName.value ?? "UNKNOWN EMPLOYER");
    byEmployer.set(key, [...(byEmployer.get(key) ?? []), doc]);
  }

  const incomeSources: IncomeSource[] = [];
  for (const docs of byEmployer.values()) {
    const stubs = docs.map((d) => d.intake.paystub!);
    const frequencies = [...new Set(stubs.map((s) => s.payFrequency.value).filter((f): f is IncomeFrequency => f !== null))];
    if (frequencies.length > 1) {
      flags.push({
        code: "FREQUENCY_CONFLICT",
        severity: "warning",
        message: `Pay stubs from ${stubs[0]!.employerName.value} show different pay frequencies (${frequencies.join(", ")}). Using ${frequencies[0]}.`,
        citation: CITE.conversion,
        documentId: null,
        details: { frequencies: frequencies.join(", ") },
        suggestedChange: null,
      });
    }
    const payFrequency = frequencies[0] ?? "monthly";
    const grossPerPeriodCents = Math.round(stubs.reduce((sum, s) => sum + (s.grossPayCents.value ?? 0), 0) / stubs.length);
    incomeSources.push({
      employerName: stubs[0]!.employerName.value ?? "Unknown employer",
      payFrequency,
      documentIds: docs.map((d) => d.documentId),
      grossPerPeriodCents,
      monthlyCents: toMonthlyCents(grossPerPeriodCents, payFrequency, policy),
    });
  }
  const reportedMonthlyEarnedCents = incomeSources.reduce((sum, s) => sum + s.monthlyCents, 0);

  // 4. Compare with the most recent VEC quarter.
  const quarter = wageRecords.map((w) => w.quarter).sort().at(-1) ?? null;
  const latest = wageRecords.filter((w) => w.quarter === quarter);
  const vecByEmployer = new Map<string, { employerName: string; wagesCents: number }>();
  for (const w of latest) {
    const key = normalizeEmployer(w.employerName);
    const entry = vecByEmployer.get(key) ?? { employerName: w.employerName, wagesCents: 0 };
    entry.wagesCents += w.wagesCents;
    vecByEmployer.set(key, entry);
  }

  const vecRows: VerificationResult["vec"]["byEmployer"] = [];
  for (const [key, { employerName, wagesCents }] of vecByEmployer) {
    const monthlyCents = Math.round(wagesCents / 3);
    const source = incomeSources.find((s) => normalizeEmployer(s.employerName) === key);
    vecRows.push({ employerName, wagesCents, monthlyCents, matchesPaystub: Boolean(source) });

    if (!source) {
      flags.push({
        code: "UNREPORTED_EMPLOYER",
        severity: "action_required",
        message: `VEC reports ${formatCents(wagesCents)} in wages from ${employerName} in ${quarter} (about ${formatCents(monthlyCents)}/month), but no pay stub from this employer was provided. Follow up with the applicant or employer.`,
        citation: CITE.ievs,
        documentId: null,
        details: { employerName, quarter: quarter!, quarterWagesCents: wagesCents, estimatedMonthlyCents: monthlyCents },
        suggestedChange: {
          label: `Count ${employerName} wages (${formatCents(monthlyCents)}/month, from VEC)`,
          changes: { monthlyEarnedIncomeCents: reportedMonthlyEarnedCents + monthlyCents },
        },
      });
      continue;
    }

    const difference = Math.abs(source.monthlyCents - monthlyCents) / Math.max(monthlyCents, 1);
    if (difference > INCOME_MISMATCH_THRESHOLD) {
      flags.push({
        code: "INCOME_MISMATCH",
        severity: "warning",
        message: `Pay stubs from ${source.employerName} show ${formatCents(source.monthlyCents)}/month; VEC ${quarter} wages average ${formatCents(monthlyCents)}/month (${Math.round(difference * 100)}% apart). Hours may have changed; confirm current income.`,
        citation: CITE.ievs,
        documentId: null,
        details: { employerName: source.employerName, paystubMonthlyCents: source.monthlyCents, vecMonthlyCents: monthlyCents, quarter: quarter! },
        suggestedChange: null,
      });
    }
  }

  return {
    incomeSources,
    reportedMonthlyEarnedCents,
    vec: { quarter, monthlyCents: vecRows.reduce((sum, r) => sum + r.monthlyCents, 0), byEmployer: vecRows },
    flags,
    usedDocumentIds: used.map((d) => d.documentId),
    excludedDocumentIds,
    eligibilityInput: {
      applicationDate: household.applicationDate,
      householdSize: household.householdSize,
      hasElderlyOrDisabledMember: household.hasElderlyOrDisabledMember,
      monthlyEarnedIncomeCents: reportedMonthlyEarnedCents,
      monthlyUnearnedIncomeCents: household.monthlyUnearnedIncomeCents,
      monthlyShelterCostCents: household.monthlyShelterCostCents,
      paysUtilities: household.paysHeatingOrCooling,
      countableResourcesCents: household.countableResourcesCents,
      broadBasedCategoricallyEligible: household.broadBasedCategoricallyEligible,
    },
  };
}
