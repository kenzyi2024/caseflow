import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  dollarsToCents,
  IncomeFrequencySchema,
  type IntakeFlag,
  type IntakeResult,
  type PaystubExtraction,
  type PaystubField,
} from "@caseflow/shared";
import { AgentError, FALLBACK_BETA, getClient, MODEL, toAgentError, type Effort } from "./claude";
import { extractPdfText } from "./pdf-text";

/**
 * Intake agent (ADR-0002): one bounded Claude call that classifies an uploaded document
 * and, for pay stubs, extracts the fields income verification needs.
 *
 * The model reads and transcribes; code then checks everything it can (ADR-0007):
 * every evidence quote must appear in the PDF's own text and show the extracted value,
 * dates must be real, amounts and periods must be consistent. Anything critical sends the
 * document to manual review instead of into the eligibility calculation.
 */

export const INTAKE_EFFORT: Effort = "low";
export const LOW_CONFIDENCE = 0.8;

// What the model returns. Every value is a string ("" = not on the document) and code does the
// conversion: this keeps the schema free of nullable unions, and puts parsing where it can be tested.
const field = <T extends z.ZodType>(value: T) => z.object({ value, evidence: z.string(), confidence: z.number() });

export const IntakeModelOutputSchema = z.object({
  documentType: z.enum(["pay_stub", "other"]),
  documentDescription: z.string(),
  employeeName: field(z.string()),
  employerName: field(z.string()),
  payPeriodStart: field(z.string()),
  payPeriodEnd: field(z.string()),
  payDate: field(z.string()),
  payFrequency: field(z.enum([...IncomeFrequencySchema.options, "unknown"])),
  grossPay: field(z.string()),
  netPay: field(z.string()),
  ytdGrossPay: field(z.string()),
  observations: z.array(z.string()),
});
export type IntakeModelOutput = z.infer<typeof IntakeModelOutputSchema>;

export const INTAKE_SYSTEM_PROMPT = `You review documents uploaded to SNAP (food assistance) applications at a Virginia local department of social services. Classify each document and, if it is an earnings statement (pay stub), extract its fields so a Benefit Programs Specialist can verify the applicant's income.

Rules:
- Transcribe only what is printed. Do not calculate or guess a value that is not on the document.
- Exception: if the pay frequency is not printed, infer it from the pay period dates. Use those dates, verbatim, as the evidence, set confidence no higher than 0.7, and explain the inference in observations.
- If a field is not on the document, use an empty string for its value and evidence (payFrequency: "unknown").
- evidence: the exact characters printed on the document that show the value (the value, optionally with its label), copied verbatim.
- confidence: 0 to 1, how sure you are the value is correct.
- Dates as YYYY-MM-DD. Money as plain dollar amounts like 1234.56, without $ or commas.
- employeeName and employerName exactly as printed. Do not correct nicknames, spelling or word order.
- grossPay is this pay period's total gross earnings, not year-to-date. ytdGrossPay is the year-to-date gross.
- observations: anything the specialist should know, such as values that don't add up, illegible areas or signs of alteration. Leave empty if there is nothing to note.

If the document is not a pay stub, set documentType to "other", describe it briefly in documentDescription, and leave every pay stub field empty.`;

export interface IntakeOptions {
  effort?: Effort;
}

export async function runIntake(pdf: Uint8Array, options: IntakeOptions = {}): Promise<IntakeResult> {
  const effort = options.effort ?? INTAKE_EFFORT;
  const data = Buffer.from(pdf).toString("base64");
  const pdfText = await extractPdfText(pdf);
  const started = Date.now();

  let response;
  try {
    response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 16_000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort, format: betaZodOutputFormat(IntakeModelOutputSchema) },
      system: INTAKE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
            { type: "text", text: "Classify this document and extract its fields." },
          ],
        },
      ],
    });
  } catch (error) {
    throw toAgentError(error);
  }

  if (response.stop_reason === "refusal") throw new AgentError("The model declined to process this document.", "refusal");
  if (response.stop_reason === "max_tokens") throw new AgentError("The model's response was cut off.", "truncated");
  const output = response.parsed_output;
  if (!output) throw new AgentError("The model's response did not match the intake schema.", "invalid_output");

  return normalizeIntake(output, pdfText, {
    requested: MODEL,
    served: response.model,
    effort,
    latencyMs: Date.now() - started,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });
}

// ---------------------------------------------------------------------------------------------
// Deterministic post-processing. Pure: tested without calling the API.
// ---------------------------------------------------------------------------------------------

const REQUIRED: PaystubField[] = ["grossPayCents", "payFrequency", "payPeriodStart", "payPeriodEnd", "payDate"];

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const isRealDate = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) && new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso;
const days = (fromIso: string, toIso: string) => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);

/** Ways a value can legitimately be printed, for checking that the quoted evidence actually shows it. */
function printedForms(value: string | number, kind: "money" | "date" | "text"): string[] {
  if (kind === "money") {
    const dollars = (value as number) / 100;
    return [dollars.toLocaleString("en-US", { minimumFractionDigits: 2 }), dollars.toFixed(2)];
  }
  if (kind === "date") {
    const [y, m, d] = (value as string).split("-");
    return [`${m}/${d}/${y}`, `${Number(m)}/${Number(d)}/${y}`, value as string];
  }
  return [];
}

const FIELD_KIND: Record<PaystubField, "money" | "date" | "text"> = {
  employeeName: "text",
  employerName: "text",
  payPeriodStart: "date",
  payPeriodEnd: "date",
  payDate: "date",
  payFrequency: "text",
  grossPayCents: "money",
  netPayCents: "money",
  ytdGrossCents: "money",
};

export function normalizeIntake(output: IntakeModelOutput, pdfText: string | null, model: IntakeResult["model"]): IntakeResult {
  const flags: IntakeFlag[] = [];
  const flag = (code: IntakeFlag["code"], severity: IntakeFlag["severity"], fieldName: string | null, message: string) =>
    flags.push({ code, severity, field: fieldName, message });

  const base = {
    documentDescription: output.documentDescription,
    observations: output.observations,
    textLayer: pdfText !== null,
    model,
  };

  if (output.documentType === "other") {
    flag("NOT_A_PAYSTUB", "info", null, `Not a pay stub: ${output.documentDescription}. Not used as income evidence.`);
    return { ...base, documentType: "other", paystub: null, flags, needsManualReview: false };
  }
  if (pdfText === null) {
    flag("NO_TEXT_LAYER", "warning", null, "The PDF has no text layer (e.g. a scan), so evidence quotes could not be checked.");
  }
  const docText = pdfText === null ? null : squash(pdfText);

  // Convert the model's raw strings into domain values; anything unusable becomes null with a flag.
  const text = (v: string) => (v.trim() === "" ? null : v.trim());
  const money = (name: PaystubField, v: string): number | null => {
    const cleaned = v.replace(/[$,\s]/g, "");
    if (cleaned === "") return null;
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
      flag("INVALID_VALUE", REQUIRED.includes(name) ? "critical" : "warning", name, `"${v}" is not a dollar amount.`);
      return null;
    }
    return dollarsToCents(Number(cleaned));
  };
  const withValue = <V>(f: { evidence: string; confidence: number }, value: V) => ({ value, evidence: text(f.evidence), confidence: f.confidence });

  const raw: Record<PaystubField, { value: string | number | null; evidence: string | null; confidence: number }> = {
    employeeName: withValue(output.employeeName, text(output.employeeName.value)),
    employerName: withValue(output.employerName, text(output.employerName.value)),
    payPeriodStart: withValue(output.payPeriodStart, text(output.payPeriodStart.value)),
    payPeriodEnd: withValue(output.payPeriodEnd, text(output.payPeriodEnd.value)),
    payDate: withValue(output.payDate, text(output.payDate.value)),
    payFrequency: withValue(output.payFrequency, output.payFrequency.value === "unknown" ? null : output.payFrequency.value),
    grossPayCents: withValue(output.grossPay, money("grossPayCents", output.grossPay.value)),
    netPayCents: withValue(output.netPay, money("netPayCents", output.netPay.value)),
    ytdGrossCents: withValue(output.ytdGrossPay, money("ytdGrossCents", output.ytdGrossPay.value)),
  };

  const paystub = {} as Record<PaystubField, PaystubExtraction[PaystubField]>;
  for (const name of Object.keys(raw) as PaystubField[]) {
    const { evidence } = raw[name];
    let { value } = raw[name];
    const confidence = Math.min(1, Math.max(0, raw[name].confidence));
    const required = REQUIRED.includes(name);
    const kind = FIELD_KIND[name];

    if (kind === "date" && typeof value === "string" && !isRealDate(value)) {
      flag("INVALID_VALUE", required ? "critical" : "warning", name, `"${value}" is not a valid date.`);
      value = null;
    }

    let evidenceVerified: boolean | null = null;
    if (value === null) {
      if (required) flag("MISSING_FIELD", "critical", name, `Required field ${name} was not found on the document.`);
    } else {
      if (docText !== null) {
        const quoteOnDocument = evidence !== null && evidence.trim() !== "" && docText.includes(squash(evidence));
        const forms = printedForms(value, kind);
        const showsValue = forms.length === 0 || (evidence !== null && forms.some((f) => squash(evidence).includes(squash(f))));
        evidenceVerified = quoteOnDocument && showsValue;
        if (!evidenceVerified) {
          flag(
            "EVIDENCE_NOT_FOUND",
            required ? "critical" : "warning",
            name,
            !quoteOnDocument
              ? `The quoted evidence for ${name} ("${evidence ?? ""}") does not appear on the document.`
              : `The quoted evidence for ${name} ("${evidence}") does not show the extracted value.`,
          );
        }
      }
      if (confidence < LOW_CONFIDENCE) {
        flag("LOW_CONFIDENCE", "warning", name, `Model confidence ${confidence.toFixed(2)} for ${name}: confirm with the applicant or employer.`);
      }
    }

    paystub[name] = { value, evidence, confidence, evidenceVerified } as PaystubExtraction[PaystubField];
  }
  const p = paystub as PaystubExtraction;

  // Cross-field consistency.
  const start = p.payPeriodStart.value;
  const end = p.payPeriodEnd.value;
  const payDate = p.payDate.value;
  if (start && end && end < start) flag("INCONSISTENT_DATES", "critical", "payPeriodEnd", "The pay period ends before it starts.");
  if (end && payDate && payDate < end) flag("INCONSISTENT_DATES", "warning", "payDate", "The pay date is before the end of the pay period.");
  const frequency = p.payFrequency.value;
  if (start && end && end >= start && frequency) {
    const length = days(start, end) + 1;
    const ranges: Record<typeof frequency, [number, number]> = { weekly: [7, 7], biweekly: [14, 14], semimonthly: [13, 16], monthly: [28, 31] };
    const [min, max] = ranges[frequency];
    if (length < min || length > max) {
      flag("PERIOD_FREQUENCY_MISMATCH", "warning", "payFrequency", `A ${length}-day pay period does not match ${frequency} pay.`);
    }
  }
  const gross = p.grossPayCents.value;
  const net = p.netPayCents.value;
  const ytd = p.ytdGrossCents.value;
  if (gross !== null && net !== null && net > gross) flag("INCONSISTENT_AMOUNTS", "critical", "netPayCents", "Net pay is greater than gross pay.");
  if (gross !== null && ytd !== null && ytd < gross) flag("INCONSISTENT_AMOUNTS", "warning", "ytdGrossCents", "Year-to-date gross is less than this period's gross.");

  return {
    ...base,
    documentType: "pay_stub",
    paystub: p,
    flags,
    needsManualReview: flags.some((f) => f.severity === "critical"),
  };
}
