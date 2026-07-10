# ATLAS Trust Overhaul Tasks

## 1. Baseline and containment

- [x] Preserve current user changes and record baseline build/type/audit results.
- [x] Add database security and no-delete migrations with regression SQL.
- [x] Remove Worker cron/manual automation execution and make registry read-only.
- [x] Patch vulnerable dependencies and repository artifact hygiene.

## 2. Principals and data integrity

- [x] Keep only `ransomed`, `codex`, and `claude` active.
- [x] Remove Nicole auto-owner behavior and validate active owners.
- [x] Normalize active owners with Ransomed fallback; preserve closed history.
- [x] Merge business aliases into canonical lanes with an audit record.
- [x] Add evidence-quality and proposal-lifecycle semantics.

## 3. Canonical backend

- [x] Enforce owner-email allowlist and scoped Codex/Claude machine principals.
- [x] Replace action deletion with archive/restore and explicit completion.
- [x] Standardize pagination, stats, errors, revisions, and activity attribution.
- [x] Remove Express production parity path and unused duplicate APIs.

## 4. Frontend overhaul

- [x] Add stable routes and simplified primary/secondary navigation.
- [x] Limit principal UI to Ransomed, Codex, and Claude.
- [x] Add truthful metrics, pagination, freshness, and distinct failure/empty states.
- [x] Replace raw evidence JSON with summary-first audit details.
- [x] Fix keyboard semantics, labels, dialogs, contrast, reduced motion, and mobile targets.

## 5. Quality and release

- [ ] Add database, Worker, component, accessibility, and end-to-end tests. Database, Worker, component, and automated semantic checks are implemented; signed-in end-to-end coverage remains a staging gate.
- [ ] Add CI gates for typecheck, lint, tests, build, migrations, audit, and smoke checks. Build, typecheck, tests, owner-only contract, and dependency audit are gated; live migration and deployment smoke checks remain staging gates.
- [x] Rewrite architecture/product/runbook documentation for owner-only operation.
- [ ] Run full validation and produce staging/production rollout evidence. Local validation is complete; migration application, pgTAP execution, signed-in smoke tests, and production readback have not been authorized or run.
