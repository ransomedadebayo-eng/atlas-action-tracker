-- Forward correction for production roles that inherited default table grants
-- before the Linear-parity migrations explicitly narrowed them.

do $migration$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke delete, truncate on table public.atlas_projects from service_role;
    revoke delete, truncate on table public.atlas_project_milestones from service_role;
    revoke update, delete, truncate on table public.atlas_project_updates from service_role;
    revoke delete, truncate on table public.atlas_project_dependencies from service_role;
    revoke update, delete, truncate on table public.atlas_project_activity_log from service_role;
    revoke delete, truncate on table public.atlas_action_relations from service_role;
    revoke delete, truncate on table public.atlas_cycle_schedules from service_role;
    revoke delete, truncate on table public.atlas_cycles from service_role;
    revoke update, delete, truncate on table public.atlas_cycle_scope_events from service_role;
    revoke update, delete, truncate on table public.atlas_cycle_activity_log from service_role;
  end if;
end
$migration$;
