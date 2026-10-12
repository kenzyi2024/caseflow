import { z } from "zod";
import { DeterminationSchema, EligibilityInputSchema } from "./eligibility";
import { IntakeResultSchema } from "./documents";
import { HouseholdRecordSchema, WageRecordSchema } from "./records";
import { FactChangesSchema, VerificationResultSchema } from "./verification";

/**
 * Every change to a case is one immutable event (ADR-0005). Current state is a projection of these.
 * Actors: "system:*" for deterministic steps, "ai:*" for model calls, "bps:<id>" for people.
 */

const meta = {
  id: z.number().int().positive(),
  caseNumber: z.string(),
  actor: z.string(),
  createdAt: z.iso.datetime(),
};
const reason = z.string().trim().min(10, "Give a reason of at least 10 characters");

export const CaseEventSchema = z.discriminatedUnion("type", [
  z.object({ ...meta, type: z.literal("case.opened"), payload: z.object({ source: z.string() }) }),
  z.object({
    ...meta,
    type: z.literal("document.uploaded"),
    payload: z.object({ documentId: z.string(), fileName: z.string(), sha256: z.string(), sizeBytes: z.number().int() }),
  }),
  z.object({ ...meta, type: z.literal("pipeline.started"), payload: z.object({ trigger: z.string() }) }),
  z.object({ ...meta, type: z.literal("intake.completed"), payload: z.object({ documentId: z.string(), result: IntakeResultSchema }) }),
  z.object({
    ...meta,
    type: z.literal("intake.failed"),
    payload: z.object({ documentId: z.string(), reason: z.string(), message: z.string() }),
  }),
  z.object({
    ...meta,
    type: z.literal("records.fetched"),
    payload: z.object({ household: HouseholdRecordSchema, wageRecords: z.array(WageRecordSchema) }),
  }),
  z.object({ ...meta, type: z.literal("records.failed"), payload: z.object({ message: z.string() }) }),
  z.object({ ...meta, type: z.literal("verification.completed"), payload: VerificationResultSchema }),
  z.object({
    ...meta,
    type: z.literal("determination.completed"),
    payload: z.object({
      input: EligibilityInputSchema,
      determination: DeterminationSchema,
      basis: z.enum(["documents", "bps_revision"]),
    }),
  }),
  z.object({ ...meta, type: z.literal("determination.failed"), payload: z.object({ message: z.string() }) }),
  z.object({
    ...meta,
    type: z.literal("pipeline.completed"),
    payload: z.object({ outcome: z.enum(["awaiting_review", "manual_review"]), reasons: z.array(z.string()) }),
  }),
  z.object({ ...meta, type: z.literal("bps.revised_facts"), payload: z.object({ changes: FactChangesSchema, reason }) }),
  z.object({ ...meta, type: z.literal("bps.approved"), payload: z.object({ note: z.string().nullable() }) }),
  z.object({ ...meta, type: z.literal("bps.pended"), payload: z.object({ reason }) }),
]);
export type CaseEvent = z.infer<typeof CaseEventSchema>;
export type CaseEventType = CaseEvent["type"];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An event before the store assigns its id and timestamp. */
export type NewCaseEvent = DistributiveOmit<CaseEvent, "id" | "createdAt">;
export type CaseEventOf<T extends CaseEventType> = Extract<CaseEvent, { type: T }>;

export const CaseStatusSchema = z.enum([
  "RECEIVED",
  "PROCESSING",
  "MANUAL_REVIEW",
  "AWAITING_REVIEW",
  "PENDING_VERIFICATION",
  "APPROVED",
]);
export type CaseStatus = z.infer<typeof CaseStatusSchema>;

/** Days allowed to process a SNAP application (7 CFR 273.2(g)(1); VDSS Manual Pt. X.B). */
export const PROCESSING_STANDARD_DAYS = 30;
