# Linear Issue Structure Tasks

## US1 - Parent and sub-actions

- [x] Add hierarchy/resolution schema and cycle validation in
  `migrations/20260821015419_atlas_action_structure_linear_parity.sql`.
- [x] Add transactional parent assignment and inherited sub-action endpoints.
- [x] Add hierarchy filters and hydrated structure reads.
- [x] Render parent, children, and child progress in Action Detail.

## US2 - Typed relations

- [x] Add append-only typed relation storage and uniqueness rules.
- [x] Add create, resolve, and archive relation endpoints.
- [x] Convert completed blocker edges to related/resolved deterministically.
- [x] Render and manage relation direction in Action Detail.

## US3 - Duplicate resolution

- [x] Add transactional duplicate-resolution RPC and API endpoint.
- [x] Distinguish duplicate resolution in action status/evidence presentation.
- [x] Add canonical-action banner and navigation in Action Detail.

## US4 - Estimates

- [x] Extend action create/update/bulk/filter contracts for `estimate_points`.
- [x] Add validated estimate configuration endpoints and UI-consumable scale.
- [x] Render estimate control and count/effort child rollups.

## Verification

- [x] Add pgTAP schema and transactional behavior regression tests.
- [x] Add Worker validation, scope, and progress tests.
- [x] Add component and accessibility tests.
- [x] Run `npm run check`, browser verification, and update the parity matrix.

## Verification Evidence

- `npm run check` passed with 21 app tests and 47 Worker tests on 2026-08-20.
- Browser fixtures passed at 1440x1000 light mode and 390x844 dark mode for
  estimate editing, hierarchy progress, sub-action creation, parent display,
  typed relations, and duplicate resolution with no browser errors or
  horizontal overflow.
- `supabase/tests/atlas_action_structure_test.sql` defines 39 database
  assertions. It remains staged because this work did not apply migrations to
  staging or production.

## Remaining Operational Gates

- [ ] Apply migrations through `2026082002` to staging and run all pgTAP files.
- [ ] Resolve the separately documented dependency advisories after exact
  package-update approval.
- [ ] Deploy the Worker and app only after staging readback and production
  approval.
