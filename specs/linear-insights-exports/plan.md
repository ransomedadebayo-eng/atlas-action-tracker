# Insights, Dashboards, And Exports Technical Plan

## Architecture

1. Add prospective action lifecycle timestamps plus a status-transition trigger.
2. Add insight, dashboard, dashboard-card, snapshot, export-receipt, and analytics
   activity tables with RLS, revisions, and non-delete guards.
3. Keep metric computation in a deterministic Worker analytics module over
   canonical action rows and hydrated project/initiative/release dimensions.
4. Add RPCs only for immutable snapshot/export receipt creation and lifecycle
   transitions; saved-definition CRUD remains optimistic Worker writes.
5. Build lazy Insights UI with builder, chart/table/metric/burn-up renderers,
   dashboard cards, drill-down, snapshots, and CSV download controls.

## Data Contracts

- `atlas_insights`: saved analytical definition.
- `atlas_dashboards`: reusable filtered collection.
- `atlas_dashboard_insights`: layout and card-specific filter binding.
- `atlas_insight_snapshots`: immutable evaluated result.
- `atlas_export_receipts`: immutable export hash/row-count evidence.
- `atlas_analytics_activity_log`: append-only configuration/activity evidence.

## Analytics Engine

- Normalize action multi-value dimensions into deterministic labels.
- Apply allowlisted filters before measurement.
- Produce bar cells, scatter points/percentiles, burn-up time series, metric
  summary, and a bounded drill-down table from the same filtered dataset.
- Merge filters in precedence order: insight, dashboard, card, transient run.
- Compute source watermark from maximum action `updated_at` plus relationship
  hydration timestamps.

## Security And Export Safety

- Snapshot/result JSON is server-generated and immutable.
- CSV values beginning with `=`, `+`, `-`, or `@` are prefixed with an apostrophe.
- Export endpoints are owner-only and capped; only receipt metadata persists.
- No public table or function grants; service role cannot delete or rewrite
  snapshots, receipts, or activity history.

## Test Strategy

- pgTAP: schema/RLS/grants, lifecycle timestamps, optimistic lifecycle,
  immutable snapshots/receipts, dashboard bindings, archive/restore, and
  non-deletion.
- Worker: filters, measures, percentiles, multi-value slices, burn-up buckets,
  dashboard filter composition, drill-down IDs, CSV quoting/formula safety,
  hashes, scope boundaries.
- UI: insight builder, all presentation modes, dashboards, drill-down, export,
  empty states, and axe checks.
- Full repository gate, transactional production rehearsal, committed pgTAP,
  advisors/readback, Cloudflare deploy, and live route/asset/API verification.

## Rollout

- The 63-assertion migration rehearsal rolled back cleanly, then passed against
  the committed production schema.
- Production preserved 566 actions and created zero Insights, dashboards,
  cards, snapshots, exports, or analytics activity.
- All 566 historical actions retained null prospective lifecycle timestamps;
  no start, triage, or cancellation history was invented.
- One dashboard-card foreign key advisor finding was fixed forward with a
  covering index.
- Worker/UI version `b0523d49-f125-4eb7-bd69-a8f0ec5e4f08` serves Insights,
  dashboards, drill-down, snapshot, and owner-gated export routes.
