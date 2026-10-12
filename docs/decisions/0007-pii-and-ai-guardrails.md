# ADR-0007: PII minimization and guardrails around AI calls

- **Status:** Accepted
- **Date:** 2026-10-11

## Context
Applicant data is sensitive: names, SSNs, income, addresses. AI-written letters could contain an incorrect dollar amount or an invented reason. A wrong number in a Notice of Action is a legal problem, not a typo: it can trigger an overissuance claim or a fair hearing.

## Decision
1. **Minimize.** Each AI call gets only the data it needs.
   - The intake step must see the document itself.
   - The Notice of Action step does **not** need identities. It receives the decision trace with personal data replaced by tokens (`{{APPLICANT_NAME}}`, `{{CASE_NUMBER}}`), which code fills in afterward.
2. **Constrain.** Every AI response must match a Zod schema (structured outputs). If it doesn't match, the step fails. The model returns plain strings; code parses dates and amounts, so parsing is deterministic and unit-tested.
3. **Verify.** A deterministic **notice guard** checks the generated letter:
   - the decision (approved/denied) matches the determination
   - every dollar amount in the letter equals the engine's figures
   - the fair hearing / appeal rights paragraph is present
   - no unreplaced tokens remain

   Any failure → regenerate once → otherwise send to manual review.
4. **Evidence, checked by code.** For each pay-stub field, intake returns the exact text it read the value from, plus a confidence score. Code then confirms two things:
   - the quoted text exists in the PDF's own text layer, which catches invented quotes
   - the quote actually shows the extracted value, which catches, for example, year-to-date pay read as this period's gross

   Required fields that fail either check, or are missing, send the document to manual review. Fields below 0.8 confidence are flagged for the BPS to confirm, for example a pay frequency the model had to infer from the dates. Scans with no text layer are labeled "evidence not verifiable."
5. **Hosting (production note).** Claude is available through the Anthropic API and through major cloud providers. A real deployment would use whichever option the agency has authorized within its security boundary, under its data-retention terms. The demo uses the Anthropic API with synthetic data only.

## Consequences
- Identity data never reaches the letter-writing model.
- No letter can contain a number that the rules engine did not produce.
- A small set of documents will need manual handling. That is intended behavior, not failure.

## In plain language
"The AI only sees what it needs. Before any letter goes out, the system checks every number in it against the official calculation, and if anything doesn't match, a person handles it."
