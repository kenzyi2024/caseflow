# ADR-0004: U.S. Web Design System (USWDS) for the UI

- **Status:** Accepted (revised 2026-10-11: Virginia operating context)
- **Date:** 2026-10-11

## Context
Public sector systems must meet Section 508 accessibility requirements (WCAG 2.1 AA in practice). Benefit Programs Specialists use the tool all day, and many agencies standardize on USWDS so their tools look and behave consistently.

## Options considered
| Option | For | Against |
|---|---|---|
| **USWDS** (`@uswds/uswds` + `@trussworks/react-uswds`) | Built and tested for accessibility; familiar to government users; signals government readiness | Less visual freedom; heavier CSS |
| Tailwind + shadcn/ui | Modern look, flexible | Accessibility is entirely on us; reads as a startup product, not an agency tool |

## Decision
Use USWDS components and design tokens through the React USWDS component library. Custom styling stays minimal and uses USWDS tokens.

**Real organizations, context only.** CaseFlow is modeled on how Arlington County DHS and VDSS process SNAP. It names those organizations only to describe that operating context.
- A persistent notice reads "Independent demo — not affiliated with Arlington County, VDSS, or VEC."
- No agency logos, seals or color branding.
- No "An official website of the United States government" banner.
- No `.gov`-style domain.

## Consequences
- We get accessible forms, tables, alerts and focus handling without building them ourselves.
- An automated accessibility check (axe) can be added to CI as a stretch goal.

## In plain language
"We built the screens with the same design system federal websites use, so it's accessible to people using screen readers or keyboards from day one, and it feels familiar to government staff."
