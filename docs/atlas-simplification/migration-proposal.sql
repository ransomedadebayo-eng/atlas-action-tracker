-- REVIEW ONLY. NOT APPLIED. Outside migrations/ until explicit database/permission approval.
-- 20261018000000_atlas_simplify_surfaces.sql
-- Retires Releases, Templates, Insights (dashboards, exports), Workflows (triage), Cycles, Initiatives.
-- Run ONLY after the Phase 1 Worker is deployed and verified.
-- No CASCADE, no DELETE, no action status changes. apply_migration runs it as one transaction;
-- for the dry run wrap it in BEGIN; ... ROLLBACK; yourself.

-- 1. Preflight: stop if the database no longer matches the spec
-- Exclude concurrent legacy/direct writers between the empty checks and DROP.
-- Held until transaction end; the quiet-window/backup approval includes these locks.
lock table
  public.atlas_export_receipts,
  public.atlas_hierarchy_automation_events,
  public.atlas_inactivity_policy_runs,
  public.atlas_initiative_relations,
  public.atlas_initiative_updates,
  public.atlas_insight_snapshots,
  public.atlas_release_actions,
  public.atlas_release_activity_log,
  public.atlas_release_events,
  public.atlas_release_pipelines,
  public.atlas_release_stage_runs,
  public.atlas_release_stages,
  public.atlas_releases,
  public.atlas_template_activity_log,
  public.atlas_template_instances,
  public.atlas_templates,
  public.atlas_triage_events,
  public.atlas_workflow_rules
in access exclusive mode;

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
       updated_by = 'codex',
       updated_at = timezone('utc', now())
 where id = 'document-familyos-operating-charter'
   and context_type = 'initiative';

update public.atlas_saved_views
   set archived_at = timezone('utc', now()),
       revision = revision + 1,
       updated_by = 'codex',
       updated_at = timezone('utc', now())
 where id = 'portfolio-active-initiatives'
   and archived_at is null;

update public.atlas_projects p
   set description = p.description
                     || E'\n\nLinks moved from the retired FamilyOS initiative (Oct 2026):\n'
                     || r.links,
       revision = p.revision + 1,
       updated_by = 'codex',
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
