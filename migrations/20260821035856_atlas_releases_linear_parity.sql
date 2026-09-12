-- Linear parity slice 8: continuous/scheduled release pipelines, ordered
-- stages, stage runs, issue attribution, idempotent CI events, notes, changelog,
-- pipeline access-key hashes, and release completion automation.

create table if not exists public.atlas_release_pipelines (
  id text primary key,
  name text not null,
  description text not null default '',
  pipeline_type text not null check(pipeline_type in ('continuous','scheduled')),
  business text,
  path_filters jsonb not null default '[]'::jsonb check(jsonb_typeof(path_filters)='array'),
  notes_template text not null default E'# {{release_name}}\n\n{{issues}}',
  auto_generate_notes boolean not null default false,
  complete_actions_on_release boolean not null default false,
  access_key_hash text,
  access_key_fingerprint text,
  access_key_rotated_at timestamptz,
  status text not null default 'active' check(status in ('active','archived')),
  revision bigint not null default 0 check(revision>=0),
  archived_at timestamptz,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  check(access_key_hash is null or access_key_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists atlas_release_pipelines_active_idx on public.atlas_release_pipelines(status,business,name);

create table if not exists public.atlas_release_stages (
  id text primary key,
  pipeline_id text not null references public.atlas_release_pipelines(id) on delete restrict,
  stage_key text not null,
  name text not null,
  environment text not null,
  position integer not null check(position>=0),
  freeze_on_start boolean not null default false,
  status text not null default 'active' check(status in ('active','archived')),
  revision bigint not null default 0 check(revision>=0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  unique(pipeline_id,stage_key),
  unique(pipeline_id,position)
);

create index if not exists atlas_release_stages_pipeline_idx on public.atlas_release_stages(pipeline_id,status,position);

create table if not exists public.atlas_releases (
  id text primary key,
  pipeline_id text not null references public.atlas_release_pipelines(id) on delete restrict,
  external_id text,
  name text not null,
  version text,
  commit_sha text,
  status text not null default 'planned' check(status in ('planned','in_progress','completed','canceled','failed','archived')),
  scheduled_at timestamptz,
  released_at timestamptz,
  notes text not null default '',
  notes_source text not null default 'manual' check(notes_source in ('manual','deterministic','ci')),
  revision bigint not null default 0 check(revision>=0),
  archived_at timestamptz,
  archived_from_status text,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);

create unique index if not exists atlas_releases_external_idx on public.atlas_releases(pipeline_id,external_id) where external_id is not null;
create index if not exists atlas_releases_pipeline_status_idx on public.atlas_releases(pipeline_id,status,coalesce(released_at,scheduled_at,created_at) desc);
create index if not exists atlas_releases_commit_idx on public.atlas_releases(commit_sha) where commit_sha is not null;

create table if not exists public.atlas_release_stage_runs (
  id text primary key,
  release_id text not null references public.atlas_releases(id) on delete restrict,
  stage_id text not null references public.atlas_release_stages(id) on delete restrict,
  status text not null default 'pending' check(status in ('pending','started','completed','canceled','failed')),
  commit_sha text,
  external_url text,
  frozen_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  revision bigint not null default 0 check(revision>=0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  unique(release_id,stage_id)
);

create index if not exists atlas_release_stage_runs_release_idx on public.atlas_release_stage_runs(release_id,status);
create index if not exists atlas_release_stage_runs_stage_idx on public.atlas_release_stage_runs(stage_id,status);

create table if not exists public.atlas_release_actions (
  id text primary key,
  release_id text not null references public.atlas_releases(id) on delete restrict,
  action_id text not null references public.atlas_actions(id) on delete restrict,
  stage_run_id text references public.atlas_release_stage_runs(id) on delete restrict,
  source text not null default 'manual' check(source in ('manual','ci')),
  status text not null default 'active' check(status in ('active','removed')),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);

create unique index if not exists atlas_release_actions_active_idx on public.atlas_release_actions(release_id,action_id) where status='active';
create index if not exists atlas_release_actions_action_idx on public.atlas_release_actions(action_id,release_id) where status='active';
create index if not exists atlas_release_actions_stage_run_idx on public.atlas_release_actions(stage_run_id) where stage_run_id is not null;

create table if not exists public.atlas_release_events (
  id text primary key,
  pipeline_id text not null references public.atlas_release_pipelines(id) on delete restrict,
  event_key text not null,
  event_type text not null check(event_type in ('release_created','stage_started','stage_completed','stage_failed','release_completed','release_failed','ignored')),
  release_id text references public.atlas_releases(id) on delete restrict,
  external_release_id text,
  commit_sha text,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object'),
  processing_result jsonb not null default '{}'::jsonb check(jsonb_typeof(processing_result)='object'),
  actor text not null,
  created_at timestamptz not null default timezone('utc',now()),
  unique(pipeline_id,event_key)
);

create index if not exists atlas_release_events_release_idx on public.atlas_release_events(release_id,occurred_at desc);

create table if not exists public.atlas_release_activity_log (
  id bigint generated by default as identity primary key,
  entity_type text not null,
  entity_id text not null,
  event text not null,
  old_value jsonb,
  new_value jsonb,
  actor text not null,
  created_at timestamptz not null default timezone('utc',now())
);

create index if not exists atlas_release_activity_entity_idx on public.atlas_release_activity_log(entity_type,entity_id,created_at desc);

create or replace function public.atlas_audit_release_row()
returns trigger language plpgsql set search_path='' as $function$
declare kind text; row_json jsonb:=to_jsonb(new); old_json jsonb:=case when tg_op='INSERT' then null else to_jsonb(old) end; actor_value text; event_name text;
begin
  kind:=case tg_table_name when 'atlas_release_pipelines' then 'pipeline' when 'atlas_release_stages' then 'stage' when 'atlas_releases' then 'release' when 'atlas_release_stage_runs' then 'stage_run' else 'release_action' end;
  actor_value:=case when tg_op='INSERT' then row_json->>'created_by' else row_json->>'updated_by' end;
  event_name:=case when tg_op='INSERT' then kind||'_created' when (row_json->>'status') is distinct from (old_json->>'status') then kind||'_'||(row_json->>'status') else kind||'_updated' end;
  insert into public.atlas_release_activity_log(entity_type,entity_id,event,old_value,new_value,actor)
  values(kind,row_json->>'id',event_name,old_json,row_json,actor_value);
  return new;
end $function$;

revoke all on function public.atlas_audit_release_row() from public;
create trigger atlas_release_pipelines_audit_row after insert or update on public.atlas_release_pipelines for each row execute function public.atlas_audit_release_row();
create trigger atlas_release_stages_audit_row after insert or update on public.atlas_release_stages for each row execute function public.atlas_audit_release_row();
create trigger atlas_releases_audit_row after insert or update on public.atlas_releases for each row execute function public.atlas_audit_release_row();
create trigger atlas_release_stage_runs_audit_row after insert or update on public.atlas_release_stage_runs for each row execute function public.atlas_audit_release_row();
create trigger atlas_release_actions_audit_row after insert or update on public.atlas_release_actions for each row execute function public.atlas_audit_release_row();

create or replace function public.create_atlas_release(p_pipeline_id text,p_release_id text,p_external_id text,p_name text,p_version text,p_commit_sha text,p_scheduled_at timestamptz,p_actor text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare pipeline_row public.atlas_release_pipelines%rowtype; release_row public.atlas_releases%rowtype; stage_row record;
begin
  if p_actor not in ('ransomed','codex','claude','release_ci') then raise exception using errcode='22023',message='ATLAS_ACTOR_NOT_ALLOWED'; end if;
  if nullif(btrim(p_name),'') is null then raise exception using errcode='22023',message='ATLAS_RELEASE_NAME_REQUIRED'; end if;
  select * into pipeline_row from public.atlas_release_pipelines where id=p_pipeline_id and status='active' for update;
  if not found then raise exception using errcode='P0002',message='ATLAS_RELEASE_PIPELINE_NOT_FOUND'; end if;
  insert into public.atlas_releases(id,pipeline_id,external_id,name,version,commit_sha,status,scheduled_at,created_by,updated_by)
  values(p_release_id,p_pipeline_id,p_external_id,btrim(p_name),p_version,p_commit_sha,'planned',p_scheduled_at,p_actor,p_actor) returning * into release_row;
  for stage_row in select * from public.atlas_release_stages where pipeline_id=p_pipeline_id and status='active' order by position loop
    insert into public.atlas_release_stage_runs(id,release_id,stage_id,status,commit_sha,created_by,updated_by)
    values(gen_random_uuid()::text,release_row.id,stage_row.id,'pending',p_commit_sha,p_actor,p_actor);
  end loop;
  return to_jsonb(release_row);
end $function$;

create or replace function public.set_atlas_release_action(p_release_id text,p_action_id text,p_stage_run_id text,p_active boolean,p_source text,p_actor text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare release_row public.atlas_releases%rowtype; run_row public.atlas_release_stage_runs%rowtype; association_row public.atlas_release_actions%rowtype;
begin
  if p_actor not in ('ransomed','codex','claude','release_ci') then raise exception using errcode='22023',message='ATLAS_ACTOR_NOT_ALLOWED'; end if;
  if p_source not in ('manual','ci') then raise exception using errcode='22023',message='ATLAS_RELEASE_ACTION_SOURCE_INVALID'; end if;
  select * into release_row from public.atlas_releases where id=p_release_id for update;
  if not found then raise exception using errcode='P0002',message='ATLAS_RELEASE_NOT_FOUND'; end if;
  if release_row.status in ('completed','canceled','failed','archived') then raise exception using errcode='55000',message='ATLAS_RELEASE_TERMINAL'; end if;
  if not exists(select 1 from public.atlas_actions where id=p_action_id and status<>'archived') then raise exception using errcode='P0002',message='ATLAS_RELEASE_ACTION_NOT_FOUND'; end if;
  if p_stage_run_id is not null then
    select * into run_row from public.atlas_release_stage_runs where id=p_stage_run_id and release_id=p_release_id;
    if not found then raise exception using errcode='23514',message='ATLAS_RELEASE_STAGE_RUN_MISMATCH'; end if;
  end if;
  select * into association_row from public.atlas_release_actions where release_id=p_release_id and action_id=p_action_id order by created_at desc limit 1 for update;
  if p_active and p_stage_run_id is not null and run_row.frozen_at is not null and (not found or association_row.status<>'active') then raise exception using errcode='55000',message='ATLAS_RELEASE_STAGE_FROZEN'; end if;
  if found then
    update public.atlas_release_actions set stage_run_id=p_stage_run_id,status=case when p_active then 'active' else 'removed' end,source=p_source,updated_by=p_actor,updated_at=timezone('utc',now()) where id=association_row.id returning * into association_row;
  elsif p_active then
    insert into public.atlas_release_actions(id,release_id,action_id,stage_run_id,source,status,created_by,updated_by)
    values(gen_random_uuid()::text,p_release_id,p_action_id,p_stage_run_id,p_source,'active',p_actor,p_actor) returning * into association_row;
  else raise exception using errcode='P0002',message='ATLAS_RELEASE_ASSOCIATION_NOT_FOUND';
  end if;
  return to_jsonb(association_row);
end $function$;

create or replace function public.transition_atlas_release_stage(p_stage_run_id text,p_status text,p_commit_sha text,p_external_url text,p_actor text,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare run_row public.atlas_release_stage_runs%rowtype; stage_row public.atlas_release_stages%rowtype;
begin
  if p_actor not in ('ransomed','codex','claude','release_ci') then raise exception using errcode='22023',message='ATLAS_ACTOR_NOT_ALLOWED'; end if;
  if p_status not in ('started','completed','canceled','failed') then raise exception using errcode='22023',message='ATLAS_RELEASE_STAGE_STATUS_INVALID'; end if;
  select * into run_row from public.atlas_release_stage_runs where id=p_stage_run_id for update;
  if not found then raise exception using errcode='P0002',message='ATLAS_RELEASE_STAGE_RUN_NOT_FOUND'; end if;
  if run_row.revision<>p_expected_revision then raise exception using errcode='40001',message='ATLAS_RELEASE_STAGE_REVISION_CONFLICT'; end if;
  if run_row.status in ('completed','canceled','failed') then raise exception using errcode='55000',message='ATLAS_RELEASE_STAGE_TERMINAL'; end if;
  select * into stage_row from public.atlas_release_stages where id=run_row.stage_id;
  if p_status='completed' and run_row.status<>'started' then raise exception using errcode='23514',message='ATLAS_RELEASE_STAGE_NOT_STARTED'; end if;
  update public.atlas_release_stage_runs set status=p_status,commit_sha=coalesce(p_commit_sha,commit_sha),external_url=coalesce(p_external_url,external_url),started_at=case when p_status='started' then coalesce(started_at,timezone('utc',now())) else started_at end,completed_at=case when p_status='completed' then timezone('utc',now()) else completed_at end,frozen_at=case when p_status='started' and stage_row.freeze_on_start then coalesce(frozen_at,timezone('utc',now())) else frozen_at end,revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now()) where id=run_row.id returning * into run_row;
  if p_status='started' then update public.atlas_releases set status='in_progress',revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now()) where id=run_row.release_id and status='planned'; end if;
  return to_jsonb(run_row);
end $function$;

create or replace function public.generate_atlas_release_notes(p_release_id text,p_actor text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare release_row public.atlas_releases%rowtype; pipeline_row public.atlas_release_pipelines%rowtype; issue_lines text; generated text;
begin
  if p_actor not in ('ransomed','codex','claude','release_ci') then raise exception using errcode='22023',message='ATLAS_ACTOR_NOT_ALLOWED'; end if;
  select * into release_row from public.atlas_releases where id=p_release_id for update; if not found then raise exception using errcode='P0002',message='ATLAS_RELEASE_NOT_FOUND'; end if;
  select * into pipeline_row from public.atlas_release_pipelines where id=release_row.pipeline_id;
  select coalesce(string_agg('- '||action.title,E'\n' order by action.priority,action.title),'- No associated actions') into issue_lines from public.atlas_release_actions association join public.atlas_actions action on action.id=association.action_id where association.release_id=p_release_id and association.status='active';
  generated:=replace(replace(replace(pipeline_row.notes_template,'{{release_name}}',release_row.name),'{{version}}',coalesce(release_row.version,'')),'{{issues}}',issue_lines);
  update public.atlas_releases set notes=generated,notes_source='deterministic',revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now()) where id=p_release_id returning * into release_row;
  return to_jsonb(release_row);
end $function$;

create or replace function public.transition_atlas_release(p_release_id text,p_status text,p_notes text,p_actor text,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare release_row public.atlas_releases%rowtype; pipeline_row public.atlas_release_pipelines%rowtype; action_row public.atlas_actions%rowtype;
begin
  if p_actor not in ('ransomed','codex','claude','release_ci') then raise exception using errcode='22023',message='ATLAS_ACTOR_NOT_ALLOWED'; end if;
  if p_status not in ('in_progress','completed','canceled','failed','archived') then raise exception using errcode='22023',message='ATLAS_RELEASE_STATUS_INVALID'; end if;
  select * into release_row from public.atlas_releases where id=p_release_id for update; if not found then raise exception using errcode='P0002',message='ATLAS_RELEASE_NOT_FOUND'; end if;
  if release_row.revision<>p_expected_revision then raise exception using errcode='40001',message='ATLAS_RELEASE_REVISION_CONFLICT'; end if;
  if release_row.status in ('completed','canceled','failed','archived') and release_row.status<>p_status then raise exception using errcode='55000',message='ATLAS_RELEASE_TERMINAL'; end if;
  select * into pipeline_row from public.atlas_release_pipelines where id=release_row.pipeline_id;
  update public.atlas_releases set status=p_status,notes=case when p_notes is not null then p_notes else notes end,notes_source=case when p_notes is not null then 'manual' else notes_source end,released_at=case when p_status='completed' then coalesce(released_at,timezone('utc',now())) else released_at end,archived_at=case when p_status='archived' then timezone('utc',now()) else archived_at end,archived_from_status=case when p_status='archived' then status else archived_from_status end,revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now()) where id=p_release_id returning * into release_row;
  if p_status='completed' and pipeline_row.auto_generate_notes and nullif(btrim(release_row.notes),'') is null then
    release_row:=jsonb_populate_record(null::public.atlas_releases,public.generate_atlas_release_notes(p_release_id,p_actor));
  end if;
  if p_status='completed' and pipeline_row.complete_actions_on_release then
    for action_row in select action.* from public.atlas_release_actions association join public.atlas_actions action on action.id=association.action_id where association.release_id=p_release_id and association.status='active' and action.status not in ('done','completed','closed','canceled','cancelled','archived') loop
      perform public.complete_atlas_action(action_row.id,jsonb_build_object('kind','release_delivery','summary','Delivered in '||release_row.name,'pipeline_id',release_row.pipeline_id,'release_id',release_row.id,'version',release_row.version,'commit_sha',release_row.commit_sha,'released_at',release_row.released_at),case when p_actor='release_ci' then 'codex' else p_actor end,action_row.revision);
    end loop;
  end if;
  return to_jsonb(release_row);
end $function$;

create or replace function public.restore_atlas_release(p_release_id text,p_actor text,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare release_row public.atlas_releases%rowtype;
begin
  if p_actor<>'ransomed' then raise exception using errcode='42501',message='ATLAS_RELEASE_OWNER_REQUIRED'; end if;
  select * into release_row from public.atlas_releases where id=p_release_id for update; if not found then raise exception using errcode='P0002',message='ATLAS_RELEASE_NOT_FOUND'; end if;
  if release_row.revision<>p_expected_revision then raise exception using errcode='40001',message='ATLAS_RELEASE_REVISION_CONFLICT'; end if;
  if release_row.status<>'archived' then return to_jsonb(release_row); end if;
  update public.atlas_releases set status=coalesce(archived_from_status,'planned'),archived_from_status=null,archived_at=null,revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now()) where id=p_release_id returning * into release_row;
  return to_jsonb(release_row);
end $function$;

create or replace function public.rotate_atlas_release_access_key(p_pipeline_id text,p_access_key_hash text,p_fingerprint text,p_actor text,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare row_value public.atlas_release_pipelines%rowtype;
begin
  if p_actor<>'ransomed' then raise exception using errcode='42501',message='ATLAS_RELEASE_OWNER_REQUIRED'; end if;
  if p_access_key_hash !~ '^[0-9a-f]{64}$' or char_length(coalesce(p_fingerprint,'')) not between 8 and 32 then raise exception using errcode='22023',message='ATLAS_RELEASE_ACCESS_KEY_INVALID'; end if;
  select * into row_value from public.atlas_release_pipelines where id=p_pipeline_id for update; if not found then raise exception using errcode='P0002',message='ATLAS_RELEASE_PIPELINE_NOT_FOUND'; end if;
  if row_value.revision<>p_expected_revision then raise exception using errcode='40001',message='ATLAS_RELEASE_PIPELINE_REVISION_CONFLICT'; end if;
  update public.atlas_release_pipelines set access_key_hash=p_access_key_hash,access_key_fingerprint=p_fingerprint,access_key_rotated_at=timezone('utc',now()),revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now()) where id=p_pipeline_id returning * into row_value;
  return to_jsonb(row_value)-'access_key_hash';
end $function$;

create or replace function public.ingest_atlas_release_event(p_pipeline_id text,p_event_key text,p_event_type text,p_external_release_id text,p_release_name text,p_version text,p_commit_sha text,p_stage_key text,p_action_ids jsonb,p_occurred_at timestamptz,p_payload jsonb,p_actor text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare pipeline_row public.atlas_release_pipelines%rowtype; release_row public.atlas_releases%rowtype; event_row public.atlas_release_events%rowtype; stage_row public.atlas_release_stages%rowtype; run_row public.atlas_release_stage_runs%rowtype; action_value jsonb; action_id_value text; associated_ids jsonb:='[]'::jsonb; unknown_ids jsonb:='[]'::jsonb; frozen_ids jsonb:='[]'::jsonb; result jsonb;
begin
  if p_actor not in ('release_ci','ransomed','codex','claude') then raise exception using errcode='22023',message='ATLAS_ACTOR_NOT_ALLOWED'; end if;
  if p_event_type not in ('release_created','stage_started','stage_completed','stage_failed','release_completed','release_failed') or nullif(btrim(p_event_key),'') is null or nullif(btrim(p_external_release_id),'') is null then raise exception using errcode='22023',message='ATLAS_RELEASE_EVENT_INVALID'; end if;
  if jsonb_typeof(coalesce(p_action_ids,'[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_payload,'{}'::jsonb))<>'object' then raise exception using errcode='22023',message='ATLAS_RELEASE_EVENT_PAYLOAD_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_pipeline_id||':'||p_event_key,0));
  select * into event_row from public.atlas_release_events where pipeline_id=p_pipeline_id and event_key=p_event_key;
  if found then return event_row.processing_result||jsonb_build_object('replay',true,'event_id',event_row.id); end if;
  select * into pipeline_row from public.atlas_release_pipelines where id=p_pipeline_id and status='active' for update; if not found then raise exception using errcode='P0002',message='ATLAS_RELEASE_PIPELINE_NOT_FOUND'; end if;
  select * into release_row from public.atlas_releases where pipeline_id=p_pipeline_id and external_id=p_external_release_id for update;
  if not found then
    release_row:=jsonb_populate_record(null::public.atlas_releases,public.create_atlas_release(p_pipeline_id,gen_random_uuid()::text,p_external_release_id,coalesce(nullif(p_release_name,''),p_external_release_id),p_version,p_commit_sha,null,p_actor));
  else
    update public.atlas_releases set name=coalesce(nullif(p_release_name,''),name),version=coalesce(p_version,version),commit_sha=coalesce(p_commit_sha,commit_sha),updated_by=p_actor,updated_at=timezone('utc',now()) where id=release_row.id returning * into release_row;
  end if;
  if p_stage_key is not null then
    select * into stage_row from public.atlas_release_stages where pipeline_id=p_pipeline_id and stage_key=p_stage_key and status='active'; if not found then raise exception using errcode='P0002',message='ATLAS_RELEASE_STAGE_NOT_FOUND'; end if;
    select * into run_row from public.atlas_release_stage_runs where release_id=release_row.id and stage_id=stage_row.id for update; if not found then raise exception using errcode='P0002',message='ATLAS_RELEASE_STAGE_RUN_NOT_FOUND'; end if;
  end if;
  for action_value in select value from jsonb_array_elements(coalesce(p_action_ids,'[]'::jsonb)) loop
    action_id_value:=action_value#>>'{}';
    if not exists(select 1 from public.atlas_actions action where action.id=action_id_value and action.status<>'archived') then unknown_ids:=unknown_ids||jsonb_build_array(action_id_value);
    elsif run_row.id is not null and run_row.frozen_at is not null and not exists(select 1 from public.atlas_release_actions association where association.release_id=release_row.id and association.action_id=action_id_value and association.status='active') then frozen_ids:=frozen_ids||jsonb_build_array(action_id_value);
    else perform public.set_atlas_release_action(release_row.id,action_id_value,run_row.id,true,'ci',p_actor); associated_ids:=associated_ids||jsonb_build_array(action_id_value);
    end if;
  end loop;
  if p_event_type='stage_started' then run_row:=jsonb_populate_record(null::public.atlas_release_stage_runs,public.transition_atlas_release_stage(run_row.id,'started',p_commit_sha,p_payload->>'external_url',p_actor,run_row.revision));
  elsif p_event_type='stage_completed' then run_row:=jsonb_populate_record(null::public.atlas_release_stage_runs,public.transition_atlas_release_stage(run_row.id,'completed',p_commit_sha,p_payload->>'external_url',p_actor,run_row.revision));
  elsif p_event_type='stage_failed' then run_row:=jsonb_populate_record(null::public.atlas_release_stage_runs,public.transition_atlas_release_stage(run_row.id,'failed',p_commit_sha,p_payload->>'external_url',p_actor,run_row.revision));
  elsif p_event_type='release_completed' then release_row:=jsonb_populate_record(null::public.atlas_releases,public.transition_atlas_release(release_row.id,'completed',p_payload->>'notes',p_actor,release_row.revision));
  elsif p_event_type='release_failed' then release_row:=jsonb_populate_record(null::public.atlas_releases,public.transition_atlas_release(release_row.id,'failed',p_payload->>'notes',p_actor,release_row.revision));
  end if;
  result:=jsonb_build_object('pipeline_id',p_pipeline_id,'release_id',release_row.id,'release_status',release_row.status,'stage_run_id',run_row.id,'stage_status',run_row.status,'associated_action_ids',associated_ids,'unknown_action_ids',unknown_ids,'frozen_action_ids',frozen_ids,'replay',false);
  insert into public.atlas_release_events(id,pipeline_id,event_key,event_type,release_id,external_release_id,commit_sha,occurred_at,payload,processing_result,actor)
  values(gen_random_uuid()::text,p_pipeline_id,p_event_key,p_event_type,release_row.id,p_external_release_id,p_commit_sha,coalesce(p_occurred_at,timezone('utc',now())),coalesce(p_payload,'{}'::jsonb),result,p_actor) returning * into event_row;
  return result||jsonb_build_object('event_id',event_row.id);
end $function$;

revoke all on function public.create_atlas_release(text,text,text,text,text,text,timestamptz,text) from public;
revoke all on function public.set_atlas_release_action(text,text,text,boolean,text,text) from public;
revoke all on function public.transition_atlas_release_stage(text,text,text,text,text,bigint) from public;
revoke all on function public.generate_atlas_release_notes(text,text) from public;
revoke all on function public.transition_atlas_release(text,text,text,text,bigint) from public;
revoke all on function public.restore_atlas_release(text,text,bigint) from public;
revoke all on function public.rotate_atlas_release_access_key(text,text,text,text,bigint) from public;
revoke all on function public.ingest_atlas_release_event(text,text,text,text,text,text,text,text,jsonb,timestamptz,jsonb,text) from public;

drop trigger if exists atlas_release_pipelines_reject_delete on public.atlas_release_pipelines;
create trigger atlas_release_pipelines_reject_delete before delete on public.atlas_release_pipelines for each row execute function public.atlas_reject_immutable_delete();
drop trigger if exists atlas_release_stages_reject_delete on public.atlas_release_stages;
create trigger atlas_release_stages_reject_delete before delete on public.atlas_release_stages for each row execute function public.atlas_reject_immutable_delete();
drop trigger if exists atlas_releases_reject_delete on public.atlas_releases;
create trigger atlas_releases_reject_delete before delete on public.atlas_releases for each row execute function public.atlas_reject_immutable_delete();
drop trigger if exists atlas_release_stage_runs_reject_delete on public.atlas_release_stage_runs;
create trigger atlas_release_stage_runs_reject_delete before delete on public.atlas_release_stage_runs for each row execute function public.atlas_reject_immutable_delete();
drop trigger if exists atlas_release_actions_reject_delete on public.atlas_release_actions;
create trigger atlas_release_actions_reject_delete before delete on public.atlas_release_actions for each row execute function public.atlas_reject_immutable_delete();
drop trigger if exists atlas_release_events_reject_mutation on public.atlas_release_events;
create trigger atlas_release_events_reject_mutation before update or delete on public.atlas_release_events for each row execute function public.atlas_reject_project_history_mutation();
drop trigger if exists atlas_release_activity_reject_mutation on public.atlas_release_activity_log;
create trigger atlas_release_activity_reject_mutation before update or delete on public.atlas_release_activity_log for each row execute function public.atlas_reject_project_history_mutation();

alter table public.atlas_release_pipelines enable row level security;
alter table public.atlas_release_stages enable row level security;
alter table public.atlas_releases enable row level security;
alter table public.atlas_release_stage_runs enable row level security;
alter table public.atlas_release_actions enable row level security;
alter table public.atlas_release_events enable row level security;
alter table public.atlas_release_activity_log enable row level security;
revoke all on table public.atlas_release_pipelines,public.atlas_release_stages,public.atlas_releases,public.atlas_release_stage_runs,public.atlas_release_actions,public.atlas_release_events,public.atlas_release_activity_log from public;

do $migration$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on table public.atlas_release_pipelines,public.atlas_release_stages,public.atlas_releases,public.atlas_release_stage_runs,public.atlas_release_actions,public.atlas_release_events,public.atlas_release_activity_log from %I',role_name);
    end if;
  end loop;
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant select,insert,update on public.atlas_release_pipelines,public.atlas_release_stages,public.atlas_releases,public.atlas_release_stage_runs,public.atlas_release_actions to service_role;
    grant select,insert on public.atlas_release_events,public.atlas_release_activity_log to service_role;
    grant usage,select on sequence public.atlas_release_activity_log_id_seq to service_role;
    revoke delete,truncate on public.atlas_release_pipelines,public.atlas_release_stages,public.atlas_releases,public.atlas_release_stage_runs,public.atlas_release_actions,public.atlas_release_events,public.atlas_release_activity_log from service_role;
    revoke update on public.atlas_release_events,public.atlas_release_activity_log from service_role;
    grant execute on function public.create_atlas_release(text,text,text,text,text,text,timestamptz,text) to service_role;
    grant execute on function public.set_atlas_release_action(text,text,text,boolean,text,text) to service_role;
    grant execute on function public.transition_atlas_release_stage(text,text,text,text,text,bigint) to service_role;
    grant execute on function public.generate_atlas_release_notes(text,text) to service_role;
    grant execute on function public.transition_atlas_release(text,text,text,text,bigint) to service_role;
    grant execute on function public.restore_atlas_release(text,text,bigint) to service_role;
    grant execute on function public.rotate_atlas_release_access_key(text,text,text,text,bigint) to service_role;
    grant execute on function public.ingest_atlas_release_event(text,text,text,text,text,text,text,text,jsonb,timestamptz,jsonb,text) to service_role;
  end if;
end $migration$;

comment on table public.atlas_release_pipelines is 'Continuous or scheduled delivery pipelines with hashed CI access keys and owner configuration.';
comment on table public.atlas_release_events is 'Immutable idempotent CI release event ledger and processing result.';
