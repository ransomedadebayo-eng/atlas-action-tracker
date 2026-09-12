# Linear Project Foundation

## Purpose

ATLAS needs a first-class project layer before it can reproduce Linear's
roadmap, initiative, cycle, template, and release-management workflows. A
project represents a bounded outcome with dates, ownership, health, milestones,
dependencies, updates, and a measurable set of Atlas actions.

This is the first delivery slice of the broader Linear parity objective. It
does not redefine the broader objective as complete.

## Users

- Ransomed is the sole human owner and may create, edit, archive, restore, and
  review projects.
- Codex and Claude may read and update projects only when their machine tokens
  include the matching project scopes.
- No collaboration, invitations, or new human-principal model is introduced.

## User Stories

### US1 - See the project portfolio

As the owner, I can open a stable Projects route and see active projects with
their status, priority, health, lead, dates, action progress, and business lane
so that I can understand the portfolio without reconstructing it from tasks.

### US2 - Create and maintain an outcome

As the owner, I can create a project with a name and optional operating
properties, edit those properties with conflict protection, and archive or
restore it without deleting history.

### US3 - Organize project execution

As the owner, I can add milestones, attach existing Atlas actions to the
project and a milestone, set estimate points, and see count- and effort-based
progress rollups.

### US4 - Report health and blockers

As the owner or an authorized machine principal, I can post a structured
project update and add a blocking dependency between projects. The project
overview shows update history and active dependency direction.

## Functional Requirements

1. `/projects` and `/projects/:id` are stable owner-facing routes.
2. Projects support name, summary, description, business, status, health,
   priority, lead, members, start date, target date, color, icon, and update
   frequency.
3. Valid project statuses are `backlog`, `planned`, `in_progress`, `paused`,
   `completed`, `canceled`, and `archived`.
4. Valid health values are `on_track`, `at_risk`, `off_track`, and
   `no_update`.
5. Project updates are append-only records containing a health value, body,
   actor, and timestamp; the newest update becomes the project's current
   health signal.
6. Milestones have a name, description, optional target date, explicit order,
   and status. They are archived instead of deleted.
7. Dependencies model one project as blocked by another and can be resolved or
   archived without deleting evidence.
8. An Atlas action belongs to at most one project and at most one milestone in
   that project. Project assignment and removal append Atlas action activity.
9. Actions may have non-negative estimate points. Project progress treats an
   unestimated action as one point, matching the documented Linear default.
10. Project lists can filter by status, business, health, lead, and search, and
    sort only by allowlisted fields.
11. Project detail returns the project, actions, milestones, updates,
    dependencies, and progress in one coherent payload.
12. Mutations validate configured businesses and active ATLAS principals.
13. Project and milestone edits use optimistic revision checks and return a
    conflict rather than overwriting newer work.
14. Project, milestone, update, dependency, and activity records cannot be
    physically deleted by application roles.
15. Project reads and writes have distinct machine scopes. Project archive and
    restore are owner-only lifecycle actions.
16. The UI exposes clear loading, empty, error, saving, and conflict states and
    remains keyboard operable at mobile and desktop widths.

## Success Criteria

- A project can be created, opened, edited, populated with milestones and
  existing actions, updated, linked to a dependency, archived, and restored
  through typed API boundaries without direct browser database access.
- Progress is deterministic and covered by tests for count and estimate cases.
- Project lifecycle history is append-only and every action assignment change
  is visible in `atlas_activity_log`.
- Worker typecheck/tests and app tests/build pass.

## Assumptions

- `public.atlas_actions`, `public.atlas_members`, and `public.atlas_config`
  already exist in the canonical AEGIS Supabase project.
- The Worker continues to be the only browser-facing backend.
- Production migration and deployment remain separately approval-gated.

## Out of Scope For This Slice

- Initiatives and nested initiatives.
- Cycles and automatic rollover.
- Reusable issue/project templates.
- Saved project views, board drag ordering, and full timeline manipulation.
- Issue parent/child and issue relation graphs.
- Documents, comments/reactions, external integrations, releases, SLAs, and
  analytics dashboards.
