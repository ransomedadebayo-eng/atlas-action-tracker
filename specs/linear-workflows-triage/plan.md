# Implementation Plan

## Schema

- Add business/workspace workflows, ordered statuses, Triage settings and
  entries, workflow rules, immutable rule runs, inactivity runs, and activity
  logs.
- Add `workflow_status_id` to `atlas_actions`, seed workflows from configured
  businesses plus observed action lanes, and backfill status references.
- Add trigger-level compatibility validation and transactional Triage/rule
  effect RPCs with revision and idempotency checks.
- Enable RLS, revoke public roles, deny deletes, and grant service-role access
  only to the operations the Worker needs.

## Worker

- Add rule validation, condition evaluation, deterministic effect merging, and
  conflict reporting utilities.
- Add `/api/workflows` configuration/status/rule endpoints, `/api/triage`
  queue/decision endpoints, and inactivity preview/apply endpoints.
- Execute active rules after eligible action creates/updates and when an action
  enters Triage; persist one idempotent receipt per event.
- Hydrate action responses with workflow status presentation data.

## Frontend

- Add a lazy `/workflows` route and navigation entry.
- Build business-scoped status configuration, Triage queue actions, rule
  builder/preview, run history, and inactivity policy controls.
- Use configured workflow statuses in Action Detail and custom status labels in
  existing action badges.

## Verification and release

- Add pgTAP, Worker, component, authorization, and architecture-contract tests.
- Run contract, build, typecheck, all tests, audit, and diff checks.
- Rehearse and apply the migration in production, run pgTAP and advisors, deploy
  through Wrangler, then verify live routes/assets and production row counts.

## Production evidence

- Supabase migrations `atlas_workflows_triage_linear_parity` and
  `atlas_workflow_foreign_key_indexes` applied successfully.
- Production pgTAP passed 101/101; all 566 actions have a workflow status, 25
  workflows and 225 statuses were seeded, and no test rows or active rules were
  left behind.
- Advisor follow-up reports no workflow foreign-key finding. The remaining
  RLS-with-no-policy notices are the intentional Worker-only fail-closed model.
- Cloudflare version `7823b011-9310-4293-9be1-9583fbc5bfb6` serves the
  `/workflows` route and `WorkflowsPage-DdyaALc7.js`; unauthenticated workflow
  and Triage APIs return 401.
