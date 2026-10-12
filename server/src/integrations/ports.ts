import type { HouseholdRecord, WageRecord } from "@caseflow/shared";

/**
 * The only view of the state's systems the rest of CaseFlow gets (ADR-0006).
 * Today these are backed by fixed-width batch files; if VaCMS moves to a new platform
 * or exposes an API, a new implementation of these interfaces is the whole change.
 * Async on purpose: a network-backed implementation would be.
 */
export interface HouseholdSource {
  getHousehold(caseNumber: string): Promise<HouseholdRecord | undefined>;
  listHouseholds(): Promise<HouseholdRecord[]>;
}

export interface WageRecordSource {
  /** All quarterly wage records for an SSN, most recent quarter first. */
  getWageRecords(ssn: string): Promise<WageRecord[]>;
}

/** A line the adapter could not use, kept for a data-quality report instead of being silently dropped. */
export interface IntegrationReject {
  source: string;
  line: number;
  reason: string;
}
