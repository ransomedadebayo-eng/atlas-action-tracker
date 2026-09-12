# Insights, Dashboards, And Exports Tasks

## Database

- [x] Add prospective action lifecycle timestamps and transition trigger.
- [x] Add insight/dashboard/card/snapshot/export/activity tables with RLS/audit guards.
- [x] Add snapshot/export receipt and lifecycle RPCs.
- [x] Add and pass the analytics pgTAP regression contract.

## Worker

- [x] Add insight/export scopes and owner-only export boundary.
- [x] Implement deterministic filters, measures, percentiles, slices, segments, and burn-up.
- [x] Implement saved Insight/dashboard/card APIs and immutable snapshots.
- [x] Implement action/project/initiative CSV exports with safe quoting and receipts.
- [x] Add helper, security, and HTTP boundary tests.

## Application

- [x] Add analytics/export API clients, hooks, routes, and navigation.
- [x] Add insight builder and bar/scatter/burn-up/metric/table views.
- [x] Add dashboard builder/cards/global and card filters.
- [x] Add drill-down, snapshots, and CSV controls.
- [x] Add component and accessibility tests.

## Release

- [x] Run full repository verification and production dependency audits.
- [x] Rehearse/apply/test/read back production migration and advisors.
- [x] Deploy, verify live assets/routes/security, and update parity.
- [ ] Run authenticated owner-session desktop/mobile interaction smoke when a Cloudflare Access browser session is available.
