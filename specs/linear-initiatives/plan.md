# Linear Initiatives Technical Plan

## Architecture

1. Add initiative, project-membership, hierarchy-edge, update, resource, and
   activity tables with RLS, non-delete guards, append-only history, and indexes.
2. Add security-definer RPCs for project membership, parent links, structured
   updates, archive/restore, and manual order. Revoke public execution and grant
   only the service role.
3. Enforce graph integrity inside the parent-link RPC using recursive CTEs: no
   self-link, no reverse reachability cycle, and maximum root-to-leaf depth five.
4. Extend typed saved views with initiative entity/context support and matching
   database constraints.
5. Build a scoped Hono route returning list/detail aggregates and bounded graph
   series from canonical initiatives, projects, and actions.
6. Add React Query hooks, stable routes, sidebar navigation, initiative
   list/timeline views, overview editing, membership/hierarchy/resource/update
   controls, health rollups, and a lightweight SVG completion graph.
7. Enrich project payloads with initiative membership and project filters/grouping.

## Data Contracts

- `atlas_initiatives`: mutable strategic objective with revision and lifecycle
  timestamps.
- `atlas_initiative_projects`: active/archived initiative-project membership.
- `atlas_initiative_relations`: active/archived parent-child edge.
- `atlas_initiative_updates`: append-only structured health report and snapshot.
- `atlas_initiative_resources`: revisioned, archivable titled resource.
- `atlas_initiative_activity_log`: append-only audit ledger.
- `atlas_saved_views`: adds initiative entity/context without a competing view
  table.

## Security And Integrity

- New tables are not granted to `anon` or `authenticated`; RLS is defense in
  depth and the Worker is the only application backend.
- RPCs use an empty search path, validate canonical actors, enforce revisions,
  and receive explicit service-role grants after public revocation.
- Physical deletion is rejected for initiatives, graph edges, memberships,
  resources, and history.
- Multi-parent recursive queries use `UNION` plus path arrays to deduplicate and
  detect cycles deterministically.

## Test Strategy

- pgTAP: schema, RLS/grants, lifecycle, memberships, deduplicated recursive
  rollups, multi-parent graph, cycle/depth rejection, updates, resources,
  non-deletion, and saved-view extension.
- Worker: validation, hierarchy helpers, rollup aggregation, graph bucketing,
  scope and owner-only boundaries.
- UI: list/timeline/detail rendering, graph, hierarchy and project membership
  controls, saved views, route behavior, and axe checks.
- Full repository contract/build/typecheck/test/audit gates.
- Transactional production rehearsal followed by forward migration, pgTAP,
  advisors, row/grant readback, Cloudflare deploy, live route/asset/API checks.

## Rollout

- The original production initiative pgTAP passed 70 assertions. This release
  candidate expands the contract to 72 with initiative-resource safety
  assertions; run all 72 after applying the forward safety migration.
- Production readback preserved 566 actions, five saved views, and zero test rows;
  all initiative tables enforce RLS and public RPC execution remains revoked.
- Worker/UI version `202338e7-082f-4e69-9ccd-260b725180ce` serves the initiative
  routes and lazy-loaded initiative bundle behind Cloudflare Access.
- Authenticated owner interaction smoke remains pending a usable Access browser
  session; route, assets, health, API denial, and Access redirect are verified.
