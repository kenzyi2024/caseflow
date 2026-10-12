import { describe, expect, it } from "vitest";
import type { EligibilityInput } from "@caseflow/shared";
import { assembleNotice, buildNoticeFacts, draftNotice, guardNotice, NoticeError, type NoticeWriter } from "../src/agents/notice";
import { determineEligibility } from "../src/rules/engine";
import { draftFromFacts, fakeNoticeWriter } from "../fixtures/fake-notice";
import { SCENARIOS } from "../fixtures/scenarios";

const gonzalez = SCENARIOS.find((s) => s.id === "gonzalez")!.household;
const input: EligibilityInput = {
  applicationDate: gonzalez.applicationDate,
  householdSize: 3,
  hasElderlyOrDisabledMember: false,
  monthlyEarnedIncomeCents: 200_000,
  monthlyUnearnedIncomeCents: 0,
  monthlyShelterCostCents: 90_000,
  paysUtilities: true,
  countableResourcesCents: 50_000,
  broadBasedCategoricallyEligible: true,
};
const facts = buildNoticeFacts(determineEligibility(input), input, "documents");
const context = {
  household: gonzalez,
  bps: "bps:kibrahim",
  approvedAt: "2026-10-12T15:00:00Z",
  noticeDate: new Date("2026-10-12T15:05:00Z"),
  policyVersion: "FY2027",
  determinationEventId: 9,
};

describe("notice facts (what the model sees)", () => {
  it("contain the decision and engine amounts", () => {
    expect(facts.decision).toBe("approved");
    expect(facts.monthlyBenefit).toBe("$568.00");
    expect(facts.calculation).toContainEqual({ label: "Net monthly income", amount: "$799.50" });
  });

  it("contain no personal data: no name, SSN, case number, address or date of birth", () => {
    const sent = JSON.stringify(facts);
    for (const pii of [gonzalez.headOfHousehold.last, gonzalez.headOfHousehold.first, gonzalez.ssn, gonzalez.caseNumber, gonzalez.address.line1, gonzalez.dateOfBirth]) {
      expect(sent).not.toContain(pii);
    }
  });

  it("explain denials with the limits the engine applied", () => {
    const denied = { ...input, broadBasedCategoricallyEligible: false, countableResourcesCents: 500_000 };
    const f = buildNoticeFacts(determineEligibility(denied), denied, "documents");
    expect(f.decision).toBe("denied");
    expect(f.monthlyBenefit).toBeNull();
    expect(f.denialReasons[0]?.amounts).toEqual([
      { label: "Countable resources", amount: "$5,000.00" },
      { label: "Resource limit", amount: "$3,000.00" },
    ]);
  });
});

describe("notice guard", () => {
  it("passes a draft that uses only engine amounts and states the benefit in both languages", () => {
    expect(guardNotice(draftFromFacts(facts), facts)).toEqual([]);
  });

  it("rejects an amount the rules engine did not produce", () => {
    const draft = draftFromFacts(facts);
    draft.english.explanation += "\n\nThis is $50.00 more than last year.";
    expect(guardNotice(draft, facts)).toEqual(["English: $50.00 is not an amount from the facts."]);
  });

  it("rejects a translation that drops or reformats the benefit amount", () => {
    const draft = draftFromFacts(facts);
    draft.spanish.subject = "Sus beneficios de SNAP";
    draft.spanish.explanation = "{{APPLICANT_NAME}}, su hogar recibirá 568,00 dólares cada mes.";
    expect(guardNotice(draft, facts)).toContain("Spanish: the monthly benefit $568.00 must be stated exactly.");
  });

  it("rejects a decision that contradicts the determination, and unknown placeholders", () => {
    const draft = draftFromFacts(facts);
    draft.decision = "denied";
    draft.english.explanation += " Call {{CASEWORKER_PHONE}}.";
    const errors = guardNotice(draft, facts);
    expect(errors).toContain('The decision must be "approved", not "denied".');
    expect(errors).toContain("English: remove placeholders {{CASEWORKER_PHONE}}; only {{APPLICANT_NAME}} is allowed.");
  });
});

describe("drafting and assembly", () => {
  it("retries once with the guard's findings, then succeeds", async () => {
    const seen: string[][] = [];
    const writer: NoticeWriter = async (f, previousErrors) => {
      seen.push(previousErrors);
      const draft = draftFromFacts(f);
      if (seen.length === 1) draft.english.explanation += " You will also get $99.00.";
      return { output: draft, model: { requested: "fake", served: "fake", effort: "medium", latencyMs: 0, inputTokens: 0, outputTokens: 0 } };
    };
    const notice = await draftNotice(writer, facts, context);
    expect(seen).toEqual([[], ["English: $99.00 is not an amount from the facts."]]);
    expect(notice.guard.attempts).toBe(2);
  });

  it("gives up after two failed drafts so a person writes the notice", async () => {
    const writer: NoticeWriter = async (f) => {
      const draft = draftFromFacts(f);
      draft.decision = "denied";
      return { output: draft, model: { requested: "fake", served: "fake", effort: "medium", latencyMs: 0, inputTokens: 0, outputTokens: 0 } };
    };
    await expect(draftNotice(writer, facts, context)).rejects.toBeInstanceOf(NoticeError);
  });

  it("assembles the full notice: demo banner, header, name filled in by code, fixed fair-hearing rights", async () => {
    const notice = await draftNotice(fakeNoticeWriter, facts, context);
    const en = notice.versions.en.fullText;
    expect(en.startsWith("SAMPLE NOTICE")).toBe(true);
    expect(en).toContain("Case number: 0130000101");
    expect(en).toContain("Maria L Gonzalez, your SNAP application is approved.");
    expect(en).toContain("YOUR RIGHT TO A FAIR HEARING");
    expect(en).toContain("within 90 days");
    expect(en).not.toContain("{{");
    const es = notice.versions.es.fullText;
    expect(es).toContain("Fecha: 12 de octubre de 2026");
    expect(es).toContain("SU DERECHO A UNA AUDIENCIA IMPARCIAL");
    expect(notice.preferredLanguage).toBe("es");
  });

  it("keeps the fair-hearing text out of the model's hands", () => {
    const v = assembleNotice("en", { subject: "S", explanation: "E" }, context);
    expect(v.fullText).toContain("(7 CFR 273.15)");
  });
});
