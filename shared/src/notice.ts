import { z } from "zod";

export const NoticeLanguageSchema = z.enum(["en", "es"]);
export type NoticeLanguage = z.infer<typeof NoticeLanguageSchema>;

/** One language version of an assembled Notice of Action. */
export const NoticeVersionSchema = z.object({
  subject: z.string(),
  /** The AI-written explanation, after code filled in the applicant's name. */
  explanation: z.string(),
  /** The full notice: demo banner, header, explanation, fixed fair-hearing text. */
  fullText: z.string(),
});
export type NoticeVersion = z.infer<typeof NoticeVersionSchema>;

/**
 * A drafted Notice of Action (ADR-0007). `factsSentToModel` records exactly what the AI saw,
 * so an auditor can confirm no personal data left the system.
 */
export const NoticeDraftSchema = z.object({
  decision: z.enum(["approved", "denied"]),
  preferredLanguage: NoticeLanguageSchema,
  versions: z.object({ en: NoticeVersionSchema, es: NoticeVersionSchema }),
  determinationEventId: z.number().int(),
  factsSentToModel: z.record(z.string(), z.unknown()),
  guard: z.object({ attempts: z.number().int(), passedChecks: z.array(z.string()) }),
  model: z.object({ requested: z.string(), served: z.string(), effort: z.string(), latencyMs: z.number(), inputTokens: z.number(), outputTokens: z.number() }),
});
export type NoticeDraft = z.infer<typeof NoticeDraftSchema>;
