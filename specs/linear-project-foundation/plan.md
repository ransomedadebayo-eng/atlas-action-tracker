# Linear Project Foundation Plan

## Technical Context

- Frontend: React 18, Vite, TanStack Query, Tailwind utilities.
- API: Hono Worker with scoped bearer principals and Cloudflare Access owner
  auth.
- Data: forward-only PostgreSQL migrations in the canonical AEGIS Supabase
  project.
- Tests: Vitest, Testing Library, axe-core, and SQL contract tests.

## Architecture

1. Add forward-only project tables, append-only activity/update records,
   project fields on `atlas_actions`, validation constraints, indexes, and
   restrictive grants.
2. Add `/api/projects` routes that hydrate one project aggregate and calculate
   deterministic progress in the Worker.
3. Add `projects:read` and `projects:write` authorization scopes. Keep archive
   and restore owner-only.
4. Add a TanStack Query project client/hook layer.
5. Add a Projects portfolio/detail page with creation, property editing,
   milestones, action assignment, updates, dependencies, and lifecycle
   controls.
6. Add stable app routing and navigation without disturbing the in-progress
   Week route.

## Data Contracts

- `atlas_projects`: mutable project aggregate root with revision.
- `atlas_project_milestones`: mutable, revisioned children; archive instead of
  delete.
- `atlas_project_updates`: append-only structured health reports.
- `atlas_project_dependencies`: status-transitioned directed edges.
- `atlas_project_activity_log`: append-only project audit history.
- `atlas_actions.project_id`, `project_milestone_id`, `estimate_points`: issue
  membership and effort.

## Security And Integrity

- Browser code only calls the Worker.
- All string, enum, date, principal, business, project, and milestone references
  are validated before mutation.
- Update conditions include the current revision.
- Physical delete and truncate privileges are revoked, with rejection triggers
  on project history surfaces.
- Project dependencies cannot be self-referential.
- Milestone assignment is verified to belong to the selected project.

## Test Strategy

- Unit-test validation and progress calculations.
- HTTP-test project scope routing and owner-only archive behavior before any
  database call.
- Component-test portfolio/detail rendering, empty/error states, key mutation
  controls, and axe semantics.
- Run Worker typecheck/tests and app tests/build; run the full repository check
  when focused gates pass.

## Rollout

- This turn produces migration and application code only.
- Do not apply the migration or deploy without a separate explicit production
  instruction and authoritative readback.
