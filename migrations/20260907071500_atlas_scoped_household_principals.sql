-- Opt-in household collaboration on Atlas's existing principal architecture.
-- Access credentials and verified-email mappings remain Worker configuration;
-- this migration only establishes the fixed database principals and invariants.

alter table public.atlas_members
  drop constraint if exists atlas_members_principal_type_check;
alter table public.atlas_members
  add constraint atlas_members_principal_type_check
    check (principal_type in ('owner', 'human', 'agent', 'historical'));

create or replace function public.atlas_principal_is_active(p_principal_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_principal_id in ('ransomed', 'nicole', 'codex', 'claude', 'nicole-codex')
    and exists (
      select 1
      from public.atlas_members member
      where member.id = p_principal_id
        and member.is_active
        and member.principal_type in ('owner', 'human', 'agent')
    )
$function$;

revoke all on function public.atlas_principal_is_active(text) from public;
do $grant$
begin
  if exists (select 1 from pg_roles where rolname='service_role') then
    grant execute on function public.atlas_principal_is_active(text) to service_role;
  end if;
end
$grant$;

create or replace function public.atlas_validate_principal_roster()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.id = 'ransomed' then
    if new.is_active is not true or new.principal_type <> 'owner' then
      raise exception using errcode = '23514', message = 'ATLAS_OWNER_PRINCIPAL_REQUIRED';
    end if;
  elsif new.id = 'nicole' then
    if new.is_active is not true or new.principal_type <> 'human' then
      raise exception using errcode = '23514', message = 'ATLAS_HUMAN_PRINCIPAL_REQUIRED';
    end if;
  elsif new.id in ('codex', 'claude', 'nicole-codex') then
    if new.is_active is not true or new.principal_type <> 'agent' then
      raise exception using errcode = '23514', message = 'ATLAS_AGENT_PRINCIPAL_REQUIRED';
    end if;
  elsif new.is_active is true or new.principal_type <> 'historical' then
    raise exception using errcode = '23514', message = 'ATLAS_HISTORICAL_PRINCIPAL_REQUIRED';
  end if;
  return new;
end
$function$;

-- This upsert intentionally follows the roster-function replacement because
-- the old fixed-roster trigger rejects an active Nicole row.
insert into public.atlas_members (
  id, name, full_name, email, businesses, role, aliases, is_active, principal_type
)
values
  ('nicole', 'Nicole', null, null, '[]'::jsonb, 'Household member', '[]'::jsonb, true, 'human'),
  ('nicole-codex', 'Nicole Codex', null, null, '[]'::jsonb, 'Agent', '[]'::jsonb, true, 'agent')
on conflict (id) do update
set name = case when nullif(btrim(public.atlas_members.name), '') is null then excluded.name else public.atlas_members.name end,
    role = case when nullif(btrim(public.atlas_members.role), '') is null then excluded.role else public.atlas_members.role end,
    is_active = true,
    principal_type = excluded.principal_type;

create or replace function public.atlas_validate_active_action_owners()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  owner_count integer;
  distinct_owner_count integer;
  active_owner_count integer;
begin
  if lower(coalesce(new.status, '')) in ('done', 'completed', 'closed', 'cancelled', 'canceled', 'archived') then
    return new;
  end if;
  if new.owners is null or jsonb_typeof(new.owners) <> 'array' or jsonb_array_length(new.owners) = 0 then
    raise exception using errcode = '23514', message = 'ATLAS_ACTIVE_OWNERS_REQUIRED';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(new.owners) owner(value)
    where not public.atlas_principal_is_active(owner.value)
  ) then
    raise exception using errcode = '23514', message = 'ATLAS_ACTIVE_OWNER_NOT_ALLOWED';
  end if;
  select count(*), count(distinct owner.value)
    into owner_count, distinct_owner_count
    from jsonb_array_elements_text(new.owners) owner(value);
  if owner_count <> distinct_owner_count then
    raise exception using errcode = '23514', message = 'ATLAS_DUPLICATE_ACTIVE_OWNER';
  end if;
  select count(*) into active_owner_count
    from public.atlas_members member
   where member.id in (select jsonb_array_elements_text(new.owners))
     and public.atlas_principal_is_active(member.id);
  if active_owner_count <> owner_count then
    raise exception using errcode = '23514', message = 'ATLAS_ACTIVE_OWNER_REFERENCE_INVALID';
  end if;
  return new;
end
$function$;

create or replace function public.atlas_validate_project_principals()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  principal_count integer;
  unique_count integer;
  active_count integer;
begin
  if new.lead_id is not null and not public.atlas_principal_is_active(new.lead_id) then
    raise exception using errcode = '23514', message = 'ATLAS_PROJECT_LEAD_NOT_ALLOWED';
  end if;
  if new.members is null or jsonb_typeof(new.members) <> 'array' then
    raise exception using errcode = '23514', message = 'ATLAS_PROJECT_MEMBERS_ARRAY_REQUIRED';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(new.members) member(value)
    where not public.atlas_principal_is_active(member.value)
  ) then
    raise exception using errcode = '23514', message = 'ATLAS_PROJECT_MEMBER_NOT_ALLOWED';
  end if;
  select count(*), count(distinct member.value)
    into principal_count, unique_count
    from jsonb_array_elements_text(new.members) member(value);
  if principal_count <> unique_count then
    raise exception using errcode = '23514', message = 'ATLAS_PROJECT_DUPLICATE_MEMBER';
  end if;
  select count(*) into active_count
    from public.atlas_members member
   where member.id in (select jsonb_array_elements_text(new.members))
     and public.atlas_principal_is_active(member.id);
  if active_count <> principal_count then
    raise exception using errcode = '23514', message = 'ATLAS_PROJECT_MEMBER_REFERENCE_INVALID';
  end if;
  return new;
end
$function$;

-- Extend only the existing task, project, initiative, comment, template-instance,
-- and realtime-document functions that already authorize scoped principals.
-- Owner-only archive/configuration functions and integration functions are
-- deliberately excluded. The migration fails if an expected definition has
-- drifted instead of silently broadening an unknown function.
do $migration$
declare
  function_name text;
  function_record record;
  original_definition text;
  updated_definition text;
  matched integer;
begin
  foreach function_name in array array[
    'complete_atlas_action',
    'set_atlas_action_parent',
    'create_atlas_sub_action',
    'mark_atlas_action_duplicate',
    'move_atlas_project_order',
    'move_atlas_project_timeline',
    'atlas_manage_initiative_row',
    'set_atlas_initiative_project',
    'set_atlas_initiative_parent',
    'post_atlas_initiative_update',
    'move_atlas_initiative_order',
    'upsert_atlas_initiative_resource',
    'instantiate_atlas_template',
    'atlas_validate_comment_row',
    'atlas_validate_reaction_row',
    'atlas_validate_subscription_row',
    'create_atlas_comment',
    'update_atlas_comment',
    'transition_atlas_comment',
    'resolve_atlas_comment_thread',
    'toggle_atlas_reaction',
    'set_atlas_discussion_subscription',
    'apply_atlas_document_realtime_edit',
    'record_atlas_document_conflict'
  ]
  loop
    matched := 0;
    for function_record in
      select procedure.oid, pg_get_functiondef(procedure.oid) definition
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public' and procedure.proname = function_name
    loop
      matched := matched + 1;
      original_definition := function_record.definition;
      updated_definition := replace(
        replace(original_definition,
          '(''ransomed'', ''codex'', ''claude'')',
          '(''ransomed'', ''nicole'', ''codex'', ''claude'', ''nicole-codex'')'),
        '(''ransomed'',''codex'',''claude'')',
        '(''ransomed'',''nicole'',''codex'',''claude'',''nicole-codex'')'
      );
      if updated_definition = original_definition and position('nicole-codex' in original_definition) = 0 then
        raise exception using errcode = '55000', message = 'ATLAS_PRINCIPAL_FUNCTION_DRIFT', detail = function_name;
      end if;
      execute updated_definition;
    end loop;
    if matched = 0 then
      raise exception using errcode = '55000', message = 'ATLAS_PRINCIPAL_FUNCTION_MISSING', detail = function_name;
    end if;
  end loop;
end
$migration$;

insert into public.atlas_notification_preferences (
  principal_id, channel, category, delivery_mode, digest_window_minutes, updated_by
)
values
  ('nicole','inbox','all','immediate',null,'system'),
  ('nicole','browser','all','disabled',null,'system'),
  ('nicole','email','all','disabled',null,'system'),
  ('nicole','slack','all','disabled',null,'system'),
  ('nicole','webhook','all','disabled',null,'system'),
  ('nicole-codex','inbox','all','immediate',null,'system'),
  ('nicole-codex','browser','all','disabled',null,'system'),
  ('nicole-codex','email','all','disabled',null,'system'),
  ('nicole-codex','slack','all','disabled',null,'system'),
  ('nicole-codex','webhook','all','disabled',null,'system')
on conflict (principal_id,channel,category) do update
set delivery_mode=excluded.delivery_mode,
    digest_window_minutes=excluded.digest_window_minutes,
    revision=public.atlas_notification_preferences.revision+1,
    updated_by='system',
    updated_at=timezone('utc',now())
where public.atlas_notification_preferences.delivery_mode is distinct from excluded.delivery_mode
   or public.atlas_notification_preferences.digest_window_minutes is distinct from excluded.digest_window_minutes;

create or replace function public.transition_atlas_notification(
  p_notification_id uuid,
  p_status text,
  p_actor text,
  p_expected_revision bigint default null
)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare row_value public.atlas_notifications%rowtype; server_timestamp timestamptz:=timezone('utc',now());
begin
  if not public.atlas_principal_is_active(p_actor) then raise exception using errcode='42501',message='ATLAS_NOTIFICATION_PRINCIPAL_REQUIRED'; end if;
  if p_status not in ('unread','read','archived') then raise exception using errcode='22023',message='ATLAS_NOTIFICATION_STATUS_INVALID'; end if;
  select * into row_value from public.atlas_notifications where id=p_notification_id and principal_id=p_actor for update;
  if not found then raise exception using errcode='P0002',message='ATLAS_NOTIFICATION_NOT_FOUND'; end if;
  if p_expected_revision is not null and row_value.revision<>p_expected_revision then raise exception using errcode='40001',message='ATLAS_REVISION_CONFLICT'; end if;
  update public.atlas_notifications set status=p_status,
    read_at=case when p_status='read' then server_timestamp when p_status='unread' then null else read_at end,
    archived_at=case when p_status='archived' then server_timestamp else null end,
    revision=revision+1,updated_at=server_timestamp where id=p_notification_id returning * into row_value;
  return to_jsonb(row_value);
end $function$;

create or replace function public.transition_all_atlas_notifications(p_status text,p_actor text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare changed integer; server_timestamp timestamptz:=timezone('utc',now());
begin
  if not public.atlas_principal_is_active(p_actor) then raise exception using errcode='42501',message='ATLAS_NOTIFICATION_PRINCIPAL_REQUIRED'; end if;
  if p_status not in ('read','archived') then raise exception using errcode='22023',message='ATLAS_NOTIFICATION_STATUS_INVALID'; end if;
  update public.atlas_notifications set status=p_status,
    read_at=case when p_status='read' then server_timestamp else read_at end,
    archived_at=case when p_status='archived' then server_timestamp else null end,
    revision=revision+1,updated_at=server_timestamp
  where principal_id=p_actor and status<>p_status and status<>'archived';
  get diagnostics changed=row_count;
  return jsonb_build_object('updated',changed,'status',p_status);
end $function$;

create or replace function public.upsert_atlas_notification_preference(
  p_principal_id text,p_channel text,p_category text,p_delivery_mode text,
  p_digest_window_minutes integer,p_actor text,p_expected_revision bigint default null
)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare row_value public.atlas_notification_preferences%rowtype; server_timestamp timestamptz:=timezone('utc',now());
begin
  if p_principal_id<>p_actor or not public.atlas_principal_is_active(p_actor) then raise exception using errcode='42501',message='ATLAS_NOTIFICATION_PRINCIPAL_REQUIRED'; end if;
  select * into row_value from public.atlas_notification_preferences where principal_id=p_principal_id and channel=p_channel and category=p_category for update;
  if found and p_expected_revision is not null and row_value.revision<>p_expected_revision then raise exception using errcode='40001',message='ATLAS_REVISION_CONFLICT'; end if;
  insert into public.atlas_notification_preferences(principal_id,channel,category,delivery_mode,digest_window_minutes,revision,updated_by,updated_at)
  values(p_principal_id,p_channel,p_category,p_delivery_mode,p_digest_window_minutes,0,p_actor,server_timestamp)
  on conflict(principal_id,channel,category) do update set delivery_mode=excluded.delivery_mode,digest_window_minutes=excluded.digest_window_minutes,
    revision=public.atlas_notification_preferences.revision+1,updated_by=p_actor,updated_at=server_timestamp
  returning * into row_value;
  return to_jsonb(row_value);
end $function$;

comment on function public.atlas_principal_is_active(text) is
  'Fixed Atlas roster check for the owner, opted-in household human, and their scoped agents. Authentication remains a Worker responsibility.';
