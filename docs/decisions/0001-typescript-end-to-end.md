# ADR-0001: TypeScript end to end, with shared schemas

- **Status:** Accepted
- **Date:** 2026-10-11

## Context
CaseFlow has a React caseworker UI, an API server, AI steps that must return strictly shaped data, and a rules engine. The same data shapes cross all four boundaries: an extracted pay stub, a household, a determination. If each layer defines those shapes separately, they drift apart and bugs follow. The project also has a hard time budget of about 12 build hours.

## Options considered
| Option | For | Against |
|---|---|---|
| **TypeScript (Node) + React** | One language; one schema shared by UI, API and AI output | Node is less common than Python in data science teams |
| Python (FastAPI) + React | Popular in government AI teams; Pydantic is excellent | Two languages; schemas duplicated or code-generated across the boundary |

## Decision
TypeScript everywhere, organized as npm workspaces:
- `shared/`: Zod schemas and the types derived from them. This is the single source of truth.
- `server/`: Hono API, AI pipeline, rules engine, legacy adapter.
- `web/`: React (Vite) UI.

The same Zod schema validates the API request, constrains Claude's structured output, and types the React props.

**Server framework:** Hono rather than Express. It is TypeScript-first, has built-in request validation and streaming (server-sent events), and uses web-standard Request/Response objects, so the same code can later run in serverless environments.

## Consequences
- A change to a schema produces compile errors everywhere it matters, so drift becomes impossible.
- Contributors need only one language.
- If the agency's data science team works in Python, they would integrate through the HTTP API, not shared code.

## In plain language
"We wrote the whole system in one language, and defined what a 'pay stub' or a 'decision' looks like in exactly one place. If anyone changes it, every part of the system that depends on it is flagged immediately."
