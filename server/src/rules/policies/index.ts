import { PolicySchema, type Policy } from "@caseflow/shared";
import fy2026 from "./snap-fy2026.json" with { type: "json" };
import fy2027 from "./snap-fy2027.json" with { type: "json" };

/**
 * Every policy file is validated against the schema at load time,
 * so a typo in an October update fails tests and CI, not a live case.
 */
export const POLICIES: readonly Policy[] = [fy2026, fy2027].map((raw) => PolicySchema.parse(raw));

export class NoPolicyInEffectError extends Error {
  constructor(public readonly date: string) {
    super(`No SNAP policy version is in effect on ${date}`);
  }
}

/** Pick the policy whose effective range contains the application date (ISO dates compare lexically). */
export function selectPolicy(applicationDate: string, policies: readonly Policy[] = POLICIES): Policy {
  const match = policies.find((p) => p.effectiveFrom <= applicationDate && applicationDate <= p.effectiveTo);
  if (!match) throw new NoPolicyInEffectError(applicationDate);
  return match;
}
