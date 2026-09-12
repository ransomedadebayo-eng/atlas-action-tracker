# Linear-to-ATLAS Project Management Parity

Last researched: 2026-08-20. This inventory uses current Linear documentation
as the comparison baseline and separates ATLAS-native equivalents from missing
features. "Partial" means a useful ATLAS primitive exists but does not yet
cover the Linear capability end to end.

Release-integrity note: the production database migrations and records were
verified before the corresponding portfolio UI/API source was committed. Until
the release candidate is merged, deployed, and checked through the authenticated
owner routes, delivery-state claims below mean implemented, test-verified, and
database-verified, not yet owner-UI-visible.

| Capability family | Linear baseline | ATLAS baseline before this slice | Delivery state |
| --- | --- | --- | --- |
| Issues/actions | Title, workflow status, priority, assignee, due date, labels, description, recurrence | Actions support business-scoped configured status, priority, owners, due/review dates, tags, description, evidence, recurrence, work mode, hierarchy, typed resolution, estimates, cycles, templates, discussions, and release delivery summaries/filters | Implemented and verified in production for the tracked action lifecycle |
| Projects | Outcome/date-bound issue containers with lead, members, status, priority, dates, overview, progress | First-class schema, scoped API, portfolio/detail routes, revisioned edits, archive/restore, count/effort progress | Implemented and verified in production |
| Project milestones | Ordered stages, target dates, issue assignment, progress | Ordered milestones, dates, status, action assignment, archive, progress display, and timeline flags | Implemented and verified in production |
| Project updates and health | On track / At risk / Off track reports, reminders, history, comments, reactions | Transactional append-only health updates/history plus threaded comments, selected resolutions, reactions, attachments, mentions, follow/mute, and future activity Inbox fan-out | Strong partial: scheduled reminders and an activated Slack destination remain missing |
| Project dependencies | Blocking graph and timeline violation signal | Transactional directed dependencies with resolve/archive, timeline lines, deterministic violation state, and guarded chain shifts | Implemented and verified in production; automatic rescheduling remains intentionally gated |
| Project views | List, board, timeline, filters, grouping, ordering, saved contextual views | Typed revisioned saved views, URL state, favorites/defaults, list/board/timeline, filters, grouping, ordering, zoom, completion windows, and project-attached action-view tabs | Implemented and verified in production |
| Parent/sub-issues | Hierarchy, inherited properties, progress and filtering | Transactional hierarchy, cycle prevention, inherited properties, progress, filters, configurable protected auto-close, and owner-only parent-to-project conversion receipts | Implemented and verified in production |
| Issue relations | Related, blocks, blocked by, duplicate | Typed append-only graph, blocker readiness synchronization, duplicate lifecycle, immutable `ATLAS-N` identifiers, automatic pasted-identifier relations, and backlinks | Implemented and verified in production |
| Estimates | Configurable scales and effort rollups | Linear/Fibonacci/exponential/T-shirt settings, extended/zero options, validated action estimates, configurable unestimated effort, project/child rollups | Implemented and verified in production |
| Cycles | Repeating time boxes, capacity, rollover, analytics | Business/workspace schedules, 1–8 week cadence, cooldowns, 15 upcoming cycles, auto-add, capacity, scope graph, success weighting, snapshots, rollover, start-today realignment, disable, and authenticated `.ics` feeds | Implemented and verified in production; unattended scheduled transitions remain an integration-layer refinement |
| Initiatives | Objective-level project groups, owner/status/priority/labels/target/resources, health updates, views, project health and completion graph | First-class strategy schema/API/UI, list/timeline views, structured updates, resources, recursive rollups, completion graph, discussions, and future activity Inbox fan-out | Implemented and verified in production; activated Slack/reminder delivery remains cross-cutting |
| Nested initiatives | Multi-level objective hierarchy | Transactional multi-parent DAG, deduplicated descendant projects, cycle rejection, five-level depth limit, parent/child controls | Implemented and verified in production |
| Issue/project templates | Standard and structured form issues, defaults, properties, sub-issues; full project blueprints with lead/members/initiatives/milestones/issues | Typed standard/form action, project, and document templates; exact-business/workspace defaults; required fields/options; nested sub-actions; transactional project graph creation; duplicate/archive/restore; immutable instance provenance and template filters | Implemented and verified in production; external integration triggers remain with integrations |
| Custom views | Durable filtered issue/project/initiative views | Typed, revisioned, favoritable, archivable action/project/initiative views with project and initiative context, including project action tabs | Implemented and verified in production |
| Workflow configuration | Team-specific ordered statuses in fixed categories, default and reserved Duplicate states, auto-close/archive | Business/workspace workflows, custom ordered names/colors/defaults, compatibility lifecycle synchronization, reserved Duplicate, non-destructive status replacement, and preview/apply inactivity policies | Implemented and verified in production; unattended inactivity invocation remains in the integration layer |
| Triage | Special intake inbox, accept/duplicate/decline/snooze, ordered rules, responsibility, property suggestions | Business-scoped Triage settings/queue, responsibility, explicit decisions, snooze/new-activity return, top-down all/any property rules, conflict reporting, preview, owner activation, and idempotent receipts | Implemented and verified in production; AI suggestions and external support-source delivery remain with integrations |
| Comments/reactions | Issue/project/initiative/document/update comments, replies, selected resolutions, attachments, reactions, inline anchors, subscriptions | Canonical cross-surface comments, normalized reply threads, Unicode reactions, mentions, anchors, follow/mute, immutable audit, synchronized notification subscriptions, and future Inbox/webhook events | Implemented and verified in production; AI summaries and activated provider thread sync remain later |
| Documents/resources | Workspace/team/project/initiative/issue/cycle documents, collaborative realtime editor/cursors, Markdown toolbar/slash commands, templates, history/revert, subscriptions, inline comments, object/header links | Workspace/project/initiative/action/cycle Markdown documents, templates/provenance, immutable versions and owner revert, authenticated hibernating realtime rooms, live presence/selections, idempotent operations, three-way merge/conflicts, offline recovery, formatting toolbar/slash menu, heading outline/links, inline comments/replies/resolution/reactions, subscriptions, and Inbox/webhook events | Core document parity implemented and verified in production; rich embeds, true per-span author rendering, and agent-native editing UI remain refinements |
| Releases | Continuous/scheduled pipelines, ownership/path filters, stages/environments, freeze-on-start, version/commit identity, issue associations, CI access keys/events, status automation, notes, changelog | First-class pipelines/stages/releases/stage runs/action associations; SHA-256 pipeline-key auth; idempotent serialized CI ingestion; unknown/frozen reporting; delivery evidence completion; deterministic/manual notes; changelog and action delivery UI/filtering | Implemented and verified in production; no real pipeline/key was configured and external CI workflow publication remains explicitly gated |
| Analytics/insights | Issue count, effort, cycle/lead/triage time, issue age, filters, slice/segment, bar/scatter/burn-up/table, percentiles, dashboards, drill-down, CSV | Saved real-time Insights with full measures/dimensions, prospective lifecycle timing, missing-history counts, percentiles, bar/scatter/burn-up/metric/table, drill-down IDs, dashboard/global/card filters, immutable snapshots, action/project/initiative CSV exports, formula safety, and hashed receipts | Implemented and verified in production; historical unknown starts remain honestly null and external warehouse/Sheets sync remains with integrations |
| Integrations/notifications | Always-on Inbox, per-channel preferences, subscriptions, Slack/email/browser delivery, signed webhooks, retries, Git/calendar/provider links | Future-only owner Inbox, read/archive lifecycle, channel/category preferences, assignment/comment subscriptions, verified draft connections, HMAC delivery IDs, 5-second timeout, 1m/1h/6h retries, dead-letter pausing, external reference graph, and signed inbound staging | Generic framework implemented and verified in production; zero destination/credential is configured, so provider-specific Slack/GitHub/calendar/email OAuth and real external delivery remain unverified |

## Source baseline

- [Projects](https://linear.app/docs/projects)
- [Project milestones](https://linear.app/docs/project-milestones)
- [Project dependencies](https://linear.app/docs/project-dependencies)
- [Initiative and project updates](https://linear.app/docs/initiative-and-project-updates)
- [Initiatives](https://linear.app/docs/initiatives)
- [Sub-initiatives](https://linear.app/docs/sub-initiatives)
- [Display options](https://linear.app/docs/display-options)
- [Cycles](https://linear.app/docs/use-cycles)
- [Parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)
- [Issue relations](https://linear.app/docs/issue-relations)
- [Estimates](https://linear.app/docs/estimates)
- [Custom views](https://linear.app/docs/custom-views)
- [Project templates](https://linear.app/docs/project-templates)
- [Issue templates](https://linear.app/docs/issue-templates)
- [Documents](https://linear.app/docs/documents)
- [Comments and reactions](https://linear.app/docs/comment-on-issues)
- [Releases](https://linear.app/docs/releases)
- [Insights](https://linear.app/docs/insights)
- [Dashboards](https://linear.app/docs/dashboards)
- [Exporting data](https://linear.app/docs/exporting-data)
- [Issue status](https://linear.app/docs/configuring-workflows)
- [Triage](https://linear.app/docs/triage)
- [Notifications](https://linear.app/docs/notifications)
- [Slack](https://linear.app/docs/slack)
- [Webhooks](https://linear.app/developers/webhooks)
- [Editor](https://linear.app/docs/editor)

## Sequencing

1. Project foundation: implemented, migrated, and verified in production.
2. Issue structure: implemented and verified in production, including stable
   identifiers, automatic backlinks, protected auto-close, and conversion.
3. Planning: cycles, capacity, rollover, project board/timeline, and saved
   project views are implemented and verified in production.
4. Strategy: initiatives, nested initiatives, recursive rollups, views, health,
   resources, and completion graphs are implemented and verified in production.
5. Reuse: standard/form action, project, and document templates plus first-class
   versioned Markdown documents are implemented and verified in production.
6. Collaboration: comments/replies/reactions/resolutions/anchors/subscriptions,
   realtime document co-editing, presence, conflict-safe autosave, rich Markdown
   controls, header links, and revert are implemented and verified.
7. Delivery: release pipelines, stages, CI evidence, issue attribution, notes,
   and changelogs are implemented and verified in production.
8. Analytics: Insights, dashboards, snapshots, drill-down, lifecycle measures,
   and audited CSV exports are implemented and verified in production.
9. Workflow: configurable statuses, Triage, deterministic rules, and
   preview/apply inactivity policies are implemented and verified in production.
10. Integrations: Inbox, preferences, subscriptions, verified connection
    lifecycle, signed outbox/retries, reference graph, and inbound staging are
    implemented and verified with no external destination configured.
11. Core convenience completion: project action views, hierarchy completion,
    action conversion, pasted-identifier backlinks, cycle start-today, and
    authenticated calendar feeds are implemented and verified in production.
12. Remaining: provider-specific activation and real delivery, unattended
    integration-layer scheduling, and rich-editor refinements.
