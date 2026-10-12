# ADR-0005: Append-only event log (SQLite) as CaseFlow's audit record

- **Status:** Accepted (revised 2026-10-11: VaCMS remains the state's system of record; this log is CaseFlow's own record of what it recommended and what the BPS decided)
- **Date:** 2026-10-11

## Context
Auditors and appeal hearings ask questions like "Why was this household denied on March 3rd, who approved it, and what evidence did they see?" A table that is overwritten on every update cannot answer that. The demo also needs storage that never fails on stage.

## Options considered
| Option | For | Against |
|---|---|---|
| **Append-only event log; current state rebuilt from events** | Complete history by construction; natural audit timeline; replayable | Slightly more code than plain updates |
| Regular tables + "last updated by" columns | Simple | History lost on each update; the audit trail is bolted on |
| PostgreSQL | Production-grade | Needs a running server; adds setup risk for a demo |

## Decision
- One `events` table, written by insert only: `id, case_id, type, actor, payload (JSON), created_at`.
  - The code never issues an UPDATE or DELETE on this table.
  - A database trigger rejects any UPDATE or DELETE.
- Case state (status, latest extraction, determination, review) is a **projection**: it is computed by replaying the case's events.
- Every event names its **actor**: `system`, `ai:intake`, `ai:notice`, or a Benefit Programs Specialist id.
- **Storage:** SQLite through `better-sqlite3`. It is one file with no server, and its writes are reliable and synchronous. Production would swap in PostgreSQL behind the same small store interface.

## Consequences
- The audit timeline is just the event list.
- A BPS override can never erase the original recommendation; both are kept.
- Rebuilding state on each read is fine at demo scale. At production scale, projections would be cached or written to read tables.

## In plain language
"Nothing in a case is ever erased or overwritten. Every action, by a person or by the AI, is added to a permanent timeline, so anyone can see exactly what happened and in what order."
