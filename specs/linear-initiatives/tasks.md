# Linear Initiatives Tasks

## Database

- [x] Create the initiative and supporting tables with lifecycle/audit controls.
- [x] Implement project membership, multi-parent graph, update, resource, order,
  archive, and restore RPCs.
- [x] Extend saved views for initiative entity/context and project grouping.
- [x] Add and pass the initiative pgTAP regression contract.

## Worker

- [x] Add initiative scopes and owner-only lifecycle/view mutation boundaries.
- [x] Implement list/detail/graph and mutation routes with validation.
- [x] Add recursive rollup and graph helper tests.
- [x] Enrich project payloads with initiative membership and filters.

## Application

- [x] Add initiative API client, hooks, route, and navigation.
- [x] Add list/timeline saved-view portfolio.
- [x] Add overview, health/update, project, hierarchy, and resource controls.
- [x] Add recursive rollup and weekly completion graph presentation.
- [x] Add component, route, responsive-markup, and accessibility tests.

## Release

- [x] Run the full repository verification and production dependency audits.
- [x] Rehearse, apply, test, and read back production migrations.
- [x] Deploy and verify the production Worker/UI and update the parity matrix.
- [ ] Run authenticated owner-session desktop/mobile interaction smoke when a Cloudflare Access browser session is available.
