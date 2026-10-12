# ADR-0006: Integrate VaCMS and VEC wage data through a read-only adapter

- **Status:** Accepted (revised 2026-10-11: re-grounded in Virginia; replaces the fictional ARDEN-BEN mainframe)
- **Date:** 2026-10-11

## Context
A local department of social services such as Arlington County DHS does not own the statewide system of record.

- **VaCMS** is the statewide system of record. VDSS operates it.
  - SNAP processing moved into VaCMS in October 2016.
  - The remaining cases on the older **ADAPT** mainframe were converted in early 2017, and ADAPT was retired.
  - VDSS's 2024–2026 IT strategic plan describes migrating VaCMS to a low-code platform. Whatever CaseFlow integrates with today will change underneath it.
- **Earned income** is checked against **VEC quarterly wage records**.
  - Exchanges like this between state systems are commonly batch files of fixed-width records, described by COBOL copybooks (`PIC X(20)`, `PIC 9(7)V99`).
  - Under federal IEVS rules (7 CFR 272.8), a wage-match result is a lead to follow up, not verified income.

The real VaCMS and VEC interface specifications are not public.

## Options considered
| Option | For | Against |
|---|---|---|
| **Read-only adapter at one boundary** | No changes to VaCMS; the rest of CaseFlow sees clean typed objects; a VaCMS platform migration changes one module | Two systems coexist |
| Build the features inside VaCMS | One system | A local agency cannot change the statewide system; slow; out of our control |
| Read interface files directly throughout the code | Quick | Format details leak everywhere; a migration breaks everything |

## Decision
- One integration boundary, `server/src/integrations/`, is the **only** code that knows interface formats:
  - `vacms/`: household extract (case number, head of household, household size, elderly/disabled indicator, shelter costs, utility responsibility, resources, preferred language)
  - `vec/`: quarterly wage records (SSN, employer account and name, quarter, wages)
- Field layouts are read from **copybook files**, not hard-coded offsets.
- The adapter converts interface formats into the shared Zod types:
  - `SMITH,JONATHAN` → structured name
  - implied decimals → integer cents
  - `20260630` → ISO date
- **Read-only.** CaseFlow never writes to the system of record.
- VEC wage data is used only to raise **discrepancy flags** for the BPS. It never overrides the applicant's verified pay stub automatically.
- The layouts are labeled **illustrative** in the code and docs.

## Consequences
- When VDSS moves VaCMS to a new platform, only the adapter changes.
- Copybook parsing covers the subset of picture clauses we use: `X(n)`, `9(n)`, `9(n)V9(m)`.
- A real engagement would replace the illustrative layouts with the official interface control documents from VDSS and VEC.

## In plain language
"We don't touch the state's system of record. We built one translator that reads the household and wage data our tool needs, so when the state upgrades its platform, only that translator has to change."
