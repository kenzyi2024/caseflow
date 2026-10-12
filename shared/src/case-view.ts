import type { CaseEvent, CaseStatus } from "./case";
import type { Determination, EligibilityInput } from "./eligibility";
import type { IntakeResult } from "./documents";
import type { NoticeDraft } from "./notice";
import type { HouseholdRecord, PersonName, WageRecord } from "./records";
import type { FactChanges, VerificationFlag, VerificationResult } from "./verification";

/**
 * Read models shared by the server (which builds them from events, ADR-0005) and the UI (which renders them).
 */

export interface CaseDocument {
  documentId: string;
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
  intake: IntakeResult | null;
  intakeError: { reason: string; message: string } | null;
}

export interface DeterminationRecord {
  eventId: number;
  createdAt: string;
  basis: "documents" | "bps_revision";
  input: EligibilityInput;
  determination: Determination;
}

export interface CaseView {
  caseNumber: string;
  status: CaseStatus;
  /** Why the case is in manual review, in plain language. */
  manualReviewReasons: string[];
  household: HouseholdRecord | null;
  applicationDate: string | null;
  processingDeadline: string | null;
  documents: CaseDocument[];
  wageRecords: WageRecord[];
  verification: (VerificationResult & { eventId: number }) | null;
  /** Revisions made against the current verification, oldest first. */
  revisions: { eventId: number; actor: string; createdAt: string; changes: FactChanges; reason: string }[];
  determination: DeterminationRecord | null;
  determinationHistory: DeterminationRecord[];
  openActionFlags: VerificationFlag[];
  approval: { actor: string; createdAt: string; note: string | null } | null;
  pended: { actor: string; createdAt: string; reason: string } | null;
  notice: (NoticeDraft & { eventId: number; createdAt: string }) | null;
  noticeError: { reason: string; message: string; guardErrors: string[]; createdAt: string } | null;
  timeline: CaseEvent[];
}

/** GET /api/cases/:caseNumber. `applicant` is the VaCMS household, available even before the pipeline has run. */
export type CaseResponse = CaseView & { daysRemaining: number | null; applicant: HouseholdRecord | null };

/** One row of the BPS work queue (GET /api/cases). */
export interface CaseSummary {
  caseNumber: string;
  applicant: PersonName | null;
  householdSize: number | null;
  applicationDate: string | null;
  processingDeadline: string | null;
  daysRemaining: number | null;
  status: CaseStatus;
  documents: number;
  flags: { actionRequired: number; warnings: number };
  determination: { eligible: boolean; monthlyBenefitCents: number; eligibilityPath: "BBCE" | "STANDARD"; policyVersion: string } | null;
  lastActivity: string | null;
}
