import type { NoticeFacts, NoticeModelOutput, NoticeWriter } from "../src/agents/notice";

/** Offline stand-in for the notice agent: a correct draft built from the facts. */
export function draftFromFacts(facts: NoticeFacts): NoticeModelOutput {
  const approved = facts.decision === "approved";
  const net = facts.calculation.find((l) => l.label === "Net monthly income")?.amount ?? "$0.00";
  return {
    decision: facts.decision,
    english: {
      subject: approved ? `Your SNAP benefits: ${facts.monthlyBenefit} per month` : "Your SNAP application was denied",
      explanation: approved
        ? `{{APPLICANT_NAME}}, your SNAP application is approved. Your household will receive ${facts.monthlyBenefit} each month.\n\nAfter deductions, your household's net monthly income is ${net}.`
        : `{{APPLICANT_NAME}}, your SNAP application is denied.\n\n${facts.denialReasons.map((r) => r.reason).join(" ")}`,
    },
    spanish: {
      subject: approved ? `Sus beneficios de SNAP: ${facts.monthlyBenefit} al mes` : "Su solicitud de SNAP fue negada",
      explanation: approved
        ? `{{APPLICANT_NAME}}, su solicitud de SNAP fue aprobada. Su hogar recibirá ${facts.monthlyBenefit} cada mes.\n\nDespués de las deducciones, el ingreso neto mensual de su hogar es ${net}.`
        : `{{APPLICANT_NAME}}, su solicitud de SNAP fue negada.`,
    },
  };
}

export const fakeNoticeWriter: NoticeWriter = async (facts) => ({
  output: draftFromFacts(facts),
  model: { requested: "fake", served: "fake", effort: "medium", latencyMs: 0, inputTokens: 0, outputTokens: 0 },
});
