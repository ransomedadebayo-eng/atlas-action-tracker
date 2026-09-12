# Releases Technical Plan

## Architecture

1. Add pipeline, stage-definition, release, stage-run, release-action, CI-event,
   and release-activity tables with RLS, non-delete guards, and covering indexes.
2. Store pipeline access-key hash/fingerprint on the pipeline. Extend Worker auth
   with a narrowly-scoped `x-atlas-release-key` path for `/api/releases/ingest/:id`.
3. Implement RPCs for release creation, stage transition/freeze, action
   association, release transition/completion automation, deterministic notes,
   access-key rotation, and idempotent CI ingestion.
4. Enrich action queries from the many-to-many release association graph.
5. Build lazy-loaded Releases UI with pipeline cards, detail, stages, releases,
   issue membership, notes, changelog, and guarded access-key configuration.

## Data Contracts

- `atlas_release_pipelines`: delivery process and credential hash.
- `atlas_release_stages`: ordered environment/stage definitions.
- `atlas_releases`: version/commit release unit.
- `atlas_release_stage_runs`: per-release stage lifecycle and freeze evidence.
- `atlas_release_actions`: action delivery attribution.
- `atlas_release_events`: immutable idempotent CI input/result ledger.
- `atlas_release_activity_log`: append-only human/system lifecycle evidence.

## Security And Integrity

- Raw pipeline access keys are accepted only transiently and hashed in the
  Worker; only digest/fingerprint cross into Postgres.
- Specialized release-key auth yields one ingest scope and pipeline binding.
- CI event pipeline ID must equal the authenticated pipeline binding.
- Event keys are unique per pipeline and processing is transactional.
- Completion automations reuse canonical action completion, preserving evidence
  and revision invariants.
- Release/stage/action/event/history rows cannot be physically deleted.

## Test Strategy

- pgTAP: schema/RLS/grants, stage derivation/order/freeze, manual associations,
  CI idempotency, unknown/frozen IDs, completion automation/evidence, notes,
  changelog data, lifecycle, and non-deletion.
- Worker: pipeline/release validation, path filters, release-key hashing and
  constant-time matching, scoped auth, event validation, aggregation, and filters.
- UI: list/detail/stage/release/notes/changelog/CI controls and axe checks.
- Full repository gate, transactional production rehearsal, committed pgTAP,
  advisors/readback, authenticated Wrangler deployment, and live asset/API checks.

## Rollout

- The 91-assertion release migration rehearsal rolled back cleanly, then passed
  against the committed production schema.
- Production preserved 566 actions and contains zero pipelines, stages,
  releases, keys, associations, events, or release activity.
- Supabase advisors found no missing release indexes or privilege exposure.
- Worker/UI version `b797a783-c61c-437b-aa05-a561af3a14e7` serves release
  routes, action delivery summaries, and the lazy Releases bundle.
- Real key/CI configuration and authenticated owner interaction smoke remain
  explicitly pending; no credential or external workflow was mutated.
