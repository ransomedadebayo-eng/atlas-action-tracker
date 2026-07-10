-- ATLAS trust overhaul (1/3): contain privileged execution and make the two core
-- audit surfaces append-only. This migration is forward-only and safe to run
-- more than once.

do $migration$
declare
  function_record record;
  role_name text;
begin
  for function_record in
    select
      namespace.nspname as schema_name,
      procedure.proname as function_name,
      pg_get_function_identity_arguments(procedure.oid) as identity_arguments
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any (array[
        'activate_atlas_today_rule_proposal',
        'create_atlas_today_rule_version',
        'propose_atlas_today_rule_change',
        'upsert_atlas_today_plan',
        'get_atlas_today_plan',
        'run_atlas_today_retriage_dry_run'
      ])
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public',
      function_record.schema_name,
      function_record.function_name,
      function_record.identity_arguments
    );

    foreach role_name in array array['anon', 'authenticated']
    loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format(
          'revoke execute on function %I.%I(%s) from %I',
          function_record.schema_name,
          function_record.function_name,
          function_record.identity_arguments,
          role_name
        );
      end if;
    end loop;

    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format(
        'grant execute on function %I.%I(%s) to service_role',
        function_record.schema_name,
        function_record.function_name,
        function_record.identity_arguments
      );
    end if;
  end loop;
end
$migration$;

create or replace function public.atlas_reject_immutable_delete()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'ATLAS_IMMUTABLE_HISTORY',
    detail = format('%I.%I is append-only; use an audited status transition instead.', tg_table_schema, tg_table_name);
end
$function$;

revoke all on function public.atlas_reject_immutable_delete() from public;

do $migration$
declare
  role_name text;
begin
  if to_regclass('public.atlas_actions') is null then
    raise exception 'Required table public.atlas_actions is missing';
  end if;
  if to_regclass('public.atlas_activity_log') is null then
    raise exception 'Required table public.atlas_activity_log is missing';
  end if;

  revoke delete, truncate on table public.atlas_actions from public;
  revoke delete, truncate on table public.atlas_activity_log from public;

  foreach role_name in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke delete, truncate on table public.atlas_actions from %I', role_name);
      execute format('revoke delete, truncate on table public.atlas_activity_log from %I', role_name);
    end if;
  end loop;
end
$migration$;

drop trigger if exists atlas_actions_reject_delete on public.atlas_actions;
create trigger atlas_actions_reject_delete
before delete on public.atlas_actions
for each row execute function public.atlas_reject_immutable_delete();

drop trigger if exists atlas_activity_log_reject_delete on public.atlas_activity_log;
create trigger atlas_activity_log_reject_delete
before delete on public.atlas_activity_log
for each row execute function public.atlas_reject_immutable_delete();

comment on function public.atlas_reject_immutable_delete() is
  'Rejects physical deletion from ATLAS action and activity history. Archive or restore through audited RPCs.';
