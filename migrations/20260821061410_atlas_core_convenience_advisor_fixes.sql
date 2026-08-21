-- Advisor follow-up for Atlas project-management slices.

create index if not exists atlas_action_project_conversions_project_idx
  on public.atlas_action_project_conversions(project_id);
create index if not exists atlas_hierarchy_automation_workflow_idx
  on public.atlas_hierarchy_automation_events(workflow_id,created_at desc);
create index if not exists atlas_text_reference_events_reference_idx
  on public.atlas_text_reference_events(reference_id,created_at desc);

do $migration$
declare table_name text; role_name text;
begin
  foreach table_name in array array[
    'atlas_weekly_plan_revisions','atlas_weekly_plan_items',
    'atlas_weekly_plan_commitments','atlas_weekly_plan_activity'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on table public.%I from public',table_name);
    foreach role_name in array array['anon','authenticated'] loop
      if exists(select 1 from pg_roles where rolname=role_name) then
        execute format('revoke all on table public.%I from %I',table_name,role_name);
      end if;
    end loop;
    if exists(select 1 from pg_roles where rolname='service_role') then
      if table_name in ('atlas_weekly_plan_items','atlas_weekly_plan_commitments') then
        execute format('grant select,insert,update,delete on table public.%I to service_role',table_name);
      elsif table_name='atlas_weekly_plan_activity' then
        execute format('grant select,insert on table public.%I to service_role',table_name);
      else
        execute format('grant select,insert,update on table public.%I to service_role',table_name);
      end if;
    end if;
  end loop;
end
$migration$;
