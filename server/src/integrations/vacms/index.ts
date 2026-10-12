import { readFileSync } from "node:fs";
import { HouseholdRecordSchema, type HouseholdRecord } from "@caseflow/shared";
import { assertField, parseCopybook } from "../copybook";
import { parseFixedWidth, type RawRecord } from "../fixed-width";
import { describeError, digits, indicator, isoDate, MappingError, num, personName, str } from "../mapping";
import type { HouseholdSource, IntegrationReject } from "../ports";

/** Illustrative VaCMS household extract layout. Not the real VaCMS interface (see the copybook header and ADR-0006). */
export const VACMS_HOUSEHOLD_LAYOUT = parseCopybook(readFileSync(new URL("./HH-EXTRACT.cpy", import.meta.url), "utf8"));
for (const money of ["HH-UNEARNED-AMT", "HH-SHELTER-AMT", "HH-RESOURCES-AMT"]) {
  assertField(VACMS_HOUSEHOLD_LAYOUT, money, { kind: "numeric", scale: 2 });
}

export const DEFAULT_VACMS_EXTRACT = new URL("../../../data/vacms/HH-EXTRACT.DAT", import.meta.url);

const LANGUAGES = { EN: "en", ES: "es" } as const;

export function toHouseholdRecord(raw: RawRecord): HouseholdRecord {
  const lang = str(raw, "HH-LANG-CD");
  if (!(lang in LANGUAGES)) throw new MappingError(`HH-LANG-CD must be EN or ES, found "${lang}"`);
  const unearnedSource = str(raw, "HH-UNEARNED-SRC");

  return HouseholdRecordSchema.parse({
    caseNumber: str(raw, "HH-CASE-NUMBER"),
    localityFips: digits(raw, "HH-LOCALITY-FIPS", 3),
    headOfHousehold: personName(raw, "HH-HEAD-NAME"),
    ssn: digits(raw, "HH-SSN", 9),
    dateOfBirth: isoDate(raw, "HH-DOB"),
    applicationDate: isoDate(raw, "HH-APPL-DATE"),
    householdSize: num(raw, "HH-SIZE"),
    hasElderlyOrDisabledMember: indicator(raw, "HH-ELD-DIS-IND"),
    broadBasedCategoricallyEligible: indicator(raw, "HH-BBCE-IND"),
    monthlyUnearnedIncomeCents: num(raw, "HH-UNEARNED-AMT"),
    unearnedIncomeSource: unearnedSource === "" || unearnedSource === "NONE" ? null : unearnedSource,
    monthlyShelterCostCents: num(raw, "HH-SHELTER-AMT"),
    paysHeatingOrCooling: indicator(raw, "HH-HEAT-COOL-IND"),
    countableResourcesCents: num(raw, "HH-RESOURCES-AMT"),
    preferredLanguage: LANGUAGES[lang as keyof typeof LANGUAGES],
    address: {
      line1: str(raw, "HH-ADDR-LINE-1"),
      city: str(raw, "HH-ADDR-CITY"),
      state: str(raw, "HH-ADDR-STATE"),
      zip: digits(raw, "HH-ADDR-ZIP", 5),
    },
  });
}

/** Read-only HouseholdSource backed by a VaCMS fixed-width extract. */
export class VacmsHouseholdExtract implements HouseholdSource {
  private constructor(
    private readonly byCase: ReadonlyMap<string, HouseholdRecord>,
    readonly rejects: readonly IntegrationReject[],
  ) {}

  static fromText(text: string, source = "VaCMS HH-EXTRACT"): VacmsHouseholdExtract {
    const { records, rejects: structural } = parseFixedWidth(text, VACMS_HOUSEHOLD_LAYOUT);
    const rejects: IntegrationReject[] = structural.map((r) => ({ source, ...r }));
    const byCase = new Map<string, HouseholdRecord>();

    for (const { line, values } of records) {
      try {
        const household = toHouseholdRecord(values);
        if (byCase.has(household.caseNumber)) {
          rejects.push({ source, line, reason: `Duplicate case number ${household.caseNumber}` });
          continue;
        }
        byCase.set(household.caseNumber, household);
      } catch (error) {
        rejects.push({ source, line, reason: describeError(error) });
      }
    }
    return new VacmsHouseholdExtract(byCase, rejects);
  }

  static fromFile(path: URL | string = DEFAULT_VACMS_EXTRACT): VacmsHouseholdExtract {
    return VacmsHouseholdExtract.fromText(readFileSync(path, "utf8"));
  }

  async getHousehold(caseNumber: string): Promise<HouseholdRecord | undefined> {
    return this.byCase.get(caseNumber.trim());
  }

  async listHouseholds(): Promise<HouseholdRecord[]> {
    return [...this.byCase.values()];
  }
}
