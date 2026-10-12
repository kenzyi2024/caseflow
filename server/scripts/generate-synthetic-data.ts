/**
 * Regenerates the synthetic interface files from fixtures/scenarios.ts:
 *   server/data/vacms/HH-EXTRACT.DAT   (illustrative VaCMS household extract)
 *   server/data/vec/QTR-WAGE.DAT       (illustrative VEC quarterly wage match)
 *   server/data/documents/*.pdf        (pay stubs + a distractor) and manifest.json (eval answer key)
 * Run: npm run seed
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { WageRecord } from "@caseflow/shared";
import { encodeRecord } from "../src/integrations/fixed-width";
import { DEFAULT_VACMS_EXTRACT, VACMS_HOUSEHOLD_LAYOUT } from "../src/integrations/vacms";
import { DEFAULT_VEC_WAGE_FILE, VEC_WAGE_LAYOUT } from "../src/integrations/vec";
import { householdToRaw, wageToRaw } from "../fixtures/encode";
import { SCENARIOS, UNRELATED_VEC_WAGES } from "../fixtures/scenarios";
import { DOCUMENTS } from "../fixtures/paystubs";
import { renderDocument } from "../fixtures/render-documents";

// Safety net: synthetic SSNs must be in the 900–999 area range, which the SSA never assigns.
const ssns = [...SCENARIOS.map((s) => s.household.ssn), ...UNRELATED_VEC_WAGES.map((w) => w.ssn)];
for (const ssn of ssns) {
  if (!/^9\d{8}$/.test(ssn)) throw new Error(`Refusing to write non-synthetic SSN ${ssn}`);
}

const households = SCENARIOS.map((s) => encodeRecord(householdToRaw(s.household), VACMS_HOUSEHOLD_LAYOUT));

const wages: WageRecord[] = [
  ...SCENARIOS.flatMap((s) =>
    s.vecWages.map((w) => ({
      ssn: s.household.ssn,
      employeeName: `${s.household.headOfHousehold.last},${s.household.headOfHousehold.first}`,
      ...w,
    })),
  ),
  ...UNRELATED_VEC_WAGES,
];
const wageLines = wages.map((w) => encodeRecord(wageToRaw(w), VEC_WAGE_LAYOUT));

function write(url: URL, lines: string[]) {
  const path = fileURLToPath(url);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join("\n") + "\n");
  console.log(`wrote ${lines.length} records → ${path}`);
}

write(DEFAULT_VACMS_EXTRACT, households);
write(DEFAULT_VEC_WAGE_FILE, wageLines);

const documentsDir = new URL("../data/documents/", import.meta.url);
rmSync(documentsDir, { recursive: true, force: true });
mkdirSync(documentsDir, { recursive: true });
for (const doc of DOCUMENTS) {
  writeFileSync(new URL(doc.fileName, documentsDir), await renderDocument(doc));
}
const manifest = DOCUMENTS.map(({ fileName, scenarioId, kind, expected }) => ({ fileName, scenarioId, kind, expected }));
writeFileSync(new URL("manifest.json", documentsDir), JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${DOCUMENTS.length} documents + manifest.json → ${fileURLToPath(documentsDir)}`);
