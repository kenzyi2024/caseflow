# ADR-0007: PII minimization and guardrails around AI calls

- **Status:** Accepted
- **Date:** 2026-10-11

## Context
Applicant data is sensitive: names, SSNs, income, addresses. AI-written letters could contain an incorrect dollar amount or an invented reason. A wrong number in a Notice of Action is a legal problem, not a typo: it can trigger an overissuance claim or a fair hearing.

## Decision
1. **Minimize.** Each AI call gets only the data it needs.
   - The intake step must see the document itself.
   - The Notice of Action step does **not** need identities. It receives the decision trace with personal data replaced by tokens (`{{APPLICANT_NAME}}`, `{{CASE_NUMBER}}`), which code fills in afterward.
2. **Constrain.** Every AI response must match a Zod schema (structured outputs). If it doesn't match, the step fails.
3. **Verify.** A deterministic **notice guard** checks the generated letter:
   - the decision (approved/denied) matches the determination
   - every dollar amount in the letter equals the engine's figures
   - the fair hearing / appeal rights paragraph is present
   - no unreplaced tokens remain

   Any failure → regenerate once → otherwise send to manual review.
4. **Evidence.** Intake extraction returns, for each field, a quote from the document and a confidence score. Fields below the confidence threshold are flagged for the caseworker.
5. **Hosting (production note).** Claude is available through the Anthropic API and through major cloud providers. A real deployment would use whichever option the agency has authorized within its security boundary, under its data-retention terms. The demo uses the Anthropic API with synthetic data only.

## Consequences
- Identity data never reaches the letter-writing model.
- No letter can contain a number that the rules engine did not produce.
- A small set of documents will need manual handling. That is intended behavior, not failure.

## In plain language
"The AI only sees what it needs. Before any letter goes out, the system checks every number in it against the official calculation, and if anything doesn't match, a person handles it."
