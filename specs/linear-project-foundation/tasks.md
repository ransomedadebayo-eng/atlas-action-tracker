# Linear Project Foundation Tasks

## US1 - Portfolio

- [x] Add project schema and project progress contract in
  `migrations/20260821015418_atlas_projects_linear_parity.sql`.
- [x] Add list/detail project endpoints in `worker/src/routes/projects.ts`.
- [x] Add project client and hooks in `app/src/api/client.js` and
  `app/src/hooks/useProjects.js`.
- [x] Add `/projects` and `/projects/:id` UI routing and navigation.

## US2 - Project lifecycle

- [x] Add create/update/archive/restore API operations with validation,
  optimistic revision checks, and audit evidence.
- [x] Add create/edit/lifecycle controls to `app/src/components/ProjectsPage.jsx`.

## US3 - Execution organization

- [x] Add milestone create/update/archive operations.
- [x] Add project action assignment/removal and estimate support.
- [x] Render progress, milestones, and project actions in the detail view.

## US4 - Health and blockers

- [x] Add append-only project update operations.
- [x] Add dependency create/resolve operations.
- [x] Render health history and dependency direction in the detail view.

## Verification

- [x] Add Worker validation, progress, scope, and lifecycle tests.
- [x] Add component and accessibility tests for Projects.
- [x] Run focused tests, typecheck, build, then `npm run check`.
- [x] Update the Linear parity inventory with verified status and remaining
  slices.

## Verification Evidence

- `npm run check`: contract, app build, Worker typecheck, 18 app tests, and 38
  Worker tests passed on 2026-08-20.
- Browser fixture verification passed at 1440x1000 and 390x844 for portfolio,
  project detail, edit controls, action assignment, milestones, health updates,
  and dependencies with no horizontal overflow or browser errors.
- `supabase/tests/atlas_projects_test.sql` defines 25 database assertions. It
  remains staged because this work did not apply migrations to production or
  start a separate local PostgreSQL runtime.
- `npm run audit` found pre-existing package-tree advisories. Production-only
  audit is clean for the app and reports one moderate Hono advisory for the
  Worker; the full development trees report high/critical transitive findings.
  Resolving them requires an approval-gated package and lockfile update.

## Remaining Operational Gates

- [ ] With owner approval, update the affected app and Worker dependencies,
  rerun the full audit, and verify the lockfile diff.
- [ ] Apply the project migration to staging, run both pgTAP files, and read
  back grants, triggers, functions, and fixture behavior.
- [ ] Deploy the Worker and app only after staging verification and a separate
  production approval.
