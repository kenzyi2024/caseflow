import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  formatCents,
  type Determination,
  type DenialReason,
  type EligibilityInput,
  type HouseholdRecord,
  type NoticeDraft,
  type NoticeLanguage,
  type NoticeVersion,
} from "@caseflow/shared";
import { AgentError, FALLBACK_BETA, getClient, MODEL, toAgentError, type Effort } from "./claude";
import { NOTICE_TEXT } from "./notice-templates";

/**
 * Notice agent (ADR-0002, ADR-0007): writes the plain-language explanation in a Notice of Action.
 *
 *  - The model sees only de-identified facts: amounts, household size, policy version. No name, SSN,
 *    case number or address. The applicant is a {{APPLICANT_NAME}} token that code fills in afterwards.
 *  - A deterministic guard checks the draft: decision matches, every dollar amount is one the rules
 *    engine produced, the benefit amount appears in both languages, no stray placeholders.
 *    One retry with the guard's findings, then the notice is left for a person to write.
 *  - Fair-hearing rights and the header are fixed text added by code (notice-templates.ts).
 */

export const NOTICE_EFFORT: Effort = "medium";
export const NAME_TOKEN = "{{APPLICANT_NAME}}";

export interface NoticeFacts {
  decision: "approved" | "denied";
  householdSize: number;
  policyVersion: string;
  eligibilityPath: "BBCE" | "STANDARD";
  monthlyBenefit: string | null;
  minimumBenefitApplied: boolean;
  includesIncomeVerifiedByCaseworker: boolean;
  calculation: { label: string; amount: string }[];
  denialReasons: { reason: string; amounts: { label: string; amount: string }[] }[];
}

const DENIAL_TEXT: Record<DenialReason, string> = {
  RESOURCES_EXCEED_LIMIT: "The household's countable resources (such as money in bank accounts) are more than the limit.",
  GROSS_INCOME_EXCEEDS_LIMIT: "The household's gross monthly income is more than the limit for its size.",
  NET_INCOME_EXCEEDS_LIMIT: "The household's net monthly income, after deductions, is more than the limit for its size.",
  ZERO_BENEFIT: "Based on the household's income, the calculated monthly benefit is $0.00.",
};

/** De-identified facts for the model. Built only from the determination and household size. */
export function buildNoticeFacts(determination: Determination, input: EligibilityInput, basis: "documents" | "bps_revision"): NoticeFacts {
  const c = determination.computed;
  const $ = formatCents;
  const size = input.householdSize;
  const step = (rule: string) => determination.trace.find((t) => t.rule === rule);
  const calcStep = step("benefit_calculation");

  const calculation = [
    input.monthlyEarnedIncomeCents > 0 && { label: "Earned income (wages) per month", amount: $(input.monthlyEarnedIncomeCents) },
    input.monthlyUnearnedIncomeCents > 0 && { label: "Other income per month (for example Social Security)", amount: $(input.monthlyUnearnedIncomeCents) },
    { label: "Total gross monthly income", amount: $(c.grossIncomeCents) },
    c.earnedIncomeDeductionCents > 0 && { label: "Earned income deduction (20% of wages)", amount: $(c.earnedIncomeDeductionCents) },
    { label: `Standard deduction for a household of ${size}`, amount: $(c.standardDeductionCents) },
    c.excessShelterDeductionCents > 0 && {
      label: "Shelter deduction (housing and utility costs above half of income after other deductions)",
      amount: $(c.excessShelterDeductionCents),
    },
    { label: "Net monthly income", amount: $(c.netIncomeCents) },
    determination.eligible && { label: `Maximum monthly benefit for a household of ${size}`, amount: $(c.maxAllotmentCents) },
    determination.eligible && { label: "30% of net monthly income, rounded up", amount: $(c.householdContributionCents) },
  ].filter((line): line is { label: string; amount: string } => Boolean(line));

  const denialReasons = determination.denialReasons.map((reason) => {
    const amounts: { label: string; amount: string }[] = [];
    const v = (rule: string) => step(rule)?.values ?? {};
    if (reason === "RESOURCES_EXCEED_LIMIT") {
      amounts.push({ label: "Countable resources", amount: $(Number(v("resource_test").countableResourcesCents)) });
      amounts.push({ label: "Resource limit", amount: $(Number(v("resource_test").resourceLimitCents)) });
    }
    if (reason === "GROSS_INCOME_EXCEEDS_LIMIT") {
      const bbce = step("categorical_eligibility");
      if (bbce?.outcome === "fail") amounts.push({ label: "Virginia gross income limit (200% of poverty)", amount: $(Number(bbce.values.bbceLimitCents)) });
      amounts.push({ label: "Federal gross income limit (130% of poverty)", amount: $(Number(v("gross_income_test").grossLimitCents)) });
    }
    if (reason === "NET_INCOME_EXCEEDS_LIMIT") amounts.push({ label: "Net income limit (100% of poverty)", amount: $(Number(v("net_income_test").netLimitCents)) });
    return { reason: DENIAL_TEXT[reason], amounts };
  });

  return {
    decision: determination.eligible ? "approved" : "denied",
    householdSize: size,
    policyVersion: determination.policyVersion,
    eligibilityPath: determination.eligibilityPath,
    monthlyBenefit: determination.eligible ? $(determination.monthlyBenefitCents) : null,
    minimumBenefitApplied: Boolean(calcStep?.detail.includes("minimum benefit")),
    includesIncomeVerifiedByCaseworker: basis === "bps_revision",
    calculation,
    denialReasons,
  };
}

// ---------------------------------------------------------------------------------------------
// Model call
// ---------------------------------------------------------------------------------------------

const version = z.object({ subject: z.string(), explanation: z.string() });
export const NoticeModelOutputSchema = z.object({
  decision: z.enum(["approved", "denied"]),
  english: version,
  spanish: version,
});
export type NoticeModelOutput = z.infer<typeof NoticeModelOutputSchema>;

export const NOTICE_SYSTEM_PROMPT = `You write the explanation section of a SNAP (food assistance) Notice of Action for a Virginia local department of social services, in English and in Spanish. The reader is the applicant. Write warmly and plainly, at about a 6th-grade reading level, in short sentences.

Rules:
- Use only the facts provided. Do not add dates, deadlines, amounts, program rules, phone numbers, addresses or names that are not in the facts.
- Write every dollar amount exactly as it appears in the facts (for example $568.00), in both languages.
- Address the applicant as ${NAME_TOKEN}. Use no other placeholders.
- State the decision in the first sentence. If approved, give the monthly benefit amount. If denied, explain each reason in simple words.
- Briefly explain how the amount was worked out, using the calculation facts.
- If minimumBenefitApplied is true, say the household receives the minimum benefit.
- Do not describe appeal or fair hearing rights. That section is added separately.
- The Spanish version should read naturally to a Spanish-speaking reader, not word for word. Keep every amount identical.
- subject: one short line. explanation: plain text paragraphs separated by a blank line. No markdown, headings, greetings beyond the name, or signature.`;

export type NoticeWriter = (facts: NoticeFacts, previousErrors: string[]) => Promise<{ output: NoticeModelOutput; model: NoticeDraft["model"] }>;

export const claudeNoticeWriter: NoticeWriter = async (facts, previousErrors) => {
  const started = Date.now();
  const retryNote = previousErrors.length
    ? `\n\nA previous draft failed these automated checks. Fix every one:\n- ${previousErrors.join("\n- ")}`
    : "";
  let response;
  try {
    response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 16_000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: NOTICE_EFFORT, format: betaZodOutputFormat(NoticeModelOutputSchema) },
      system: NOTICE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Facts:\n${JSON.stringify(facts, null, 2)}${retryNote}` }],
    });
  } catch (error) {
    throw toAgentError(error);
  }
  if (response.stop_reason === "refusal") throw new AgentError("The model declined to write this notice.", "refusal");
  if (response.stop_reason === "max_tokens") throw new AgentError("The notice draft was cut off.", "truncated");
  if (!response.parsed_output) throw new AgentError("The notice draft did not match the expected format.", "invalid_output");
  return {
    output: response.parsed_output,
    model: {
      requested: MODEL,
      served: response.model,
      effort: NOTICE_EFFORT,
      latencyMs: Date.now() - started,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Guard (deterministic) and assembly
// ---------------------------------------------------------------------------------------------

const AMOUNT = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?(?!\d)|\$\s?\d+(?:\.\d{2})?(?!\d)/g;
const toCents = (s: string) => Math.round(Number(s.replace(/[$,\s]/g, "")) * 100);

export function allowedAmounts(facts: NoticeFacts): Set<number> {
  const amounts = [
    facts.monthlyBenefit,
    ...facts.calculation.map((l) => l.amount),
    ...facts.denialReasons.flatMap((r) => r.amounts.map((a) => a.amount)),
    facts.denialReasons.some((r) => r.reason.includes("$0.00")) ? "$0.00" : null,
  ];
  return new Set(amounts.filter((a): a is string => a !== null).map(toCents));
}

export const GUARD_CHECKS = ["decision matches", "only engine amounts", "benefit amount stated", "no stray placeholders", "length"] as const;

export function guardNotice(output: NoticeModelOutput, facts: NoticeFacts): string[] {
  const errors: string[] = [];
  if (output.decision !== facts.decision) errors.push(`The decision must be "${facts.decision}", not "${output.decision}".`);

  const allowed = allowedAmounts(facts);
  for (const [label, v] of [["English", output.english], ["Spanish", output.spanish]] as const) {
    const text = `${v.subject}\n${v.explanation}`;
    if (!v.explanation.trim()) errors.push(`The ${label} explanation is empty.`);
    if (v.explanation.length > 3_000) errors.push(`The ${label} explanation is too long (${v.explanation.length} characters, max 3000).`);
    if (v.subject.length > 140) errors.push(`The ${label} subject is too long.`);
    for (const match of text.match(AMOUNT) ?? []) {
      if (!allowed.has(toCents(match))) errors.push(`${label}: ${match.trim()} is not an amount from the facts.`);
    }
    if (facts.monthlyBenefit && !text.includes(facts.monthlyBenefit)) {
      errors.push(`${label}: the monthly benefit ${facts.monthlyBenefit} must be stated exactly.`);
    }
    const placeholders = (text.match(/\{\{[^}]*\}\}/g) ?? []).filter((p) => p !== NAME_TOKEN);
    if (placeholders.length) errors.push(`${label}: remove placeholders ${placeholders.join(", ")}; only ${NAME_TOKEN} is allowed.`);
  }
  return errors;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export function assembleNotice(
  language: NoticeLanguage,
  draft: { subject: string; explanation: string },
  context: { household: HouseholdRecord; bps: string; approvedAt: string; noticeDate: Date; policyVersion: string },
): NoticeVersion {
  const t = NOTICE_TEXT[language];
  const h = context.household;
  const name = titleCase([h.headOfHousehold.first, h.headOfHousehold.middle, h.headOfHousehold.last].filter(Boolean).join(" "));
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat(language === "es" ? "es-US" : "en-US", { dateStyle: "long", timeZone: "America/New_York" }).format(d);
  const explanation = draft.explanation.replaceAll(NAME_TOKEN, name).trim();
  const subject = draft.subject.replaceAll(NAME_TOKEN, name).trim();

  const fullText = [
    t.banner,
    "",
    t.title,
    t.program,
    t.agency,
    "",
    `${t.date}: ${fmt(context.noticeDate)}`,
    `${t.caseNumber}: ${h.caseNumber}`,
    `${t.to}: ${name}`,
    `    ${h.address.line1}`,
    `    ${h.address.city} ${h.address.state} ${h.address.zip}`,
    "",
    `${t.subject}: ${subject}`,
    "",
    explanation,
    "",
    t.hearingHeading,
    t.hearingBody,
    "",
    t.approvedBy(context.bps.replace(/^bps:/, ""), fmt(new Date(context.approvedAt))),
    t.rulesApplied(context.policyVersion),
    "",
    t.banner,
  ].join("\n");

  return { subject, explanation, fullText };
}

export class NoticeError extends Error {
  constructor(
    message: string,
    readonly reason: string,
    readonly guardErrors: string[],
  ) {
    super(message);
  }
}

/** Draft, guard, retry once, assemble. Throws NoticeError when no draft passes. */
export async function draftNotice(
  writer: NoticeWriter,
  facts: NoticeFacts,
  context: Parameters<typeof assembleNotice>[2] & { determinationEventId: number },
): Promise<NoticeDraft> {
  let previousErrors: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    let result;
    try {
      result = await writer(facts, previousErrors);
    } catch (error) {
      const e = toAgentError(error);
      throw new NoticeError(e.message, e.reason, previousErrors);
    }
    const errors = guardNotice(result.output, facts);
    if (errors.length === 0) {
      return {
        decision: facts.decision,
        preferredLanguage: context.household.preferredLanguage,
        versions: {
          en: assembleNotice("en", result.output.english, context),
          es: assembleNotice("es", result.output.spanish, context),
        },
        determinationEventId: context.determinationEventId,
        factsSentToModel: facts as unknown as Record<string, unknown>,
        guard: { attempts: attempt, passedChecks: [...GUARD_CHECKS] },
        model: result.model,
      };
    }
    previousErrors = errors;
  }
  throw new NoticeError("The notice draft failed the automated checks twice. A BPS must write this notice.", "guard_failed", previousErrors);
}
