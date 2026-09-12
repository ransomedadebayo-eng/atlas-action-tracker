# Releases Tasks

## Database

- [x] Add pipeline/stage/release/stage-run/action/event/activity tables with RLS/audit guards.
- [x] Implement release, stage, association, notes, lifecycle, key, and CI ingestion RPCs.
- [x] Implement freeze, idempotency, unknown-action, and completion-evidence invariants.
- [x] Add and pass the releases pgTAP regression contract.

## Worker

- [x] Add release read/write/ingest scopes and pipeline-key authentication.
- [x] Implement pipeline, release, stage, association, notes, changelog, and ingest routes.
- [x] Enrich action APIs with release filters and summaries.
- [x] Add security, validation, aggregation, and HTTP boundary tests.

## Application

- [x] Add release API client, hooks, routes, and navigation.
- [x] Add pipeline portfolio and configuration.
- [x] Add release/stage/action/notes/changelog detail surfaces.
- [x] Add guarded access-key input without displaying stored credentials.
- [x] Add component and accessibility tests.

## Release

- [x] Run full repository verification and production dependency audits.
- [x] Rehearse/apply/test/read back production migration and advisors.
- [x] Deploy, verify live assets/routes/security, and update parity.
- [ ] Configure a real pipeline access key and external CI only with explicit owner approval.
- [ ] Run authenticated owner-session desktop/mobile interaction smoke when a Cloudflare Access browser session is available.
