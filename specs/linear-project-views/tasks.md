# Linear Project Views And Timeline Tasks

## Saved views

- [x] Extend and secure the canonical saved-view schema.
- [x] Add typed view list/create/update/archive/restore API and hooks.
- [x] Bind saved project views to portfolio controls and URL state.

## Portfolio layouts

- [x] Add list layout with grouping, properties, manual ordering, and completed windows.
- [x] Add board layout with group totals and status moves.
- [x] Add timeline layout with zoom, milestones, dependencies, and violation state.

## Planning mutations

- [x] Add project completion timestamp and global micro-order.
- [x] Add transactional reorder and timeline/dependency-chain movement RPCs.
- [x] Add accessible board/timeline mutation controls.

## Verification

- [x] Add pgTAP, Worker, component, and accessibility tests plus production route/asset smoke checks.
- [x] Run `npm run check` and update the parity inventory.
- [ ] Run an authenticated owner-session interaction smoke after Cloudflare Access login is available.
