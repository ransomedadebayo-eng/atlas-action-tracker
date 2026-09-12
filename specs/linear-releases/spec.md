# Linear Releases And Delivery Pipelines

## Purpose

ATLAS needs to distinguish completed work from delivered work. Release
pipelines connect actions to commits, environments, staged deployments, release
notes, and customer availability without treating a merged or done action as
automatically shipped.

## User Stories

### US1 - Model delivery pipelines

As the owner, I can configure continuous or scheduled release pipelines with
business ownership, path filters, stage/environment definitions, note template,
and optional completion automation.

### US2 - Plan and move releases

As the owner, I can create releases with name, version, commit SHA, scheduled
date, status, notes, and stage runs, then start/complete/cancel stages and the
release with revision checks.

### US3 - Attribute delivered work

As the owner or authorized CI, I can associate actions to a release/stage,
filter actions by pipeline/release/stage, and see delivery state in Action Detail.

### US4 - Ingest CI evidence safely

As CI, I can send idempotent release/stage/deployment events using a pipeline-
specific access key. Replays return the original result; unknown issues and
frozen-stage additions are reported rather than silently attributed.

### US5 - Communicate what shipped

As the owner, I can write or deterministically generate release notes from
associated actions and review a chronological pipeline changelog.

## Functional Requirements

1. Pipelines support `continuous` and `scheduled` types, name/description,
   business ownership, path-filter globs, active/archive state, note template,
   auto-note flag, completion automation, revision, and audit.
2. Pipeline stages have stable key/name, environment, position, freeze-on-start,
   active/archive state, and revision. Continuous pipelines may use a single
   production stage; scheduled pipelines may use several ordered stages.
3. Releases support external ID, name, version, commit SHA, planned/in-progress/
   completed/canceled/failed status, scheduled/released timestamps, notes,
   notes source, revision, and archive/restore.
4. Every release has stage runs derived from active stage definitions. Stage
   runs record pending/started/completed/canceled/failed state, commit SHA,
   external URL, frozen time, and lifecycle timestamps.
5. Release-action associations support manual or CI source, optional stage run,
   active/removed status, actor, and timestamps. Hard deletion is disabled.
6. Once a stage run freezes, CI may not add previously-unassociated actions to
   that stage. Existing associations remain stable.
7. CI events require a unique pipeline event key and store immutable raw payload,
   event type, external release identity, commit, actor, occurrence time, and
   processing result.
8. CI ingestion creates or updates the release, stage runs, and action
   associations transactionally. Replayed event keys are idempotent and return
   the stored processing result without another mutation.
9. Pipeline access keys are stored only as SHA-256 hashes and a short fingerprint.
   Key configuration/rotation is owner-only, never returns the stored hash, and
   is not invoked during this feature rollout.
10. Pipeline access authentication grants only `releases:ingest` for the named
    pipeline. A key cannot read or mutate other Atlas APIs.
11. Completion automation is owner-configured per pipeline. When enabled,
    release completion calls the canonical action completion RPC with structured
    release-delivery evidence; already-terminal actions are left unchanged.
12. Manual release/stage/association mutations use revision or immutable state
    checks. Pipeline/release/archive and access-key changes are owner-only.
13. Deterministic notes group associated actions under a configurable Markdown
    template. Manual notes remain supported and source is recorded.
14. Changelog returns completed releases newest-first with notes, version,
    released time, commit, stages, and associated actions.
15. Action APIs support pipeline/release/stage filters and hydrate delivery
    summaries for lists and detail.
16. `/releases` and `/releases/:pipelineId` provide accessible pipeline,
    release, stage, issue, note, changelog, and CI configuration surfaces.
17. Browser code calls only the Worker. All public tables enforce RLS; public
    RPC execution and service-role destructive grants are revoked.

## Success Criteria

- A scheduled pipeline release progresses through ordered stage runs and freezes
  membership when configured.
- One idempotent CI event replay produces one event and no duplicate release,
  stage run, or action association.
- Unknown action IDs and frozen additions appear in the processing result.
- Release completion can atomically attach release evidence and complete only
  eligible actions when automation is enabled.
- Action filters and delivery summaries reconcile to release associations.
- Release notes and changelog preserve manual/generated source and chronology.
- Database, Worker, UI, accessibility, production, permission, and readback
  gates pass without fixture or credential residue.

## Edge Cases

- Same external release ID or event key arrives twice.
- Stage key is missing, archived, out of order, or already terminal.
- A release is completed with no actions or notes.
- An action is already done, archived, or unknown.
- A stage is frozen before a later CI scan discovers another action.
- A path-filtered monorepo event has no relevant changes.
- An access key is missing, malformed, or belongs to another pipeline.

## Out Of Scope

- Creating a real pipeline access key or modifying CI secrets without explicit
  owner approval for that exact credential action.
- AI-generated prose; deterministic notes ship now and an agent-assisted draft
  can be added under a later explicit AI workflow.
- GitHub/GitLab workflow-file publication; the ingest contract is CI-agnostic.
