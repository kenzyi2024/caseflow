# ADR-0003: Virginia SNAP policy as versioned, effective-dated data

- **Status:** Accepted (revised 2026-10-11: anchored in the VDSS SNAP Manual)
- **Date:** 2026-10-11

## Context
SNAP policy in Virginia has two layers:

1. **Federal standards** change every **October 1** (USDA cost-of-living adjustment): income limits, maximum allotments, standard deductions, the shelter cap.
2. **Virginia's state options** are published by VDSS in SNAP Manual Volume V through numbered transmittals, for example Transmittal #36, effective 2025-10-01. They include:
   - broad-based categorical eligibility at 200% of poverty, with no resource test
   - the statewide standard utility allowance, tiered by persons in the residence
   - income conversion factors, set in the Virginia Administrative Code (22VAC40-601-20)

The formulas change only when federal regulation changes. An application must be judged under the policy in force **on its application date**. Sometimes the federal figures for a new year are out before the state's transmittal is.

## Options considered
| Option | For | Against |
|---|---|---|
| **Versioned policy data (federal + Virginia layers) + small engine we write** | Yearly changes are data edits; each decision records its version; trace built in | We own the engine code |
| Plain functions with hardcoded numbers | Fastest to write | Every yearly update is a code change; versions get mixed up |
| Off-the-shelf rules library | Less code | Core logic is a black box; hard to cite the manual |

## Decision
- **One JSON file per fiscal year** (`snap-fy2026.json`, `snap-fy2027.json`). Each holds:
  - an effective date range
  - `parameters`: the federal standards
  - `stateOptions`: Virginia's choices, plus the manual transmittal they come from
  - a list of sources
- **Provisional values are explicit.** If a figure is not yet officially published, it is listed under `provisional` with the reason. Example: the FY2027 Virginia utility standard is carried forward until VDSS publishes it.
  - The engine records which provisional values each determination actually used.
  - The trace says so.
- **Formulas live in reviewed code.** Each rule is a small pure function that:
  - cites **both** the federal regulation and the VDSS Manual section (e.g., `7 CFR 273.9(d)(1) · VDSS Manual Pt. X.A.1`)
  - reads its numbers only from the policy file
  - appends a trace line
- **Two eligibility paths, in VDSS order:**
  - BBCE (gross ≤ 200% of poverty; resource and net tests do not apply)
  - otherwise the standard federal tests
- **Version selection is automatic,** by application date.
- **Money is handled in whole cents (integers).** Rounding is applied only where policy says so.

## Consequences
- The October 1 update means editing data, plus a test that the file reproduces the official VDSS tables. FY2026 already has one.
- Past decisions can be re-run exactly under the policy in force at the time, which matters for appeals.
- No determination silently relies on an unconfirmed number.
- A new formula still needs code, tests and review, which is appropriate for a change in law.

## In plain language
"The numbers that change every year live in a policy file with start and end dates, built from the same Virginia manual Benefit Programs Specialists use. Every decision points to the exact manual section, and if any number isn't officially published yet, the decision says so."
