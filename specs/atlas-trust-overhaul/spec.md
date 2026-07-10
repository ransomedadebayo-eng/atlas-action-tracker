# ATLAS Trust Overhaul Specification

## Purpose

ATLAS is the owner-only execution surface for AEGIS. It must show current work truthfully, preserve audit evidence, and separate owner actions from Codex and Claude work without exposing collaborative or multi-user behavior.

## Principals

- `ransomed`: sole human owner and decision authority.
- `codex`: scoped agent principal.
- `claude`: scoped agent principal.
- Every other member is inactive historical provenance only.
- Active actions may reference only the three active principals. Closed actions retain historical owner evidence.

## Functional Requirements

1. Privileged Atlas database functions are not executable by anonymous or general authenticated roles.
2. Atlas actions and activity history cannot be physically deleted through the application or ordinary database roles.
3. Archiving and restoring actions are explicit, audited status transitions.
4. Completion distinguishes `manual_attestation` from `verified_execution`; the application never invents completion evidence.
5. Cloudflare Access admits only the owner email. Codex and Claude use separate scoped machine credentials.
6. The production Cloudflare Worker is the only application backend.
7. Guarded Codex automations are the only automation runtime. The Worker exposes read-only automation status and cannot run jobs.
8. The active roster, assignment controls, filters, and workload surfaces contain only Ransomed, Codex, and Claude.
9. Business aliases normalize to one `real_estate`, one `riddim_exchange`, and one `wealth-os` lane.
10. API lists are complete or explicitly paginated and distinguish loading, empty, partial, stale, unauthorized, and failed states.
11. Today, Review, Decide, All Tasks, Journal, Calendar, Transcripts, Automations, Settings, and action details have stable URLs.
12. Core workflows are keyboard operable, WCAG AA, reduced-motion safe, and usable on desktop and mobile.
13. Database schema, policies, functions, and forward migrations are reproducible from the repository.
14. CI blocks deployment when types, tests, migrations, security checks, accessibility, or builds fail.

## Data Preservation

- Never reopen grandfathered closed actions solely because historical evidence is empty.
- Report empty historical evidence as `legacy_unverified`.
- Preserve removed people only as read-only provenance on closed records.
- All data repairs append auditable evidence; no destructive rollback SQL is permitted.

## Success Criteria

- Exactly three active principals.
- Zero active actions reference another person.
- Zero public execution grants on privileged Atlas functions.
- Zero action/activity hard-delete paths.
- Zero Worker automation mutations or manual-run endpoints.
- Zero duplicate active assignments and active reference violations.
- Frontend build, Worker typecheck, database tests, API tests, UI tests, accessibility checks, and security checks pass.

## Out of Scope

- Collaboration, invitations, sharing, or external tenancy.
- A separate native iOS feature implementation; Capacitor remains a thin wrapper.
- Reopening or fabricating evidence for legacy closed actions.
- Production migration or deployment before staged verification and owner approval.
