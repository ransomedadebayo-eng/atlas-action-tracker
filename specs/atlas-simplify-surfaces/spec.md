> Approved implementation handoff: GPT-6.1 Sol xhigh / Codex. Implementation uses authenticated actor `codex` and branch `codex/atlas-simplify-surfaces`, superseding Claude-specific attribution below. Code implementation is approved; production release, database retirement/permission changes, and live agent-contract rollout remain gated in [the release runbook](../../docs/atlas-simplification/release-runbook.md). Source: [Claude current spec](https://claude.ai/code/artifact/c35fbdba-41f4-43e9-9926-9a19a1d38e90), Oct 17, 2026, version displayed as Today 4:03 PM Current. Original document text follows unchanged. The embedded diagram is preserved in the source PDF handoff.

# Atlas simplification spec

Oct 17, 2026 · @Ransomed

## Decision

Delete three surfaces, fold three into pages you already use, and keep Projects as the one container. The sidebar drops from 21 items to 15, and 36 tables leave the `public` schema: 18 that never held a row are dropped, 18 with history move to an `atlas_archive` schema.

| Surface | Verdict | Where its job goes | Why |
| --- | --- | --- | --- |
| Releases | Delete | Action evidence (`evidence_json`) already records delivery | 7 tables, 0 rows ever |
| Templates | Delete | Nothing; the Sunday automation builds weekly plans | 3 tables, 0 rows ever |
| Insights (with dashboards and CSV exports) | Delete, fold 2 metrics into Projects | Projects list shows open actions, oldest open age, stale flag | 4 seed charts from Aug 21, never edited; 0 exports |
| Workflows (with triage) | Collapse to one fixed status list in code | `atlas_actions.status`; triage becomes status `open` plus a "Needs triage" view | 25 identical copies of the same 9 statuses; 0 rules |
| Cycles | Merge into Week | Week page gets a must-win and day-focus scorecard | 1 cycle used (Aug 20 to Sep 2); weekly plans are the real cadence |
| Initiatives | Merge into Projects | Projects grouped by business | 6 initiatives, never given a health update; one duplicates the Career project |
| Projects | Keep | The single container for multi-step work | 64 of 67 open actions sit in a project |

Defaults the owner can veto before Sonnet starts:

- CSV exports go with Insights, because nothing was ever exported.
- Parent/sub-action auto-close goes with Workflows. Only Real Estate had it on, it never fired, and it closes tasks without the owner naming them.
- The FamilyOS operating charter document moves to the "Company Operations" project, and the 3 FamilyOS initiative links are appended to that project's description.
- No history is deleted. Tables with rows move to `atlas_archive`; dropping them later needs an explicit owner OK.
- No action's status value is changed by this work.

## Evidence

Every surface on the cut list was built in the Aug 21 "Linear parity" sprint and has done little since. Counts are exact rows in AEGIS project `vdezxdeushxaacyfjeeh`, queried Oct 17, 2026.

| Surface | Tables and rows | Last real activity |
| --- | --- | --- |
| Releases | 7 tables, 0 rows | Never |
| Templates | 3 tables, 0 rows; no action, project or document references one | Never |
| Insights | `atlas_insights` 4, `atlas_dashboards` 1, `atlas_dashboard_insights` 4, `atlas_analytics_activity_log` 9, `atlas_insight_snapshots` 0, `atlas_export_receipts` 0 | Aug 21 (seed rows only) |
| Workflows | `atlas_workflows` 25 (24 business values plus 1 fallback; case duplicates include `AEGIS`/`aegis`), `atlas_workflow_statuses` 225, `atlas_workflow_rules` 0, `atlas_workflow_rule_runs` 18 (all `no_match`), `atlas_workflow_activity_log` 19 | Statuses last edited Aug 21 |
| Triage | `atlas_triage_settings` 25, `atlas_triage_entries` 1, `atlas_triage_events` 0; `atlas_inactivity_policy_runs` 0, `atlas_hierarchy_automation_events` 0 | Aug 22 |
| Cycles | `atlas_cycles` 4, `atlas_cycle_schedules` 1, `atlas_cycle_scope_events` 53, `atlas_cycle_activity_log` 22 | Cycle 1 ran Aug 20 to Sep 2 with 8 actions; Cycle 2 auto-started Oct 17 holding 1 action |
| Initiatives | `atlas_initiatives` 6, `atlas_initiative_projects` 27, `atlas_initiative_resources` 3, `atlas_initiative_updates` 0, `atlas_initiative_relations` 0, `atlas_initiative_activity_log` 39 | Sep 27; every initiative's health is still `no_update` |
| Projects (kept) | `atlas_projects` 30, `atlas_project_milestones` 34, `atlas_project_updates` 44, `atlas_project_dependencies` 3 | Oct 17 |
| Weekly plans (kept) | 17 revisions, 299 items, 236 calendar commitments | Oct 5 |

What the numbers mean:

- Of 67 open actions, 64 have a project, 1 has a cycle, and 9 of 738 actions ever got an estimate. Cycle and effort charts have nothing to measure.
- The 25 workflows are the same 9 statuses copied for 24 business values plus one fallback. Only `backlog` vs `todo` and `duplicate` add detail beyond `atlas_actions.status`; one archived action uses `backlog` and none use `duplicate`.
- The workflow layer still costs something: a database trigger looks up a workflow and rewrites `status` on every action write, and the Worker runs a rule engine on every action write that has never matched (18 runs, all `no_match`).
- Four of six initiatives line up with business values (wealth-os plus real\_estate, the ventures, familyos, aegis). "Life & Family Operations" spans the family, health and personal businesses. "Career — Product & Business Leadership" wraps exactly one project with the same target date (Feb 24, 2028).

## Target model

After the change Atlas has one container (projects, grouped by business), one status list, and one cadence (the weekly plan feeding Today).

&#91;embedded content: where each surface goes · 7 surfaces, 4 destinations\]

Projects keep milestones, updates and health; actions keep sub-actions, relations and evidence. The only new pieces are three computed project columns and the week scorecard.

## Guardrails for the implementer

Ship code before the migration, change no action status, and delete no history. These rules override convenience.

1. **Order is load-bearing.** Deploy the Phase 1 code and confirm it is live before running the Phase 2 migration. The current Worker joins `atlas_workflow_statuses` and queries `atlas_release_actions` and `atlas_triage_entries` on every task list, so migrating first breaks every list.
2. **No status changes.** Do not change `status`, priority, owners, due date, approval state or evidence on any action. The owner rule is one named task, one confirmation, one update. The migration writes exactly three rows: one document, one saved view, one project.
3. **No deletes.** Never `DELETE` from an Atlas table (repo `AGENTS.md`). Tables with rows move to `atlas_archive`. A table is dropped only if the same transaction proves it has zero rows.
4. **No `CASCADE`.** Every `DROP` names its object explicitly so an unexpected dependency fails loudly.
5. **Dry run first.** Run the migration inside `BEGIN … ROLLBACK` through `execute_sql`, then apply it with Supabase `apply_migration`. Test trigger behaviour with `UPDATE`s inside rolled-back transactions; never insert test actions, because each insert burns an action identifier for good.
6. **GitHub-first.** Work on branch `claude/atlas-simplify-surfaces` (base: see 7), open a PR, deploy only through the main-branch workflow, and confirm the deployed commit.
7. **Build on the open branch.** `codex/fix-action-partial-save` (Oct 6) is 2 commits ahead of `main` and makes the action form send only changed fields. Branch from it, and confirm with the owner that it is meant to ship. On `main` the form re-sends the whole record on every save, which rewrites statuses (see Phase 1, status code).
8. **Stay in scope.** Do not touch Today, daily plans, Documents (beyond context types), Notifications (beyond categories), Office Digest, Review, Decide, Journal, Calendar, Principals, Transcripts, Automations or media tables.
9. **Stop on surprises.** If any preflight count differs from Phase 0, or a table in the drop list has rows, stop and report before changing anything.
10. **Agent identity.** Use actor `claude` for every write. Report `implemented`, `verified` and `remaining_work` separately.

## Phase 0 — Preflight (read-only)

Confirm the database and repo still match this spec before writing anything; paste the results into the PR description.

1. Clone `ransomedadebayo-eng/atlas-action-tracker`, check out `main`, resolve guardrail 7, create `claude/atlas-simplify-surfaces`, run `npm run install:all && npm run check` and record the baseline.
2. Run this count query through Supabase `execute_sql` on project `vdezxdeushxaacyfjeeh`:

```sql
select table_name,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text::int as n
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
  and table_name ~ '^atlas_(release|template|insight|dashboard|analytics|export_receipts|cycle|initiative|workflow|triage|inactivity_policy|hierarchy_automation)'
order by 1;
```

3. Compare with these expected values. **Drop list — every count must be 0:** `atlas_releases`, `atlas_release_pipelines`, `atlas_release_stages`, `atlas_release_stage_runs`, `atlas_release_actions`, `atlas_release_events`, `atlas_release_activity_log`, `atlas_templates`, `atlas_template_instances`, `atlas_template_activity_log`, `atlas_insight_snapshots`, `atlas_export_receipts`, `atlas_initiative_relations`, `atlas_initiative_updates`, `atlas_workflow_rules`, `atlas_triage_events`, `atlas_inactivity_policy_runs`, `atlas_hierarchy_automation_events` (18 tables).
4. **Archive list — counts as of Oct 17; equal or slightly higher is fine:** `atlas_insights` 4, `atlas_dashboards` 1, `atlas_dashboard_insights` 4, `atlas_analytics_activity_log` 9, `atlas_cycles` 4, `atlas_cycle_schedules` 1, `atlas_cycle_scope_events` 53, `atlas_cycle_activity_log` 22, `atlas_initiatives` 6, `atlas_initiative_projects` 27, `atlas_initiative_resources` 3, `atlas_initiative_activity_log` 39, `atlas_workflows` 25, `atlas_workflow_statuses` 225, `atlas_workflow_rule_runs` 18, `atlas_workflow_activity_log` 19, `atlas_triage_settings` 25, `atlas_triage_entries` 1 (18 tables).
5. Confirm these invariants (all read-only selects):

| Check | Expected |
| --- | --- |
| Actions, projects or documents with `template_id` or `template_instance_id` set | 0 |
| `atlas_documents` with `context_type = 'cycle'` | 0 |
| `atlas_documents` with `context_type = 'initiative'` | 1 (`document-familyos-operating-charter`) |
| Active `atlas_saved_views` with `entity_type = 'initiative'` | 1 (`portfolio-active-initiatives`) |
| `atlas_saved_views.context_initiative_id` or `atlas_integration_subscriptions.initiative_id` set | 0 |
| Project `project-familyos-operations` exists and is not archived | true (status `paused`) |
| Views in any schema depending on the retired tables | 0 |

6. Confirm the 53 functions named in Phase 2, step 8 all still exist (a `proname = any(array[…])` select; expect 53 rows, one per name, so none is overloaded).

Do not build the drop list from a keyword search on function names. A search for "cycle", "triage" or "insight" also matches `atlas_manage_action_lifecycle_timestamps`, `atlas_stamp_proposal_lifecycle`, `run_atlas_today_retriage_dry_run`, the three `jarvis_v1_*_triage` functions and four `wealth_*` functions. All of those are live and stay.

## Phase 1 — Worker and app code

Remove six features from the Worker and the app, add two small replacements, and deploy before any database change. The new code must not read or write any retired table, but must still work while those tables exist.

### Shared status list

One list replaces 25 workflows. Put it in `worker/src/utils/statuses.ts` and `app/src/utils/statuses.js` (same values, same order):

| Value | Label | Aliases accepted on input |
| --- | --- | --- |
| `open` | Needs triage | `triage` |
| `not_started` | To do | `todo`, `backlog` |
| `in_progress` | In progress |  |
| `waiting` | Waiting |  |
| `blocked` | Blocked |  |
| `done` | Done | `completed`, `closed` |
| `canceled` | Canceled | `cancelled` |
| `archived` | Archived |  |

The Worker maps aliases before writing. Display code maps them when reading, because 32 existing rows still say `cancelled` and must not be rewritten.

### Worker — delete

- `routes/cycles.ts`, `routes/initiatives.ts`, `routes/templates.ts`, `routes/releases.ts`, `routes/insights.ts`, `routes/dashboards.ts`, `routes/exports.ts`, `routes/workflows.ts` (both `workflowRouter` and `triageRouter`), with their `*.test.ts` files.
- `services/workflows.ts`, `utils/workflowRules.ts`, `utils/insights.ts`, with their tests. Grep first that nothing else imports `rowsToCsv`, `evaluateInsight` or `loadAnalyticsActions`.

### Worker — edit

- `index.ts`: drop the imports and the mounts for `/api/cycles`, `/api/initiatives`, `/api/templates`, `/api/releases`, `/api/insights`, `/api/dashboards`, `/api/exports`, `/api/workflows` and `/api/triage`. Before `app.use('/api/*', authMiddleware)`, mount one handler for those nine prefixes that returns 410 with code `ATLAS_SURFACE_RETIRED` and a one-line pointer to Projects or Week. Without it, machine principals get 403 `INSUFFICIENT_SCOPE` (authorization runs before routing), which reads as a permissions bug.
- `middleware/authorize.ts` and its test: remove the `cycles:*`, `initiatives:*`, `templates:*`, `releases:*`, `insights:*`, `exports:read` and `workflows:*` scopes and their route rules.
- `middleware/auth.ts` and its test: remove the release access-key path (`/api/releases/ingest/:id`, header `x-atlas-release-key`, `matchReleaseAccessKey`, auth kind `release_access`).
- `utils/actionUtils.ts`: replace `VALID_STATUSES` and `STATUS_COERCE` with the shared list and alias map. Today `VALID_STATUSES` lacks `open`, `canceled` and `archived`, and `STATUS_COERCE` turns `open` into `not_started` and `cancelled` into `done`. Keep `EXPLICIT_TRANSITION_STATUSES`.
- `routes/actions.ts`:
  - `ACTION_SELECT` becomes `'*'`; responses stop carrying `workflow_status` and `workflow_automation_runs`.
  - Delete `hydrateReleaseSummaries` (around lines 224–260) and all three calls: both list branches (around 341 and 358) and action detail (around 707). It reads `atlas_release_actions` on every task list.
  - Delete the triage block (around 328–333) that reads `atlas_triage_entries` on every list, and the `triageActionIds` filters (around 342 and 359).
  - Remove every `executeWorkflowRules` call and the `enter_atlas_triage_action` call on create; replace `loadWorkflowAction` with a plain select by id. On create, `body.triage === true` maps to `status = 'open'`.
  - Remove the `cycle_id`, `template_id`, `release_id`, `pipeline_id`, `stage_run_id` and `include_triage` filters, and `cycle_id` from `validSorts`.
  - Stop writing `workflow_status_id`, `cycle_id`, `template_id` and `template_instance_id`. If a caller sends them, ignore them and log one "ignored deprecated field" warning; do not return 400, because agents will keep sending them until Phase 3.
  - Validate `status` against the shared list after alias mapping.
- `routes/projects.ts`: remove initiative membership loading (list and detail), the `initiative` and `template_id` filters and template fields. The list's action select (around line 246) loads only `id,project_id,status,estimate_points`; add `created_at,updated_at,archived_at`, and load the newest `atlas_project_updates.created_at` per project. Then add four fields per project:
  - `open_action_count`: actions with status `open`, `not_started`, `todo`, `in_progress`, `waiting` or `blocked` and no `archived_at`.
  - `oldest_open_days`: whole days since the oldest open action's `created_at`.
  - `last_activity_at`: latest of the project's `updated_at`, its actions' `updated_at` and its newest project update.
  - `is_stale`: project status `in_progress` and `last_activity_at` older than 14 days.
- `routes/weeks.ts`: no change needed. Week items already carry their linked action row as `item.action` (around lines 119–131), finished actions included.
- `routes/views.ts`: entity types become `action` and `project`; drop cycle filter handling; stop writing `context_initiative_id` (around lines 78 and 109) — ignore it and log the same warning.
- `routes/integrations.ts`: stop writing `initiative_id` (around line 54) the same way, and drop the retired categories and resource types from input validation.
- `routes/notifications.ts`: drop categories `initiative_updates`, `cycles`, `releases`, `analytics`, `workflows` and resources `initiative`, `cycle`, `template`, `release`, `insight`, `workflow` from input validation only. 159 of the 1,909 stored notifications carry those values and must still list.
- `routes/documents.ts`: allowed context types become `workspace`, `project`, `action`; remove template handling.
- `routes/comments.ts`: drop target types `initiative` and `initiative_update`.
- Grep `atlasOs.ts`, `briefing.ts`, `today.ts`, `decide.ts` and `automations/atlasToday.ts` for any leftover reference; none were found on `main`.

### App — delete

- `components/CyclesPage.jsx`, `InitiativesPage.jsx`, `TemplatesPage.jsx`, `ReleasesPage.jsx`, `InsightsPage.jsx`, `WorkflowsPage.jsx`, `ActionCycleControl.jsx`, with their tests.
- `hooks/useCycles.js`, `useInitiatives.js`, `useTemplates.js`, `useReleases.js`, `useInsights.js`, `useWorkflows.js`.

### App — edit

- `utils/constants.js`: replace `STATUSES`, `STATUS_LIST`, `canonicalStatus` and `KANBAN_COLUMNS` with the shared list. Today `canonicalStatus` turns `open` into `not_started` and `canceled` into `cancelled`, and `ActionDetail` fills its form from it (around lines 98 and 126), so a save can rewrite a status the owner never touched. Kanban columns become `open`, `not_started`, `in_progress`, `waiting`, `blocked`, `done`, `canceled`; `archived` stays hidden; keep an "Unclassified" column only for unknown values.
- `components/Layout.jsx`: `NAV_LINKS` becomes Today, Week, Projects, All Tasks, Kanban, Documents, Notifications, Office Digest, Review, Decide, Journal, Calendar, Principals, Transcripts, Automations (15). The mobile bar is unchanged.
- `App.jsx`: remove the six lazy imports, the `initiativeId`, `releasePipelineId`, `insightId`, `dashboardId` and `cycleId` state, the matching `VIEW_PATHS` keys (around lines 37–44) and navigation helpers (around 164–200). In `routeFromLocation`, redirect old paths with `history.replaceState`, because stored notifications link to them: `/cycles*` → `/week`; `/initiatives*` → `/projects?group=business`; `/insights*` and `/dashboards*` → `/projects`; `/templates`, `/releases`, `/workflows` → `/today`.
- `components/TopBar.jsx`: remove the retired titles.
- `api/client.js`: remove `cyclesApi`, `initiativesApi`, `templatesApi`, `releasesApi`, `insightsApi`, `dashboardsApi`, `exportsApi`, `workflowsApi`, `triageApi`.
- `components/StatusBadge.jsx`: drop the `workflowStatus` prop and read labels and colours from the shared list. Update its callers: `ActionTable`, `TodayDashboard`, `TodayList`, `TodayReview`, `WeekPage`, `MemberDetail`.
- `components/ActionDetail.jsx`: the status select uses the shared list (remove `useWorkflow` and the `workflow_status_id` field), and a save sends `status` only when the owner changed it. Remove the cycle, template and release sections.
- `components/ActionTable.jsx` and `FilterBar.jsx`: remove the cycle filter, `useCycles` and cycle badges. Add a "Needs triage" status option (`status=open`).
- `components/ProjectsPage.jsx`: remove the template picker and `useInstantiateTemplate` from the create form, the initiative filter, `useInitiatives` and initiative links. Default `group_by` to `business` (URL `group=business`). Show open actions, oldest open age and a "Stale" badge on each project row and card.
- `components/ProjectViewLayouts.jsx`: replace the `initiative` grouping with `business`, labelled from the businesses list in `/api/config`.
- `components/WeekPage.jsx`: add a one-line scorecard above Must wins: "Must wins done X of Y · Day focus done X of Y · Carried over N", counted from `item.action.status`. No new tables and no writes.
- `components/QuickCapture.jsx`, `DocumentsPage.jsx`, `NotificationsPage.jsx`: remove template use, the `initiative` and `cycle` document contexts, and the retired notification categories.
- Saved views UI: hide the `initiative` entity type.

### Tests, delivery, and the gate to Phase 2

1. `scripts/validate-overhaul-contract.mjs` (run by `npm run contract`) requires the retired features to exist; remove those requirements. Delete the pgTAP files `supabase/tests/atlas_cycles_test.sql`, `atlas_initiatives_test.sql`, `atlas_releases_test.sql`, `atlas_insights_exports_test.sql` and `atlas_workflows_triage_test.sql`. Edit, keeping their other assertions: `atlas_templates_documents_test.sql` (drop the template half), `atlas_core_conveniences_test.sql`, `atlas_portfolio_activation_test.sql` (it expects the initiative view to be unarchived), `atlas_portfolio_hierarchy_test.sql`, and `atlas_collaboration_test.sql` (it inserts initiatives; update its `plan(83)` count and the contract line that checks it). Do not edit or delete old files under `migrations/`.
2. Update the unit tests that import removed modules or retired fields: Worker `middleware/auth.test.ts`, `middleware/authorize.test.ts`, `actions.test.ts`, `projects.test.ts`, `views.test.ts`, `comments.test.ts`, `documents.test.ts`; app `ActionDetail.test.jsx`, `ActionTable.test.jsx`, `ProjectsPage.test.jsx`, `QuickCapture.test.jsx`.
3. Add tests for: alias mapping on both sides; saving only the title of an `open` action leaves it `open`, and of a `canceled` action leaves it `canceled`; the four project fields (including `is_stale` at exactly 14 days); the week scorecard; the legacy redirects; 410 `ATLAS_SURFACE_RETIRED` for the owner and for a machine principal.
4. `npm run check` passes; open the PR with the Phase 0 results.
5. Merge to `main`, let the GitHub workflow deploy, and confirm the deployed commit.
6. In a browser on atlas.ransomed.app, load Today, Week, Projects, All Tasks, Kanban and one action detail, and change nothing. Phase 2 starts only after this passes.

## Phase 2 — Database migration

One migration file does all database work in nine steps. Every object name in it was checked against the live database on Oct 17, the file parses cleanly, and an independent read-only review confirmed every object, count and dependency; it has not been executed.

1. Preflight assertions: raises an exception if any drop-list table has rows, if any template reference exists, if an unexpected cycle or initiative document exists, or if the target project is missing.
2. Creates schema `atlas_archive` (no access for `anon` or `authenticated`) and snapshots every action's `cycle_id`, `workflow_status_id`, workflow status key and template ids into `atlas_archive.action_retired_pointers`.
3. Writes the only three rows: re-homes the FamilyOS charter document to `project-familyos-operations`, archives the `portfolio-active-initiatives` saved view, and appends the 3 initiative links to that project's description. Each gets a row in `atlas_taxonomy_migration_audit`. Expect two owner notifications from the existing audit triggers.
4. Drops the 6 workflow, cycle and triage triggers on `atlas_actions` and `atlas_comments`, and adds `atlas_actions_00_normalize_status`, which keeps the old alias mapping (`completed`/`closed` → `done`, `cancelled` → `canceled`, `todo` → `not_started`, duplicate resolution → `done`) and turns a missing status into not\_started, but only for rows whose status or resolution is being written.
5. Rewrites `atlas_validate_document_context` and `atlas_discussion_target_exists` without the retired branches and narrows `atlas_documents_context_type_check` to workspace, project and action.
6. Drops the 10 foreign keys from live tables into retired tables and marks the 10 leftover columns `DEPRECATED` in their comments.
7. Drops the 18 empty tables, drops the 13 triggers on history tables whose functions are about to go, moves the 18 history tables to `atlas_archive`, and leaves the service role read-only access there. The shared `atlas_reject_*` protection triggers stay on the moved tables.
8. Drops the 53 retired functions by name.
9. Postflight assertions: no retired table left in `public`, exactly 19 tables in `atlas_archive`.

How to run it:

- Commit the file under `migrations/`, named with the version `apply_migration` actually records (it stamps the apply time), following the repo's ledger convention in `docs/migration-ledger-reconciliation-2026-08-21.json`.
- Dry run: send `BEGIN;` + the file + the database checks from Acceptance criteria + `ROLLBACK;` through `execute_sql`. It holds locks on `atlas_actions` for a few seconds, so run it outside the morning and evening automation windows. Gaps in log and notification ids afterwards are expected and harmless.
- Apply: Supabase `apply_migration` with name `atlas_simplify_surfaces` and the file body (without `BEGIN`/`ROLLBACK`).
- If anything fails, the transaction rolls back by itself. Fix the cause and rerun; never patch half-applied state by hand.

```sql
-- 20261018000000_atlas_simplify_surfaces.sql
-- Retires Releases, Templates, Insights (dashboards, exports), Workflows (triage), Cycles, Initiatives.
-- Run ONLY after the Phase 1 Worker is deployed and verified.
-- No CASCADE, no DELETE, no action status changes. apply_migration runs it as one transaction;
-- for the dry run wrap it in BEGIN; ... ROLLBACK; yourself.

-- 1. Preflight: stop if the database no longer matches the spec
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array[
    'atlas_releases', 'atlas_release_pipelines', 'atlas_release_stages', 'atlas_release_stage_runs',
    'atlas_release_actions', 'atlas_release_events', 'atlas_release_activity_log',
    'atlas_templates', 'atlas_template_instances', 'atlas_template_activity_log',
    'atlas_insight_snapshots', 'atlas_export_receipts',
    'atlas_initiative_relations', 'atlas_initiative_updates',
    'atlas_workflow_rules', 'atlas_triage_events', 'atlas_inactivity_policy_runs',
    'atlas_hierarchy_automation_events'
  ] loop
    execute format('select count(*) from public.%I', t) into n;
    if n > 0 then
      raise exception 'ATLAS_SIMPLIFY_TABLE_NOT_EMPTY: % has % rows', t, n;
    end if;
  end loop;

  if exists (select 1 from public.atlas_actions where template_id is not null or template_instance_id is not null)
     or exists (select 1 from public.atlas_projects where template_id is not null or template_instance_id is not null)
     or exists (select 1 from public.atlas_documents where template_id is not null or template_instance_id is not null) then
    raise exception 'ATLAS_SIMPLIFY_TEMPLATE_REFERENCES_FOUND';
  end if;

  if exists (select 1 from public.atlas_documents where context_type = 'cycle')
     or exists (select 1 from public.atlas_documents
                where context_type = 'initiative' and id <> 'document-familyos-operating-charter') then
    raise exception 'ATLAS_SIMPLIFY_UNEXPECTED_DOCUMENT_CONTEXT';
  end if;

  if not exists (select 1 from public.atlas_projects
                 where id = 'project-familyos-operations' and status <> 'archived') then
    raise exception 'ATLAS_SIMPLIFY_TARGET_PROJECT_MISSING';
  end if;
end
$$;

-- 2. Archive schema and a snapshot of the pointers that live rows keep
create schema atlas_archive;
comment on schema atlas_archive is
  'Atlas surfaces retired 2026-10-18 (cycles, initiatives, insights, workflows, triage). Read-only history. Drop only with explicit owner approval.';
revoke all on schema atlas_archive from public, anon, authenticated;
grant usage on schema atlas_archive to service_role;

create table atlas_archive.action_retired_pointers as
select a.id as action_id,
       a.cycle_id,
       a.workflow_status_id,
       s.status_key as workflow_status_key,
       a.template_id,
       a.template_instance_id,
       timezone('utc', now()) as captured_at
  from public.atlas_actions a
  left join public.atlas_workflow_statuses s on s.id = a.workflow_status_id;
alter table atlas_archive.action_retired_pointers enable row level security;

-- 3. The only row writes: one document, one saved view, one project, plus their audit rows
insert into public.atlas_taxonomy_migration_audit
  (id, migration_key, source_table, source_id, field_name, old_value, new_value)
select coalesce((select max(id) from public.atlas_taxonomy_migration_audit), 0) + v.n,
       '20261018_atlas_simplify_surfaces', v.source_table, v.source_id, v.field_name, v.old_value, v.new_value
  from (values
    (1, 'atlas_documents', 'document-familyos-operating-charter', 'context',
        '{"context_type":"initiative","context_id":"initiative-familyos-return-time"}'::jsonb,
        '{"context_type":"project","context_id":"project-familyos-operations"}'::jsonb),
    (2, 'atlas_saved_views', 'portfolio-active-initiatives', 'archived_at',
        'null'::jsonb,
        '"archived: initiatives retired"'::jsonb),
    (3, 'atlas_projects', 'project-familyos-operations', 'description',
        to_jsonb((select description from public.atlas_projects where id = 'project-familyos-operations')),
        to_jsonb((select p.description
                         || E'\n\nLinks moved from the retired FamilyOS initiative (Oct 2026):\n'
                         || r.links
                    from public.atlas_projects p,
                         (select string_agg('- ' || title || coalesce(': ' || url, ''), E'\n' order by title) as links
                            from public.atlas_initiative_resources
                           where initiative_id = 'initiative-familyos-return-time'
                             and status = 'active') r
                   where p.id = 'project-familyos-operations')))
  ) as v(n, source_table, source_id, field_name, old_value, new_value);

update public.atlas_documents
   set context_type = 'project',
       context_id = 'project-familyos-operations',
       revision = revision + 1,
       updated_by = 'claude',
       updated_at = timezone('utc', now())
 where id = 'document-familyos-operating-charter'
   and context_type = 'initiative';

update public.atlas_saved_views
   set archived_at = timezone('utc', now()),
       revision = revision + 1,
       updated_by = 'claude',
       updated_at = timezone('utc', now())
 where id = 'portfolio-active-initiatives'
   and archived_at is null;

update public.atlas_projects p
   set description = p.description
                     || E'\n\nLinks moved from the retired FamilyOS initiative (Oct 2026):\n'
                     || r.links,
       revision = p.revision + 1,
       updated_by = 'claude',
       updated_at = timezone('utc', now())
  from (select string_agg('- ' || title || coalesce(': ' || url, ''), E'\n' order by title) as links
          from public.atlas_initiative_resources
         where initiative_id = 'initiative-familyos-return-time'
           and status = 'active') r
 where p.id = 'project-familyos-operations'
   and r.links is not null;

-- 4. Remove workflow, cycle and triage triggers from live tables; keep the old alias mapping
drop trigger atlas_actions_sync_workflow_status on public.atlas_actions;
drop trigger atlas_actions_apply_hierarchy_completion_policy on public.atlas_actions;
drop trigger atlas_actions_auto_add_cycle on public.atlas_actions;
drop trigger atlas_actions_capture_cycle_scope on public.atlas_actions;
drop trigger atlas_actions_unsnooze_triage on public.atlas_actions;
drop trigger atlas_comments_unsnooze_triage on public.atlas_comments;

create function public.atlas_normalize_action_status()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  -- Only touch rows whose status or resolution is being written now; never rewrite untouched history.
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.resolution is not distinct from old.resolution then
    return new;
  end if;
  new.status := case coalesce(new.status, 'not_started')
    when 'completed' then 'done'
    when 'closed' then 'done'
    when 'cancelled' then 'canceled'
    when 'todo' then 'not_started'
    else coalesce(new.status, 'not_started')
  end;
  -- Parity with the old workflow trigger: a duplicate resolution always lands on done (archived rows excepted).
  if new.resolution = 'duplicate' and new.status not in ('done', 'archived') then
    new.status := 'done';
  end if;
  return new;
end
$function$;
revoke execute on function public.atlas_normalize_action_status() from public, anon, authenticated;

create trigger atlas_actions_00_normalize_status
  before insert or update on public.atlas_actions
  for each row execute function public.atlas_normalize_action_status();

-- 5. Shared functions that still named retired tables, and the document context check
create or replace function public.atlas_validate_document_context()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.context_type = 'workspace' then
    return new;
  end if;
  if new.context_type = 'project'
     and not exists (select 1 from public.atlas_projects where id = new.context_id and status <> 'archived') then
    raise exception using errcode = '23503', message = 'ATLAS_DOCUMENT_PROJECT_NOT_FOUND';
  end if;
  if new.context_type = 'action'
     and not exists (select 1 from public.atlas_actions where id = new.context_id and status <> 'archived') then
    raise exception using errcode = '23503', message = 'ATLAS_DOCUMENT_ACTION_NOT_FOUND';
  end if;
  return new;
end
$function$;

alter table public.atlas_documents drop constraint atlas_documents_context_type_check;
alter table public.atlas_documents add constraint atlas_documents_context_type_check
  check (context_type = any (array['workspace', 'project', 'action']));

create or replace function public.atlas_discussion_target_exists(p_target_type text, p_target_id text)
returns boolean
language plpgsql
stable
set search_path to ''
as $function$
begin
  return case p_target_type
    when 'action' then exists (select 1 from public.atlas_actions where id = p_target_id)
    when 'project' then exists (select 1 from public.atlas_projects where id = p_target_id)
    when 'document' then exists (select 1 from public.atlas_documents where id = p_target_id)
    when 'project_update' then exists (select 1 from public.atlas_project_updates where id = p_target_id)
    when 'comment' then exists (select 1 from public.atlas_comments where id = p_target_id)
    else false
  end;
end
$function$;

-- 6. Detach live tables from retired ones (columns stay until Phase 4)
alter table public.atlas_actions drop constraint atlas_actions_cycle_id_fkey;
alter table public.atlas_actions drop constraint atlas_actions_workflow_status_id_fkey;
alter table public.atlas_actions drop constraint atlas_actions_template_id_fkey;
alter table public.atlas_actions drop constraint atlas_actions_template_instance_id_fkey;
alter table public.atlas_projects drop constraint atlas_projects_template_id_fkey;
alter table public.atlas_projects drop constraint atlas_projects_template_instance_id_fkey;
alter table public.atlas_documents drop constraint atlas_documents_template_id_fkey;
alter table public.atlas_documents drop constraint atlas_documents_template_instance_id_fkey;
alter table public.atlas_saved_views drop constraint atlas_saved_views_context_initiative_id_fkey;
alter table public.atlas_integration_subscriptions drop constraint atlas_integration_subscriptions_initiative_id_fkey;

comment on column public.atlas_actions.cycle_id is 'DEPRECATED 2026-10-18: cycles retired, history in atlas_archive. Do not write.';
comment on column public.atlas_actions.workflow_status_id is 'DEPRECATED 2026-10-18: workflows retired; status is the only state. Do not write.';
comment on column public.atlas_actions.template_id is 'DEPRECATED 2026-10-18: templates retired. Do not write.';
comment on column public.atlas_actions.template_instance_id is 'DEPRECATED 2026-10-18: templates retired. Do not write.';
comment on column public.atlas_projects.template_id is 'DEPRECATED 2026-10-18: templates retired. Do not write.';
comment on column public.atlas_projects.template_instance_id is 'DEPRECATED 2026-10-18: templates retired. Do not write.';
comment on column public.atlas_documents.template_id is 'DEPRECATED 2026-10-18: templates retired. Do not write.';
comment on column public.atlas_documents.template_instance_id is 'DEPRECATED 2026-10-18: templates retired. Do not write.';
comment on column public.atlas_saved_views.context_initiative_id is 'DEPRECATED 2026-10-18: initiatives retired. Do not write.';
comment on column public.atlas_integration_subscriptions.initiative_id is 'DEPRECATED 2026-10-18: initiatives retired. Do not write.';

-- 7. Drop the 18 empty tables; move the 18 history tables to atlas_archive
drop table
  public.atlas_release_actions,
  public.atlas_release_activity_log,
  public.atlas_release_events,
  public.atlas_release_stage_runs,
  public.atlas_release_stages,
  public.atlas_releases,
  public.atlas_release_pipelines,
  public.atlas_template_activity_log,
  public.atlas_template_instances,
  public.atlas_templates,
  public.atlas_insight_snapshots,
  public.atlas_export_receipts,
  public.atlas_initiative_relations,
  public.atlas_initiative_updates,
  public.atlas_workflow_rules,
  public.atlas_triage_events,
  public.atlas_inactivity_policy_runs,
  public.atlas_hierarchy_automation_events;

-- Triggers on history tables whose functions are dropped in step 8.
-- Shared protection triggers (atlas_reject_*) and notify triggers stay.
drop trigger atlas_insights_audit_row on public.atlas_insights;
drop trigger atlas_dashboards_audit_row on public.atlas_dashboards;
drop trigger atlas_dashboard_insights_audit_row on public.atlas_dashboard_insights;
drop trigger atlas_cycles_audit_row on public.atlas_cycles;
drop trigger atlas_cycles_protect_snapshot on public.atlas_cycles;
drop trigger atlas_cycle_schedules_audit_row on public.atlas_cycle_schedules;
drop trigger atlas_initiatives_audit_row on public.atlas_initiatives;
drop trigger atlas_initiatives_manage_row on public.atlas_initiatives;
drop trigger atlas_initiative_projects_audit_row on public.atlas_initiative_projects;
drop trigger atlas_initiative_resources_audit_row on public.atlas_initiative_resources;
drop trigger atlas_initiative_resources_validate_target on public.atlas_initiative_resources;
drop trigger atlas_workflow_statuses_validate on public.atlas_workflow_statuses;
drop trigger atlas_triage_settings_validate on public.atlas_triage_settings;

alter table public.atlas_insights set schema atlas_archive;
alter table public.atlas_dashboards set schema atlas_archive;
alter table public.atlas_dashboard_insights set schema atlas_archive;
alter table public.atlas_analytics_activity_log set schema atlas_archive;
alter table public.atlas_cycles set schema atlas_archive;
alter table public.atlas_cycle_schedules set schema atlas_archive;
alter table public.atlas_cycle_scope_events set schema atlas_archive;
alter table public.atlas_cycle_activity_log set schema atlas_archive;
alter table public.atlas_initiatives set schema atlas_archive;
alter table public.atlas_initiative_projects set schema atlas_archive;
alter table public.atlas_initiative_resources set schema atlas_archive;
alter table public.atlas_initiative_activity_log set schema atlas_archive;
alter table public.atlas_workflows set schema atlas_archive;
alter table public.atlas_workflow_statuses set schema atlas_archive;
alter table public.atlas_workflow_rule_runs set schema atlas_archive;
alter table public.atlas_workflow_activity_log set schema atlas_archive;
alter table public.atlas_triage_settings set schema atlas_archive;
alter table public.atlas_triage_entries set schema atlas_archive;

revoke all on all tables in schema atlas_archive from public, anon, authenticated, service_role;
revoke all on all sequences in schema atlas_archive from public, anon, authenticated, service_role;
grant select on all tables in schema atlas_archive to service_role;

-- 8. Drop the 53 retired functions (verify each name exists in Phase 0; no CASCADE)
drop function public.apply_atlas_inactivity_action;
drop function public.archive_atlas_workflow_status;
drop function public.assign_atlas_action_to_cycle;
drop function public.atlas_apply_hierarchy_completion_policy;
drop function public.atlas_audit_analytics_row;
drop function public.atlas_audit_cycle_row;
drop function public.atlas_audit_cycle_schedule_row;
drop function public.atlas_audit_initiative_child_row;
drop function public.atlas_audit_initiative_row;
drop function public.atlas_audit_release_row;
drop function public.atlas_audit_template_row;
drop function public.atlas_auto_add_action_to_cycle;
drop function public.atlas_capture_action_cycle_change;
drop function public.atlas_capture_cycle_scope;
drop function public.atlas_manage_initiative_row;
drop function public.atlas_protect_completed_cycle_snapshot;
drop function public.atlas_sync_action_workflow_status;
drop function public.atlas_unsnooze_triage_on_action_activity;
drop function public.atlas_unsnooze_triage_on_comment;
drop function public.atlas_validate_initiative_resource_target;
drop function public.atlas_validate_template_row;
drop function public.atlas_validate_triage_settings;
drop function public.atlas_validate_workflow_status_definition;
drop function public.complete_atlas_cycle;
drop function public.configure_atlas_cycle_schedule;
drop function public.configure_atlas_workflow_status;
drop function public.create_atlas_release;
drop function public.disable_atlas_cycle_schedule;
drop function public.duplicate_atlas_template;
drop function public.enter_atlas_triage_action;
drop function public.generate_atlas_release_notes;
drop function public.ingest_atlas_release_event;
drop function public.instantiate_atlas_template;
drop function public.move_atlas_initiative_order;
drop function public.post_atlas_initiative_update;
drop function public.record_atlas_export_receipt;
drop function public.record_atlas_insight_snapshot;
drop function public.record_atlas_workflow_rule_run;
drop function public.remove_atlas_action_from_cycle;
drop function public.reorder_atlas_workflow_statuses;
drop function public.restore_atlas_release;
drop function public.rotate_atlas_release_access_key;
drop function public.set_atlas_initiative_parent;
drop function public.set_atlas_initiative_project;
drop function public.set_atlas_release_action;
drop function public.start_atlas_cycle_today;
drop function public.transition_atlas_analytics_entity;
drop function public.transition_atlas_initiative;
drop function public.transition_atlas_release;
drop function public.transition_atlas_release_stage;
drop function public.transition_atlas_template;
drop function public.transition_atlas_triage_action;
drop function public.upsert_atlas_initiative_resource;

-- 9. Postflight
do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public'
       and table_name ~ '^atlas_(release|template|insight|dashboard|analytics_activity|export_receipts|cycle|initiative|workflow|triage|inactivity_policy|hierarchy_automation)'
  ) then
    raise exception 'ATLAS_SIMPLIFY_RETIRED_TABLE_STILL_PUBLIC';
  end if;
  if (select count(*) from information_schema.tables where table_schema = 'atlas_archive') <> 19 then
    raise exception 'ATLAS_SIMPLIFY_ARCHIVE_TABLE_COUNT';
  end if;
end
$$;
```

## Phase 3 — Agent contracts and docs

The agents that write to Atlas are told to use cycles, initiatives, insights and releases; rewrite those instructions the same day the migration lands, or the next automation run will look for surfaces that no longer exist. These files live on the owner's Mac, so this phase needs the linked computer.

### Contracts under `/Users/music/.codex/automations/`

- `atlas-full-app-operating-contract.md` (263 lines) is the main one:
  - **Operating outcome:** remove the Initiatives, Cycles, Insights and dashboards, and Releases bullets. Triage becomes "actions with status `open`". Parent/sub-actions no longer auto-complete.
  - Delete the **Initiative architecture** and **Cycle and capacity rules** sections. Keep the estimate rule as one line under Project architecture.
  - **Analytics and portfolio health** becomes three lines: the Projects list shows open actions, oldest open age and a stale flag; blocked and waiting work comes from status filters; no dashboards.
  - Lanes: `agent-work-pull` prefers this week's published weekly-plan items, then the highest-priority healthy projects (replaces "active cycle"); `atlas-stewardship-daily` drops cycle eligibility and treats stale `open` actions as its triage queue; `peos-sunday-weekly-prep-brief` selects from projects and milestones only and drops "keep the weekly plan distinct from the cycle".
  - **Required readback** and the `atlas_full_app_coverage` object: remove `actions_cycled`, `initiatives_touched`, `insights_or_dashboards_touched` and `releases_touched`; `triage_pending` counts status `open`.
- `automation-core-contract.md` (around lines 28, 29, 242), `proactive-execution-protocol.md` (around lines 58–63) and `case-ownership-protocol.md` (around line 79): remove the retired nouns.
- Then grep `~/.codex/automations/*/automation.toml` and `~/.codex/skills` for `cycle`, `initiative`, `insight`, `dashboard`, `release`, `template`, `workflow status` and `triage entr`, and fix live instructions only. Leave `memory.md`, `runs/`, `proposals/` and other history files untouched.

### Other code that may call removed endpoints

- Grep the `ransomedadebayo-eng/aegis` and `ransomedadebayo-eng/peos` repos (native Atlas app, MCP tools) for `/api/cycles`, `/api/initiatives`, `/api/releases`, `/api/templates`, `/api/insights`, `/api/dashboards`, `/api/exports`, `/api/workflows`, `/api/triage`, `atlas_cycles`, `atlas_initiatives` and `workflow_status`. Fix any hit in a separate PR per repo, or list it for the owner.

### Repo docs (same PR as Phase 1)

- `AGENTS.md`: replace "action/project/milestone/initiative/cycle/view/document/collaboration/notification/Insight/release model" with "action/project/milestone/view/document/comment/notification/weekly-plan model".
- `README.md` and `docs/linear-parity-matrix.md`: mark the six surfaces retired on Oct 18, 2026 with a pointer to this spec.
- `specs/linear-cycles`, `linear-initiatives`, `linear-insights-exports`, `linear-releases`, `linear-workflows-triage` and the template half of `linear-templates-documents`: add one line at the top of each `spec.md` saying it is retired. Do not delete them.
- Add this spec as `specs/atlas-simplify-surfaces/spec.md` (export the doc to Markdown).

### AEGIS record

- Propose one AEGIS decision through the governed write flow: "Atlas retired cycles, initiatives, insights, workflows, templates and releases on Oct 18, 2026; projects grouped by business plus weekly plans are the planning model." It goes through the owner's review gate; do not self-approve.

## Phase 4 — Deferred cleanup (14 days later, owner-gated)

Remove the leftover columns and branches only after 14 quiet days and an explicit owner OK; this is a separate PR and migration.

Gate, all three must hold:

- At least 14 days since Phase 2 was applied.
- Zero Worker log lines for "ignored deprecated field" in the last 7 days (agents have stopped sending `cycle_id`, `workflow_status_id` or template ids).
- The owner says go.

Then:

1. Drop the 10 deprecated columns: `atlas_actions.cycle_id`, `workflow_status_id`, `template_id`, `template_instance_id`; `atlas_projects.template_id`, `template_instance_id`; `atlas_documents.template_id`, `template_instance_id`; `atlas_saved_views.context_initiative_id`; `atlas_integration_subscriptions.initiative_id`. First confirm no view or function references them.
2. Drop the 6 foreign keys that still run from `atlas_archive` tables into live tables, so archived history never blocks a future change to a live table.
3. Narrow `atlas_saved_views` checks to entity types `action` and `project` (the one initiative view is archived) and drop the initiative-only layout rule.
4. Remove the initiative, cycle, template, release, insight and workflow branches from `atlas_activity_notification_trigger`.
5. Remove any Cloudflare secret that only served release ingestion (`wrangler secret list`; ask before deleting anything whose purpose is unclear).
6. Leave `atlas_archive` in place. Dropping it needs its own explicit owner request.
7. Keep the `cancelled` alias in the action status check: 32 historical rows use it and must not be rewritten.

## Acceptance criteria

The work is done when every box below is checked with evidence attached to the PR; anything unchecked goes under `remaining_work`.

### App and API (after Phase 1)

- [ ] The sidebar shows exactly 15 items in the Phase 1 order, and none of the six retired surfaces.
- [ ] Old links redirect: `/cycles` → `/week`; `/initiatives/initiative-ventures-2026` → `/projects?group=business`; `/insights` → `/projects`; `/templates`, `/releases` and `/workflows` → `/today`.
- [ ] Requests to `/api/cycles`, `/api/initiatives`, `/api/templates`, `/api/releases`, `/api/insights`, `/api/dashboards`, `/api/exports`, `/api/workflows` and `/api/triage` return 410 `ATLAS_SURFACE_RETIRED`, both for the owner and for a machine principal.
- [ ] Action list and detail responses no longer contain `workflow_status`; the status select lists the 8 statuses from the shared list.
- [ ] Projects opens grouped by business; each project shows open actions and oldest open age, and every `in_progress` project with no activity for 14 days shows "Stale". Spot-check three projects against SQL.
- [ ] The Week page scorecard matches a SQL count of done must-wins and day-focus items for the current published week.
- [ ] `npm run check` passes on `main`, and the deployed commit equals `main`'s head.

### Database (after Phase 2)

- [ ] No retired table remains in `public`; `atlas_archive` holds 19 tables, and each moved table's row count equals its Phase 0 count.
- [ ] `select status, count(*) from atlas_actions group by 1` returns the same rows right before and right after applying, apart from changes the owner made in between.
- [ ] No public function still queries a retired table: `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and prosrc ~ 'public\.atlas_(cycle|initiative|release|template|insight|dashboard|analytics_activity|workflow|triage|export_receipts|inactivity_policy|hierarchy_automation)'` returns 0 rows.
- [ ] Supabase security and performance advisors show no new findings.
- [ ] Inside `BEGIN … ROLLBACK`, using `UPDATE`s only: setting an existing action's status to `cancelled` stores `canceled`, setting `todo` stores `not_started`, and changing only the title of a `cancelled` row leaves its status untouched.
- [ ] The FamilyOS charter opens under the Company Operations project, its three links appear in that project's description, and the initiative saved view is gone from the views list.

### Agents (after Phase 3)

- [ ] The next runs of `atlas-stewardship-daily`, `agent-work-pull` and `peos-sunday-weekly-prep-brief` finish without calling a removed endpoint or naming a retired surface in their evidence.
- [ ] The final report lists `implemented`, `verified` and `remaining_work` separately.

## Out of scope, noticed along the way

These came up in the data but are left alone here; each needs its own owner decision.

- **Business values are messy.** Actions carry 30 distinct `business` values, including case duplicates (`AEGIS` and `aegis`, `Personal` and `personal`, `Wealth`, `wealth` and `wealth-os`, `Atlas`, `Personal OS`) and event-sized ones (`nazriels_birthday`, `birthday`, `daycare`, `cpmai`). Projects will now group by business, so folding these is the natural next cleanup. It rewrites action rows, so it needs an approved mapping list.
- **Today may be on its fallback.** Today reads `atlas_daily_plans`, which was last written Aug 1, 2026.
- **Other idle tables.** Integrations (connections, subscriptions, inbound events, outbox) and media daily allowances hold 0 rows; transcripts were last added Jul 30.
- **Status hygiene.** 79 actions have status `archived` but no `archived_at`, and 32 say `cancelled`. Both stay as they are under the one-task, one-confirmation rule.
- **Possible duplicate home for money goals.** The `Financial Goals & Checkpoints` project (12 actions, wealth-os) may overlap with HomeFinance, where financial goals are meant to live.
