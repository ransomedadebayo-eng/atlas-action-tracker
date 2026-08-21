# Linear Project Views And Timeline Plan

## Architecture

1. Extend `atlas_saved_views` in place with typed entity/display/context fields,
   optimistic revision, favorite/default state, archive, and audit.
2. Add project manual rank and completion timestamp plus transactional reorder
   and timeline-move RPCs.
3. Enrich project lists with milestones, dependencies, violation state,
   completed windows, and allowlisted view filters/order.
4. Replace the project portfolio's card-only layout with reusable list, board,
   and timeline components.
5. Bind saved project views to portfolio controls and URL state.

## Integrity

- Existing action views remain readable after the migration.
- View deletion becomes an archive transition.
- Started dependency-chain projects do not move implicitly.
- Timeline moves and manual order updates use project revisions and append
  existing project audit rows.
- All browser writes continue through the Worker.

## Test Strategy

- Unit-test saved-view validation, grouping, dependency violation, ordering,
  and timeline geometry.
- HTTP-test typed view and owner-only mutation boundaries.
- Component-test all layouts, saved-view controls, drag/status semantics, and
  accessibility.
- Add pgTAP coverage for view backfill, archive/non-deletion, manual rank,
  completion timestamps, and dependency-chain timeframe shifts.
- Run the full repository and browser verification gates.

## Rollout

- Production migration rehearsal passed all 50 pgTAP assertions and rolled back cleanly.
- Migrations were applied forward-only with source-of-truth grants and row-count readback.
- Worker/UI version `7141ca4a-8997-40dd-84ea-5a82fcaa4cb0` is deployed; public route, asset, Access redirect, health, and unauthenticated API boundaries were verified.
- Authenticated owner interaction smoke remains a follow-up when an Access session is available.
