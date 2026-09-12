# Linear Issue Structure Plan

## Technical Context

- React/Vite/TanStack Query frontend.
- Hono Cloudflare Worker API with scoped owner and machine identities.
- Forward-only PostgreSQL migrations in the canonical AEGIS Supabase project.
- Existing explicit completion/archive/restore RPCs and append-only activity.

## Architecture

1. Add hierarchy/resolution columns, relation tables, constraints, indexes,
   cycle validation, append-only guards, and transactional RPCs.
2. Extend action validation and persistence to understand estimates while
   keeping hierarchy mutations on dedicated endpoints.
3. Add a hydrated action-structure endpoint plus create child, set parent,
   relation, and duplicate endpoints.
4. Add estimate-settings endpoints using `atlas_config`; keep writes
   owner-only through the existing config authorization boundary.
5. Add query hooks and Action Detail sections for hierarchy, effort, relations,
   and duplicate state.
6. Add database, Worker, component, accessibility, and browser tests.

## Data Contracts

- `atlas_actions.parent_action_id`: direct parent.
- `atlas_actions.resolution`: ordinary completion or duplicate resolution.
- `atlas_actions.duplicate_of_id`: canonical action for duplicates.
- `atlas_action_relations`: revisionable active/resolved/archived typed edge.
- `atlas_config['estimate_settings']`: validated scale configuration.

## Integrity Decisions

- Parent assignment is an RPC with row locking and recursive cycle detection.
- Duplicate resolution is an RPC because status, evidence, relation, revision,
  and activity must commit together.
- Related pairs use canonical source/target order.
- Relation rows archive instead of delete and reject physical deletion.
- Blocking relation changes caused by completion run in the same database
  transaction as the action completion update.

## Test Strategy

- Unit-test estimate configuration, relation normalization, and hierarchy
  progress.
- HTTP-test scope routing and invalid request rejection before database access.
- Component-test parent, child, relation, duplicate, and estimate presentation.
- Add an isolated pgTAP regression file for schema, privileges, cycle rejection,
  inheritance, relation behavior, and duplicate resolution.
- Run the full repository check and desktop/mobile browser fixture validation.

## Rollout

- Produce staged migration and application code only.
- Do not mutate packages, apply migrations, or deploy without explicit approval.
