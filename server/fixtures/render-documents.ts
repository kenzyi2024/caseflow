import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { DocumentSpec, OtherDocSpec, PaystubSpec } from "./paystubs";

/** Renders synthetic documents as real PDFs (with a text layer), in two employer layouts. */

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const FREQUENCY_LABEL = { weekly: "Weekly", biweekly: "Bi-Weekly", semimonthly: "Semi-Monthly", monthly: "Monthly" } as const;
const GREY = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.75, 0.75, 0.75);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

function text(page: PDFPage, s: string, x: number, y: number, font: PDFFont, size = 9, color = rgb(0, 0, 0)) {
  page.drawText(s, { x, y, size, font, color });
}

function right(page: PDFPage, s: string, xRight: number, y: number, font: PDFFont, size = 9) {
  page.drawText(s, { x: xRight - font.widthOfTextAtSize(s, size), y, size, font });
}

function rule(page: PDFPage, y: number) {
  page.drawLine({ start: { x: 48, y }, end: { x: 564, y }, thickness: 0.75, color: LINE });
}

export async function renderDocument(spec: DocumentSpec): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(spec.kind === "paystub" ? `Earnings statement - ${spec.employer.name}` : "Utility statement");
  pdf.setProducer("CaseFlow synthetic data generator");
  pdf.setCreationDate(new Date("2026-10-01T12:00:00Z"));
  pdf.setModificationDate(new Date("2026-10-01T12:00:00Z"));
  const page = pdf.addPage([612, 792]);
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };

  if (spec.kind === "utility_bill") renderUtilityBill(page, spec, fonts);
  else if (spec.template === "A") renderTemplateA(page, spec, fonts);
  else renderTemplateB(page, spec, fonts);

  text(page, "SYNTHETIC DOCUMENT FOR A SOFTWARE DEMO - NOT A REAL RECORD", 48, 40, fonts.regular, 7, GREY);
  return pdf.save({ useObjectStreams: false });
}

/** Classic "earnings statement" table. */
function renderTemplateA(page: PDFPage, s: PaystubSpec, { regular, bold }: Fonts) {
  const e = s.expected;
  let y = 740;
  text(page, s.employer.name, 48, y, bold, 14);
  right(page, "EARNINGS STATEMENT", 564, y, bold, 12);
  y -= 14;
  text(page, s.employer.address, 48, y, regular, 9, GREY);
  y -= 30;

  text(page, `Employee: ${s.employeeName}`, 48, y, bold, 10);
  text(page, `Employee ID: ${s.employeeId}`, 380, y, regular);
  y -= 13;
  text(page, s.employeeAddress, 48, y, regular);
  text(page, `SSN: XXX-XX-${s.ssnLast4}`, 380, y, regular);
  y -= 22;
  text(page, `Pay Period: ${usDate(e.payPeriodStart!)} - ${usDate(e.payPeriodEnd!)}`, 48, y, regular, 10);
  text(page, `Pay Date: ${usDate(e.payDate!)}`, 300, y, regular, 10);
  if (s.printFrequency) text(page, `Pay Frequency: ${FREQUENCY_LABEL[e.payFrequency!]}`, 430, y, regular, 10);
  y -= 16;
  rule(page, y);

  y -= 16;
  text(page, "EARNINGS", 48, y, bold);
  right(page, "HOURS", 290, y, bold);
  right(page, "RATE", 370, y, bold);
  right(page, "CURRENT", 470, y, bold);
  right(page, "YEAR TO DATE", 564, y, bold);
  y -= 14;
  text(page, "Regular", 48, y, regular);
  right(page, s.hours.toFixed(2), 290, y, regular);
  right(page, money(s.rateCents), 370, y, regular);
  right(page, money(e.grossPayCents!), 470, y, regular);
  right(page, money(e.ytdGrossCents!), 564, y, regular);
  y -= 12;
  rule(page, y);

  y -= 16;
  text(page, "DEDUCTIONS", 48, y, bold);
  right(page, "CURRENT", 470, y, bold);
  for (const d of s.deductions) {
    y -= 13;
    text(page, d.label, 48, y, regular);
    right(page, money(d.cents), 470, y, regular);
  }
  y -= 12;
  rule(page, y);

  const totalDeductions = s.deductions.reduce((sum, d) => sum + d.cents, 0);
  y -= 20;
  text(page, `GROSS PAY  ${money(e.grossPayCents!)}`, 48, y, bold, 11);
  text(page, `TOTAL DEDUCTIONS  ${money(totalDeductions)}`, 220, y, bold, 11);
  right(page, `NET PAY  ${money(e.netPayCents!)}`, 564, y, bold, 11);
}

/** "Advice of deposit" layout with different labels: Check Date, Period Beginning/Ending, Total Gross, Net Deposit. */
function renderTemplateB(page: PDFPage, s: PaystubSpec, { regular, bold }: Fonts) {
  const e = s.expected;
  let y = 740;
  text(page, "ADVICE OF DEPOSIT", 48, y, bold, 13);
  right(page, s.employer.name, 564, y, bold, 11);
  y -= 13;
  right(page, s.employer.address, 564, y, regular, 8);
  y -= 30;

  const rows: [string, string][] = [
    ["Name", s.employeeName],
    ["Employee No.", s.employeeId],
    ["Period Beginning", usDate(e.payPeriodStart!)],
    ["Period Ending", usDate(e.payPeriodEnd!)],
    ["Check Date", usDate(e.payDate!)],
    ...(s.printFrequency ? ([["Pay Cycle", FREQUENCY_LABEL[e.payFrequency!]]] as [string, string][]) : []),
  ];
  for (const [label, value] of rows) {
    text(page, `${label}:`, 48, y, bold, 9);
    text(page, value, 150, y, regular, 9);
    y -= 13;
  }
  y -= 8;
  rule(page, y);

  y -= 16;
  text(page, "Description", 48, y, bold);
  right(page, "Hrs", 300, y, bold);
  right(page, "Rate", 380, y, bold);
  right(page, "This Period", 470, y, bold);
  right(page, "YTD", 564, y, bold);
  y -= 14;
  text(page, "Hourly Wages", 48, y, regular);
  right(page, s.hours.toFixed(2), 300, y, regular);
  right(page, money(s.rateCents), 380, y, regular);
  right(page, money(e.grossPayCents!), 470, y, regular);
  right(page, money(e.ytdGrossCents!), 564, y, regular);
  y -= 16;
  text(page, "Total Gross", 48, y, bold);
  right(page, money(e.grossPayCents!), 470, y, bold);
  right(page, money(e.ytdGrossCents!), 564, y, bold);
  y -= 12;
  rule(page, y);

  y -= 16;
  text(page, "Taxes and Withholdings", 48, y, bold);
  for (const d of s.deductions) {
    y -= 13;
    text(page, d.label, 60, y, regular);
    right(page, `-${money(d.cents)}`, 470, y, regular);
  }
  y -= 22;
  text(page, "Net Deposit", 48, y, bold, 11);
  right(page, `$${money(e.netPayCents!)}`, 470, y, bold, 11);
}

function renderUtilityBill(page: PDFPage, s: OtherDocSpec, { regular, bold }: Fonts) {
  let y = 740;
  s.lines.forEach((line, i) => {
    text(page, line, 48, y, i === 0 ? bold : regular, i === 0 ? 14 : 10);
    y -= i === 0 ? 24 : 15;
  });
}
