# CaseFlow — Product & Technical Specification

> Human-in-the-loop AI for SNAP casework in Virginia.
> **Independent demo.** Not affiliated with or endorsed by Arlington County, the Virginia Department of Social Services (VDSS), or the Virginia Employment Commission (VEC). Synthetic data only. Simplified policy. Not for real eligibility decisions.

## 1. The problem

Federal regulation requires a decision on a SNAP application within **30 days** (7 CFR 273.2(g); VDSS Manual Part X.B). Most of a Benefit Programs Specialist's time does not go into judgment. It goes into paperwork:

- reading pay stubs and re-keying the numbers
- comparing them with state wage records
- doing the eligibility arithmetic
- writing the Notice of Action

When applications spike, backlogs grow and families wait.

Agencies want two things that pull against each other:

1. **Speed.** Automate the paperwork.
2. **Trust.** Every decision must be correct, explainable, appealable and auditable, and made by an accountable person.

## 2. Operating context: Virginia

| Role | Organization | What it does |
|---|---|---|
| Local agency (CaseFlow's user) | **Arlington County Department of Human Services, Economic Independence Division** | Takes SNAP applications, online through CommonHelp or in person. Benefit Programs Specialists determine eligibility. |
| State agency | **Virginia Department of Social Services (VDSS)** | Supervises SNAP statewide. Publishes the SNAP Manual (Volume V). Operates the statewide eligibility system. |
| System of record | **VaCMS** (Virginia Case Management System) | Statewide eligibility and case management. Localities began processing SNAP in VaCMS in October 2016. The remaining cases on **ADAPT**, the earlier mainframe eligibility system, were converted to VaCMS in early 2017, and ADAPT was retired. VDSS's 2024–2026 IT strategic plan describes migrating VaCMS to a low-code platform. |
| Wage data | **Virginia Employment Commission (VEC)** | Quarterly wage records reported by employers. VDSS lists them as a verification source for earned income (Manual Part XI.C). Under federal IEVS rules, wage-match results are leads to follow up, not verified income (7 CFR 272.8). |

**CaseFlow's position:** a decision-support layer for the local agency's Benefit Programs Specialists.
- It **reads** from VaCMS and the VEC quarterly wage match.
- It **never writes** to the system of record.
- It does not replace VaCMS.

**Interface formats:** the record layouts in this repo are **illustrative**. They model the fixed-width batch exchanges common between state systems. They are not the actual VaCMS or VEC interface specifications, which are not public.

## 3. Users

| User | Needs |
|---|---|
| **Benefit Programs Specialist (BPS)** (primary) | Process more cases per day without losing accuracy. See *why* the system recommends something. Stay in control. |
| **BPS supervisor / quality assurance** | Reconstruct any decision: who decided, when, on what evidence, under which policy version. |
| **Applicant** | A clear, correct Notice of Action in their language explaining the decision and their right to appeal. |

## 4. Core principle

> **AI works at the edges, where unstructured information becomes structured and back again. Deterministic code makes the decision. A BPS approves it.**

| Step | Who does it | Why |
|---|---|---|
| Read documents → structured data | **AI** (Claude) | Unstructured input; this is where AI adds the most value |
| Fetch VaCMS household + VEC wage records | Code (adapter) | Deterministic, read-only integration |
| Verify reported vs. recorded income | Code | Must be repeatable and explainable |
| Determine eligibility and benefit | Code (rules engine + versioned Virginia policy) | Must be correct, auditable and appealable. **Never AI.** |
| Approve or override | **Human** (BPS) | Accountability stays with a person |
| Draft Notice of Action | **AI**, then checked by code | Plain language and translation; code verifies every number |

## 5. End-to-end flow

```
BPS opens case ─► uploads documents
   │
   ▼
[1] INTAKE (AI)            classify each document; extract pay-stub fields + evidence quotes + confidence
   ▼
[2] RECORDS LOOKUP         adapter reads the VaCMS household extract + VEC quarterly wage records (read-only)
   ▼
[3] VERIFY                 convert pay to monthly income (VA factors); compare with VEC wages; flag mismatches, missing docs, low confidence
   ▼
[4] DETERMINE              rules engine picks policy version by application date → BBCE or standard path → decision + cited trace
   ▼
[5] REVIEW (human) ⏸       BPS approves, or overrides with a required reason
   ▼
[6] NOTICE (AI + guard)    plain-language Notice of Action (EN/ES) from the trace; PII tokenized; numbers checked against the decision
   ▼
Every step appends an event ─► audit timeline
```

**Failure rule:** if any AI step fails, times out, returns low confidence or fails validation, the case goes to **manual review** with the reason recorded. AI failure never blocks or decides a case.

## 6. Functional requirements

### Must have (demo path)

- **F1** Case queue: cases with status, applicant, flags and days remaining in the 30-day processing standard.
- **F2** Document upload (PDF) on a case.
- **F3** Intake agent:
  - classifies the document (pay stub / other)
  - extracts structured pay-stub fields, each with an evidence quote and a confidence score
- **F4** Virginia records adapter:
  - parses the illustrative **VaCMS household extract** and the **VEC quarterly wage-match file**, both fixed-width
  - field layouts come from their COBOL-style copybooks
  - read-only; records are never modified
- **F5** Verification:
  - converts pay to monthly income with Virginia's factors (weekly × 4.3, biweekly × 2.15, semimonthly × 2; 22VAC40-601-20)
  - compares it with VEC quarterly wages and flags differences above a set threshold, as an IEVS lead for the BPS
  - flags identity mismatches
- **F6** Rules engine:
  - Virginia SNAP policy as versioned data (FY2026, FY2027)
  - broad-based categorical eligibility (BBCE) path and standard path
  - Virginia utility standard tiers
  - every trace line cites both the federal regulation and the VDSS Manual section
  - flags provisional values when a determination relies on them
- **F7** BPS review: approve, or override with a mandatory reason.
- **F8** Notice agent:
  - writes the Notice of Action in English and Spanish
  - personal data replaced with tokens before the AI call and restored afterward
  - a deterministic guard checks the amounts, the decision and the appeal-rights paragraph
- **F9** Append-only event log and an audit timeline view per case.
- **F10** Live pipeline progress in the UI (server-sent events).
- **F11** Eval harness: synthetic documents with known answers → extraction accuracy report.
- **F12** Automated tests (rules engine, adapter, verification, guard) and CI.

### Stretch

- **S1** Policy what-if simulator: change a parameter, see how many households' outcomes change.
- **S2** Cloud deployment.
- **S3** Automated accessibility check (axe) in CI.
- **S4** Applicant-facing intake portal.

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| **Auditability** | Every state change is an immutable event: actor, timestamp, payload, policy version. Current state is rebuilt from events. |
| **Explainability** | Every determination has a human-readable trace, one line per rule, citing 7 CFR and the VDSS Manual. |
| **Data provenance** | Each policy version lists its sources. Values not yet officially published are marked provisional, and determinations that use them say so. |
| **Privacy** | Minimum personal data sent to AI. Names, SSNs and case numbers are tokenized for notice generation. Synthetic data only. |
| **Accessibility** | U.S. Web Design System components, targeting WCAG 2.1 AA / Section 508. |
| **Resilience** | AI failures degrade to manual review; the rules engine and UI work without AI. |
| **Security** | Secrets only in `.env` (never committed). Uploads are type- and size-checked. Integration access is read-only. |

## 8. Virginia policy scope (deliberate simplifications)

**Modeled.** Cites are VDSS SNAP Manual Volume V parts and federal regulations.

| Rule | Virginia treatment | Source |
|---|---|---|
| **BBCE** (most Virginia households) | Gross income ≤ 200% of poverty; no resource test and no net income test; net income still sets the benefit. Above 200%, the household falls back to the standard tests. | Pt. XI.A, IX.B, II.G.3 |
| Standard tests (not BBCE-eligible) | 130% gross test (not applied to elderly/disabled households), 100% net test, resource limit ($3,000; higher limit for elderly/disabled) | Pt. XI.A, IX.B; 7 CFR 273.8, 273.9(a) |
| Earned income deduction | 20% | Pt. X.A.2 |
| Standard deduction | Federal amounts by household size (1–3, 4, 5, 6+), restated by VDSS | Pt. X.A.1 |
| Excess shelter deduction | Over 50% of adjusted income, capped; no cap for elderly/disabled | Pt. X.A.4 |
| Standard utility allowance | One **statewide** standard, tiered by persons in the residence (1–3 / 4+). FY2026: $375 / $476. | Pt. X.A.4.e |
| Income conversion | weekly × 4.3, biweekly × 2.15, semimonthly × 2 | 22VAC40-601-20 |
| Benefit | Max allotment − 30% of net income (rounded up); minimum benefit for 1–2 person households | 7 CFR 273.10(e)(2); Pt. XIII |

**Policy versions:**
- **FY2026:** every value matches VDSS Transmittal #36 (effective 2025-10-01).
- **FY2027:** federal values follow the USDA FY2027 COLA memo. Virginia's utility standard and BBCE limit are **provisional** until VDSS publishes its FY2027 transmittal.

**Notes on Virginia specifics:**
- Virginia has no regional (e.g., Northern Virginia) utility standard; VDSS sets one statewide standard.
- The standard deduction tiers are federal amounts that VDSS restates, not Virginia-specific figures.

**Not modeled:**
- actual utility costs, the telephone standard, and proration of the utility standard in shared residences (CaseFlow assumes the residence equals the SNAP household)
- LIHEAP-conferred utility standard rules (P.L. 119-21)
- medical deductions (including Virginia's $200 medical standard deduction), dependent care and child support deductions
- the homeless shelter standard
- traditional categorical eligibility (TANF/SSI) and VaCAP
- work requirements (ABAWD)
- student and immigrant rules
- expedited service
- first-month proration

## 9. Out of scope

- Real authentication. A BPS picker stands in for single sign-on.
- Real personal data.
- Writing back to VaCMS.
- Any agency's logos, seals or official-website banners.
- Production hosting hardening.

## 10. Success criteria for the demo

1. In under 5 minutes, a pay stub goes from upload to an approved decision, with a live pipeline view.
2. The trace explains the benefit line by line, citing both 7 CFR and the VDSS Manual.
3. A seeded mismatch is caught and flagged as an IEVS lead: the stub shows less income than the VEC wage records. The BPS then overrides with a reason, and the audit timeline shows it.
4. The same Arlington household gets **$541** under FY2026 and **$568** under FY2027, and the trace names the policy version and flags the provisional FY2027 Virginia values.
5. A household with $5,000 in savings is eligible in Virginia through BBCE, and the trace shows why the resource test does not apply.
6. The eval report shows extraction accuracy on the synthetic test set.
