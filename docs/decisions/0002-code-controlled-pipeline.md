# ADR-0002: Code-controlled pipeline; AI only at the unstructured edges

- **Status:** Accepted
- **Date:** 2026-10-11

## Context
SNAP decisions affect whether Virginia families can buy food. They must be correct, repeatable and explainable, and an applicant must be able to appeal them. AI is very good at reading messy documents and writing clear language. It is not appropriate as the decision-maker for a legal entitlement: its output can vary between runs, and it cannot cite a rule the way code can.

## Options considered
| Option | For | Against |
|---|---|---|
| **Code-controlled pipeline** (code fixes the steps; each AI step is one limited call with a strict output schema) | Predictable, testable, auditable; failures are contained to one step | Less flexible for unusual cases |
| Autonomous agent (one model with tools decides the order and calls tools itself) | Flexible; handles novel situations | Non-deterministic paths, hard to test and audit, riskier in production and in a live demo |

## Decision
A fixed pipeline: `intake → legacy lookup → verify → determine → human review → notice`.

- **AI is used only where information changes form:**
  - documents → structured data (intake)
  - structured decision → plain-language letter (notice)
- **Verification and eligibility are deterministic code.** No AI.
- Each AI call returns JSON constrained by a Zod schema (structured outputs). Anything that fails validation is rejected, not guessed at.
- **Graceful degradation:** any AI failure (error, timeout, low confidence, schema or guard failure) sends the case to manual review with the reason logged.

## Consequences
- The decision path can be unit-tested exhaustively; AI quality is measured separately with an eval set.
- Model updates cannot silently change eligibility outcomes.
- Some work stays manual, by design. Unusual documents fall back to a Benefit Programs Specialist (BPS).
- If agency needs grow, individual steps can become more agentic, for example a document agent that asks for a missing pay stub, without touching the decision core.

## In plain language
"The AI does the reading and the writing. The math and the rules are done by code that gives the same answer every time and can point to the regulation. A Benefit Programs Specialist signs off on every decision."
