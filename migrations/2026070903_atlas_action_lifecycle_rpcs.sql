-- ATLAS trust overhaul (3/3): revision-aware, atomic action lifecycle mutations.

alter table public.atlas_actions
  add column if not exists revision bigint not null default 0,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_from_status text,
  add column if not exists archived_from_completed_at timestamptz;

alter table public.atlas_actions
  drop constraint if exists atlas_actions_status_check;
alter table public.atlas_actions
  add constraint atlas_actions_status_check
    check (status in (
      'not_started', 'in_progress', 'waiting', 'blocked',
      'done', 'completed', 'closed', 'cancelled', 'canceled', 'archived', 'todo', 'open'
    )) not valid;
alter table public.atlas_actions
  validate constraint atlas_actions_status_check;

create or replace function public.complete_atlas_action(
  p_action_id text,
  p_evidence jsonb,
  p_actor text,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  action_row public.atlas_actions%rowtype;
  activity_event_id bigint;
  previous_status text;
  server_timestamp timestamptz := timezone('utc', now());
begin
  if p_actor is null or p_actor not in ('ransomed', 'codex', 'claude') then
    raise exception using errcode = '22023', message = 'ATLAS_ACTOR_NOT_ALLOWED';
  end if;
  if p_evidence is null
     or jsonb_typeof(p_evidence) <> 'object'
     or p_evidence = '{}'::jsonb
  then
    raise exception using errcode = '22023', message = 'ATLAS_COMPLETION_EVIDENCE_REQUIRED';
  end if;

  select * into action_row
  from public.atlas_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ATLAS_ACTION_NOT_FOUND';
  end if;
  if p_expected_revision is not null and action_row.revision <> p_expected_revision then
    raise exception using
      errcode = '40001',
      message = 'ATLAS_REVISION_CONFLICT',
      detail = format('Expected revision %s but found %s.', p_expected_revision, action_row.revision);
  end if;

  previous_status := action_row.status;

  update public.atlas_actions
  set status = 'done',
      evidence_json = p_evidence,
      completed_at = server_timestamp,
      archived_at = null,
      archived_from_status = null,
      archived_from_completed_at = null,
      revision = revision + 1,
      updated_at = server_timestamp
  where id = p_action_id
  returning * into action_row;

  insert into public.atlas_activity_log (
    action_id, event, old_value, new_value, actor, created_at
  )
  values (
    p_action_id,
    'completed',
    previous_status,
    jsonb_build_object(
      'status', 'done',
      'revision', action_row.revision,
      'evidence_quality', public.atlas_derive_evidence_quality(p_evidence)
    )::text,
    p_actor,
    server_timestamp
  )
  returning id into activity_event_id;

  return jsonb_build_object(
    'action', to_jsonb(action_row),
    'activity_event_id', activity_event_id,
    'revision', action_row.revision,
    'server_timestamp', server_timestamp
  );
end
$function$;

create or replace function public.archive_atlas_action(
  p_action_id text,
  p_actor text,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  action_row public.atlas_actions%rowtype;
  activity_event_id bigint;
  previous_status text;
  server_timestamp timestamptz := timezone('utc', now());
begin
  if p_actor is null or p_actor not in ('ransomed', 'codex', 'claude') then
    raise exception using errcode = '22023', message = 'ATLAS_ACTOR_NOT_ALLOWED';
  end if;

  select * into action_row
  from public.atlas_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ATLAS_ACTION_NOT_FOUND';
  end if;
  if p_expected_revision is not null and action_row.revision <> p_expected_revision then
    raise exception using
      errcode = '40001',
      message = 'ATLAS_REVISION_CONFLICT',
      detail = format('Expected revision %s but found %s.', p_expected_revision, action_row.revision);
  end if;

  if action_row.status = 'archived' then
    return jsonb_build_object(
      'action', to_jsonb(action_row),
      'activity_event_id', null::bigint,
      'revision', action_row.revision,
      'server_timestamp', server_timestamp
    );
  end if;

  previous_status := action_row.status;

  update public.atlas_actions
  set status = 'archived',
      archived_at = server_timestamp,
      archived_from_status = previous_status,
      archived_from_completed_at = completed_at,
      completed_at = null,
      revision = revision + 1,
      updated_at = server_timestamp
  where id = p_action_id
  returning * into action_row;

  insert into public.atlas_activity_log (
    action_id, event, old_value, new_value, actor, created_at
  )
  values (
    p_action_id,
    'archived',
    previous_status,
    jsonb_build_object('status', 'archived', 'revision', action_row.revision)::text,
    p_actor,
    server_timestamp
  )
  returning id into activity_event_id;

  return jsonb_build_object(
    'action', to_jsonb(action_row),
    'activity_event_id', activity_event_id,
    'revision', action_row.revision,
    'server_timestamp', server_timestamp
  );
end
$function$;

create or replace function public.restore_atlas_action(
  p_action_id text,
  p_actor text,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  action_row public.atlas_actions%rowtype;
  activity_event_id bigint;
  restored_status text;
  restored_completed_at timestamptz;
  server_timestamp timestamptz := timezone('utc', now());
begin
  if p_actor is null or p_actor not in ('ransomed', 'codex', 'claude') then
    raise exception using errcode = '22023', message = 'ATLAS_ACTOR_NOT_ALLOWED';
  end if;

  select * into action_row
  from public.atlas_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ATLAS_ACTION_NOT_FOUND';
  end if;
  if p_expected_revision is not null and action_row.revision <> p_expected_revision then
    raise exception using
      errcode = '40001',
      message = 'ATLAS_REVISION_CONFLICT',
      detail = format('Expected revision %s but found %s.', p_expected_revision, action_row.revision);
  end if;
  if action_row.status <> 'archived' then
    raise exception using errcode = '22023', message = 'ATLAS_ACTION_NOT_ARCHIVED';
  end if;

  restored_status := coalesce(nullif(action_row.archived_from_status, 'archived'), 'not_started');
  restored_completed_at := case
    when restored_status in ('done', 'completed', 'closed') then action_row.archived_from_completed_at
    else null
  end;

  update public.atlas_actions
  set status = restored_status,
      completed_at = restored_completed_at,
      archived_at = null,
      archived_from_status = null,
      archived_from_completed_at = null,
      revision = revision + 1,
      updated_at = server_timestamp
  where id = p_action_id
  returning * into action_row;

  insert into public.atlas_activity_log (
    action_id, event, old_value, new_value, actor, created_at
  )
  values (
    p_action_id,
    'restored',
    'archived',
    jsonb_build_object('status', restored_status, 'revision', action_row.revision)::text,
    p_actor,
    server_timestamp
  )
  returning id into activity_event_id;

  return jsonb_build_object(
    'action', to_jsonb(action_row),
    'activity_event_id', activity_event_id,
    'revision', action_row.revision,
    'server_timestamp', server_timestamp
  );
end
$function$;

revoke all on function public.complete_atlas_action(text, jsonb, text, bigint) from public;
revoke all on function public.archive_atlas_action(text, text, bigint) from public;
revoke all on function public.restore_atlas_action(text, text, bigint) from public;

do $migration$
declare
  function_signature text;
  role_name text;
begin
  foreach function_signature in array array[
    'public.complete_atlas_action(text,jsonb,text,bigint)',
    'public.archive_atlas_action(text,text,bigint)',
    'public.restore_atlas_action(text,text,bigint)'
  ]
  loop
    foreach role_name in array array['anon', 'authenticated']
    loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('revoke execute on function %s from %I', function_signature, role_name);
      end if;
    end loop;

    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', function_signature);
    end if;
  end loop;
end
$migration$;

comment on function public.complete_atlas_action(text, jsonb, text, bigint) is
  'Atomically completes an action with nonempty evidence, revision checking, and an activity event.';
comment on function public.archive_atlas_action(text, text, bigint) is
  'Atomically archives an action while preserving its prior lifecycle state for restoration.';
comment on function public.restore_atlas_action(text, text, bigint) is
  'Atomically restores an archived action to its pre-archive lifecycle state.';
