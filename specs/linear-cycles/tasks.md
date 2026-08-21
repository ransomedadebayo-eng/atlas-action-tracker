# Linear Cycle Planning Tasks

## US1 - Cadence

- [x] Add cycle schema, non-deletion, snapshots, and scope-event contracts.
- [x] Add transactional schedule configuration and cycle generation.
- [x] Add owner-only configuration UI.

## US2 - Scope and capacity

- [x] Add action cycle assignment/removal RPCs and API.
- [x] Add previous-three-cycle capacity and estimate-aware metrics.
- [x] Add Action Detail cycle assignment and action-list cycle filters.

## US3 - Delivery tracking

- [x] Add live cycle metrics, success weighting, scope events, and graph data.
- [x] Add cycle portfolio/detail UI and previous/next navigation.

## US4 - Completion and rollover

- [x] Add transactional cycle completion and immutable snapshot.
- [x] Roll only eligible unfinished actions and activate the next cycle.
- [x] Add owner completion/rollover controls.

## Verification

- [x] Add pgTAP, Worker, component, accessibility, and browser tests.
- [x] Run `npm run check` and update the parity inventory.

## Verification Evidence

- `npm run check` passed with 25 app tests and 54 Worker tests on 2026-08-20.
- Browser fixtures passed at 1440x1000 light mode and 390x844 dark mode for
  schedule settings, disabling, current/upcoming cards, capacity, scope graph,
  action planning, navigation, and completion/rollover with no browser errors
  or horizontal overflow.
- `supabase/tests/atlas_cycles_test.sql` defines 50 staged database assertions
  for generation, assignment, graph events, snapshots, rollover, auto-add,
  business isolation, disable behavior, privileges, and non-deletion.

## Remaining Operational Gates

- [ ] Apply migrations through `2026082003` to staging and run all pgTAP files.
- [ ] Resolve the separately documented dependency advisories after exact
  package-update approval.
- [ ] Deploy and configure live cycles only after staging readback and
  production approval.
