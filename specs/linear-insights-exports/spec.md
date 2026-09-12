# Linear Insights, Dashboards, And Exports

## Purpose

ATLAS needs real-time analytics and reusable dashboards that answer how work is
distributed, how long it takes, and where delivery is blocked. Results must be
drillable to canonical actions and exportable without inventing missing
lifecycle history.

## User Stories

### US1 - Analyze execution

As the owner, I can measure issue count, effort, cycle time, lead time, triage
time, or issue age over a filtered action dataset.

### US2 - Compare dimensions

As the owner, I can slice and optionally segment analytics by status, status
type, owner, business, priority, tag, estimate, template, project, initiative,
cycle, release, pipeline, and lifecycle dates.

### US3 - Explore charts and records

As the owner, I can switch between bar, scatter, burn-up, metric, and table
presentations, inspect percentiles, select a cell/point, and open the underlying
actions.

### US4 - Assemble dashboards

As the owner, I can save Insights, add one Insight to multiple dashboards,
choose chart/table/metric presentation and layout, and combine dashboard-level
filters with insight-level filters.

### US5 - Export auditable data

As the owner, I can export an Insight’s underlying actions or current action,
project, and initiative views as CSV. Each export records filters, row count,
content hash, actor, and timestamp without persisting the CSV body.

## Functional Requirements

1. Insight definitions support name/description, measure, slice, optional
   segment, chart type, filters, time grouping, archived/no-priority options,
   optional saved-view context, revision, archive/restore, and audit.
2. Measures include issue count, effort, cycle time, lead time, triage time, and
   issue age. Duration measures expose count, average, and P25/P50/P75/P95.
3. Effort uses configured estimates and the current unestimated fallback.
4. Cycle time uses first known `started_at` to completion. Lead time uses created
   to completion. Triage time uses `triaged_at` to first start. Unknown intervals
   are excluded and their missing count is reported.
5. Action lifecycle timestamps (`started_at`, `triaged_at`, `canceled_at`) are
   maintained prospectively by a database trigger. Existing unknown history is
   left null.
6. Slice/segment dimensions include status, status type, owner, business,
   priority, tag, estimate, template, project, initiative, cycle, release,
   pipeline, and created/completed/started/due date buckets.
7. Filters support status, business, priority, owner, tag, project, initiative,
   cycle, template, release, pipeline, created/completed date bounds, and
   archived/no-priority behavior.
8. Bar datasets aggregate measure values by slice/segment. Scatter datasets
   preserve action ID/title and duration. Burn-up datasets show cumulative
   created and completed issues by daily/weekly/monthly/quarterly/yearly bucket.
9. Result payloads include source watermark, as-of timestamp, definition
   revision, applied filters, summary, chart data, table data, and drill-down
   action IDs.
10. Insight snapshots are immutable and store result payload, definition
    revision, source watermark, actor, and timestamp.
11. Dashboards support workspace/business/personal scope, owner, global filters,
    revision, archive/restore, and audit.
12. Dashboard cards bind an insight with chart/table/metric display, position,
    width/height, per-card filters, active/archive state, and revision.
13. Dashboard evaluation combines global and card filters with the insight’s own
    filters without modifying the saved insight.
14. CSV exports quote fields safely, neutralize spreadsheet formulas, use
    stable headers, enforce bounded row limits, and append an immutable receipt.
15. Action export includes Linear-equivalent identifiers, hierarchy, estimates,
    project/milestone, initiative, cycle, template, release/pipeline, lifecycle
    timestamps, owners, tags, and status.
16. Project and initiative exports include their documented core properties,
    membership/rollups, health/latest update, and lifecycle timestamps.
17. `/insights`, `/insights/:id`, and `/dashboards/:id` provide accessible saved
    definitions, builder, visualizations, tables, drill-down, snapshots,
    dashboards, and export controls.
18. Browser code calls only the Worker. New public tables enforce RLS, public
    mutation RPCs are revoked, and service-role destructive grants are absent.

## Success Criteria

- Measures and percentiles reconcile to fixture actions exactly.
- Missing start/triage timestamps are reported, never guessed.
- Dashboard global and card filters narrow results predictably.
- Selecting chart data exposes exactly the corresponding action IDs.
- CSV output is parseable, formula-safe, and its SHA-256 matches the receipt.
- Snapshots remain unchanged after source actions change.
- Database, Worker, UI, accessibility, production, permission, and readback
  gates pass without report or fixture residue.

## Edge Cases

- Empty datasets and all-null duration measures.
- Multiple owners/tags/initiatives/releases on one action.
- Zero estimates versus unestimated work.
- Archived actions included explicitly.
- Same Insight on two dashboards with different filters/presentations.
- CSV values containing commas, quotes, newlines, or spreadsheet formulas.

## Out Of Scope

- External Google Sheets, Airbyte, or Fivetran delivery until integrations are
  configured with explicit owner authorization.
- Invented historical lifecycle timestamps.
- Multi-user dashboard privacy beyond Atlas's owner-only identity contract.
