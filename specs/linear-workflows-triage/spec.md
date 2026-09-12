# Linear Workflows, Triage, and Rules

## User value

Atlas should let the owner configure how actions move from intake to completion
without losing the evidence, approval, and non-destructive lifecycle rules that
make Atlas trustworthy. Each business lane gets an ordered workflow, a usable
Triage inbox, and deterministic rules whose effects can be previewed and
audited.

## Source baseline

- Linear Issue status: https://linear.app/docs/configuring-workflows
- Linear Triage: https://linear.app/docs/triage

The 2026-08-20 baseline includes team-specific ordered statuses within fixed
categories; default and reserved duplicate statuses; Triage accept, duplicate,
decline, and snooze actions; ordered property-based Triage rules; responsibility;
and inactivity-based close/archive policies.

## Requirements

### Configurable workflows

- A workflow is scoped to one configured Atlas business lane or to the workspace
  fallback.
- Status categories are fixed and ordered: Triage, Backlog, Unstarted, Started,
  Completed, Canceled, and Duplicate.
- Statuses have a stable key, name, description, color, category, order,
  compatibility lifecycle status, revision, and archive state.
- Each active workflow has one default intake status and one reserved,
  immutable Duplicate status. A category cannot lose its last active status.
- Statuses can be created, edited, reordered, made default, and archived without
  hard deletion. The reserved Duplicate status cannot be renamed or archived.
- Existing actions are backfilled to the matching business workflow and status
  without changing their legacy lifecycle value, completion state, timestamps,
  owners, or evidence.
- New and edited actions may select a workflow status. The database verifies
  that the status belongs to the action's business workflow and keeps the
  existing `status` compatibility field synchronized.

### Triage

- Triage can be enabled per workflow, with an optional priority-before-accept
  requirement, responsible principals, and a default accepted status.
- Actions can enter Triage explicitly or at creation time with a typed intake
  source.
- The queue excludes snoozed items by default and can show them on request.
- Accept moves an action to the configured default status; decline moves it to
  Canceled with an optional reason; duplicate uses the existing transactional
  duplicate resolution; snooze hides an action until a timestamp or new action
  activity.
- Every entry and decision is revision-aware and writes immutable events and
  Atlas activity evidence. Triage records are archived, never deleted.

### Deterministic rules

- Rules are ordered within a workflow and trigger on Triage entry, action
  creation, action update, status change, priority change, or manual evaluation.
- Conditions support all/any matching over title, description, source label,
  priority, compatibility status, workflow category, tags, owners, business,
  project, and work mode.
- Operators support equals, not-equals, contains, one-of, not-one-of, empty, and
  non-empty checks.
- Effects may set a non-terminal workflow status, priority, owners, project,
  work mode, and add/remove labels. Rules cannot complete, archive, duplicate,
  send, publish, approve, or otherwise cross an Atlas approval boundary.
- Evaluation is deterministic and top-to-bottom. Earlier scalar effects win;
  later conflicting effects are reported rather than silently overriding them.
- Rules are created disabled, support preview, require an owner action to
  activate, and write idempotent run receipts containing matched rules,
  proposed/applied effects, conflicts, and the event key.

### Inactivity policies

- A workflow may configure auto-close and auto-archive thresholds.
- Candidate evaluation is previewable and excludes archived actions, actions
  with incomplete approval/review obligations, and actions outside configured
  categories.
- Applying a policy is owner-only, idempotent, evidence-producing, and auditable.
- No Cloudflare Worker cron or hidden provider executor is added. The guarded
  external automation layer may call the owner-authorized apply route later;
  until then the Atlas UI exposes explicit preview and apply controls.

### UI and authorization

- `/workflows` provides Workflow, Triage, Rules, and Inactivity views for the
  selected business.
- Action detail uses the configured workflow statuses and displays custom status
  names/colors while preserving existing completion/archive controls.
- Workflow configuration, rule mutation/activation, Triage decisions, and
  inactivity application are owner-only. Scoped principals may read with
  `workflows:read`; no machine principal may mutate configuration.
- All new public-schema tables use RLS, public/anon/authenticated grants are
  revoked, service-role privileges exclude delete, and privileged functions are
  explicitly revoked from public roles.

## Success criteria

- Migration backfills every production action with a valid workflow status and
  preserves all pre-migration action lifecycle data.
- Database tests cover constraints, backfill compatibility, Triage decisions,
  rule receipts/idempotency, conflict-safe effects, RLS, grants, and no-delete
  guarantees.
- Worker tests cover rule matching/merging, API authorization, Triage routes,
  and error handling. UI tests cover status management, queue decisions, rule
  creation/preview, and inactivity preview.
- The production migration is rehearsed transactionally, applied, checked with
  database advisors, deployed to Cloudflare, and verified through live routes
  plus authoritative database readback.
