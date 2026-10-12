# ADR-0008: A BPS changes facts, not outcomes

- **Status:** Accepted
- **Date:** 2026-10-12

## Context
After the pipeline runs, a Benefit Programs Specialist (BPS) reviews the case. Sometimes the system's facts are incomplete. The commonest example is a VEC wage match showing an employer the applicant didn't report. The BPS needs a way to act on what they learn. How they act decides whether the result stays explainable.

## Options considered
| Option | For | Against |
|---|---|---|
| **BPS corrects facts with a reason; the rules engine re-determines** | Every benefit amount still comes from the rules engine and has a full trace; the correction and its reason are in the audit log | The BPS can only change the facts the system models |
| BPS overrides the decision or benefit amount directly | Maximum flexibility | Breaks explainability: the trace no longer explains the number; manual arithmetic errors; harder to defend at a fair hearing |

## Decision
- A BPS has three actions:
  - **revise facts** (with a reason of at least 10 characters): earned or unearned income, shelter cost, utility responsibility, resources. The rules engine then produces a new determination, marked `basis: bps_revision`.
  - **approve**
  - **pend for verification** (with a reason)
- Nobody types a benefit amount. Every amount comes from the engine, with its trace.
- **Verification can suggest a revision.** An unreported-employer flag carries a one-click change, such as "count Fernway wages ($980/month, from VEC)". It is never applied automatically, because an IEVS lead is not verified income.
- **Open action-required flags block silent approval.** Approving while one is open requires a note explaining why. Revising facts against the current verification resolves them.
- **Revisions apply only to the verification they were made against.** If new documents are uploaded and the pipeline re-runs, earlier revisions are not carried over, so nothing is double counted. The BPS re-applies what is still true.
- **Every action is an event** naming the BPS. The full sequence (original determination, revision with reason, new determination, approval) is the case's audit trail.

## Consequences
- At a fair hearing, the agency can show exactly which facts changed, who changed them, why, and how the benefit followed from them.
- Cases with an AI failure are completed the same way: the BPS reads the document and enters the income as a fact revision.

## In plain language
"Caseworkers can correct the facts, for example 'he also works at Fernway', but they can't type in a different benefit amount. The rules recalculate from the corrected facts, so every number can still be explained, and every correction is signed and dated."
