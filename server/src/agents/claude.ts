import Anthropic from "@anthropic-ai/sdk";

/** Shared Claude configuration for CaseFlow's AI steps (ADR-0002). */
export const MODEL = "claude-opus-5-5";

/**
 * Server-side fallback: if the model declines a request, the API re-runs it on another
 * model inside the same call instead of failing. The model that actually served the
 * request is recorded on every result, for the audit trail.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

let client: Anthropic | undefined;

export function getClient(): Anthropic {
  client ??= new Anthropic({ timeout: 90_000, maxRetries: 2 });
  return client;
}

export type AgentFailureReason = "refusal" | "truncated" | "invalid_output" | "api_error";

/** Any AI step failure. The pipeline catches it and routes the case to manual review. */
export class AgentError extends Error {
  constructor(
    message: string,
    readonly reason: AgentFailureReason,
  ) {
    super(message);
  }
}

export function toAgentError(error: unknown): AgentError {
  if (error instanceof AgentError) return error;
  if (error instanceof Anthropic.APIError) return new AgentError(`Claude API error ${error.status ?? ""}: ${error.message}`.trim(), "api_error");
  return new AgentError(error instanceof Error ? error.message : String(error), "api_error");
}
