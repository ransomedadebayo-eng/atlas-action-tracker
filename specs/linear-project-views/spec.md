# Linear Project Views And Timeline

## Purpose

ATLAS needs Linear-style durable project views that let the owner inspect the
same project portfolio as a list, board, or dependency-aware timeline without
creating competing project records or view systems.

This slice extends the existing canonical `atlas_saved_views` contract and the
first-class project foundation.

## User Stories

### US1 - Change portfolio perspective

As the owner, I can switch among list, board, and timeline layouts, group and
order projects, choose visible properties, set timeline zoom, and control how
recently completed projects appear.

### US2 - Save and return to a view

As the owner, I can save the active project filters and display options as a
named durable view, favorite it, update it, archive it, and reopen it from a
stable URL-compatible identifier.

### US3 - Plan from the board and timeline

As the owner, I can drag a project between status columns, micro-adjust manual
order, move project timeframes, optionally shift a planned dependency chain,
and identify violated dependencies.

### US4 - Attach project-context issue views

As the owner, I can use the same typed saved-view contract for issue views
attached to a project, without duplicating the underlying actions.

## Functional Requirements

1. `atlas_saved_views` supports entity type `action` or `project`, optional
   project context, filters, layout, grouping, subgrouping, ordering, zoom,
   visible properties, favorite/default state, revision, archive, and audit.
2. Existing saved views backfill as action/list views without data loss.
3. Saved views archive and restore; application roles cannot hard-delete them.
4. Project views support list, board, and timeline layouts.
5. Projects group by lead, member, status, health, business, start date, or
   target date; no grouping is also supported.
6. Projects order by manual rank, status, priority plus micro-order, updated
   time, created time, start date, or target date, with allowed direction.
7. Manual rank is globally durable on `atlas_projects.sort_order` and uses
   optimistic revision checks.
8. Board moves between status groups update project status transactionally.
9. Timeline zoom supports week, month, quarter, and year.
10. Timeline displays project bars, milestones, lead/status/health properties,
    and end-to-start dependency lines.
11. Dependency lines are marked violated when a blocker ends after its blocked
    project begins.
12. Timeline timeframe moves may shift the dependency chain for backlog/planned
    projects. Started projects remain fixed unless directly selected.
13. Completed-project windows support none, last week, last month, last year,
    and all.
14. Filters support status, health, lead, business, date range, milestones,
    any/blocking/blocked-by/violated dependency, and search.
15. Project list payloads include active milestones and hydrated dependency
    summaries needed by all layouts.
16. Saved view mutations and project order/timeframe mutations append audit
    evidence.
17. Stable project-view state is reflected in URL query parameters; saved view
    IDs can be reopened directly.
18. UI remains accessible and responsive at representative mobile and desktop
    widths.

## Success Criteria

- One filtered portfolio renders coherently in all three layouts.
- Saving and reopening a view restores filters and display configuration.
- Board status moves, manual ordering, and timeline moves persist through the
  Worker with revision protection.
- Dependency violations are deterministic and visible.
- Full code, database-contract, accessibility, and browser gates pass.

## Out Of Scope For This Slice

- Initiative grouping until initiatives exist.
- Multi-user sharing permissions and notifications.
- Touch drag gestures; accessible move controls remain available everywhere.
