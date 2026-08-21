-- Linear parity slice 2: parent/sub-actions, typed action relations, duplicate
-- resolution, estimate configuration, and transactional hierarchy mutations.
-- Forward-only. Relations and hierarchy evidence are archived, never deleted.

alter table public.atlas_actions
  add column if not exists parent_action_id text,
  add column if not exists resolution text,
  add column if not exists duplicate_of_id text;

update public.atlas_actions
set resolution = case
  when lower(coalesce(status, '')) in ('cancelled', 'canceled') then 'canceled'
  when lower(coalesce(status, '')) in ('done', 'completed', 'closed') then 'completed'
  else resolution
end
where resolution is null
  and lower(coalesce(status, '')) in ('done', 'completed', 'closed', 'cancelled', 'canceled');

do $migration$
begin
  if not exists (select 1 from pg_constraint where conname = 'atlas_actions_parent_action_id_fkey') then
    alter table public.atlas_actions
      add constraint atlas_actions_parent_action_id_fkey
      foreign key (parent_action_id) references public.atlas_actions(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'atlas_actions_duplicate_of_id_fkey') then
    alter table public.atlas_actions
      add constraint atlas_actions_duplicate_of_id_fkey
      foreign key (duplicate_of_id) references public.atlas_actions(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'atlas_actions_parent_not_self_check') then
    alter table public.atlas_actions
      add constraint atlas_actions_parent_not_self_check
      check (parent_action_id is null or parent_action_id <> id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'atlas_actions_duplicate_not_self_check') then
    alter table public.atlas_actions
      add constraint atlas_actions_duplicate_not_self_check
      check (duplicate_of_id is null or duplicate_of_id <> id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'atlas_actions_resolution_check') then
    alter table public.atlas_actions
      add constraint atlas_actions_resolution_check
      check (resolution is null or resolution in ('completed', 'canceled', 'duplicate'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'atlas_actions_duplicate_resolution_check') then
    alter table public.atlas_actions
      add constraint atlas_actions_duplicate_resolution_check
      check (
        (resolution = 'duplicate' and duplicate_of_id is not null)
        or (resolution is distinct from 'duplicate' and duplicate_of_id is null)
      );
  end if;
end
$migration$;

create index if not exists atlas_actions_parent_status_idx
  on public.atlas_actions (parent_action_id, status);
create index if not exists atlas_actions_duplicate_of_idx
  on public.atlas_actions (duplicate_of_id)
  where duplicate_of_id is not null;

create table if not exists public.atlas_action_relations (
  id text primary key,
  source_action_id text not null references public.atlas_actions(id) on delete restrict,
  target_action_id text not null references public.atlas_actions(id) on delete restrict,
  relation_type text not null check (relation_type in ('related', 'blocks', 'duplicate')),
  status text not null default 'active' check (status in ('active', 'resolved', 'archived')),
  note text not null default '',
  revision bigint not null default 0 check (revision >= 0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (source_action_id <> target_action_id),
  check (relation_type <> 'related' or source_action_id < target_action_id)
);

create unique index if not exists atlas_action_relations_active_edge_idx
  on public.atlas_action_relations (source_action_id, target_action_id, relation_type)
  where status = 'active';
create unique index if not exists atlas_action_relations_active_duplicate_source_idx
  on public.atlas_action_relations (source_action_id)
  where status = 'active' and relation_type = 'duplicate';
create index if not exists atlas_action_relations_source_idx
  on public.atlas_action_relations (source_action_id, status, relation_type);
create index if not exists atlas_action_relations_target_idx
  on public.atlas_action_relations (target_action_id, status, relation_type);

create or replace function public.atlas_validate_action_hierarchy()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  parent_status text;
  cycle_found boolean;
begin
  if new.parent_action_id is null then return new; end if;
  if new.parent_action_id = new.id then
    raise exception using errcode = '23514', message = 'ATLAS_ACTION_PARENT_SELF';
  end if;

  select status into parent_status
    from public.atlas_actions
   where id = new.parent_action_id;
  if not found then
    raise exception using errcode = '23503', message = 'ATLAS_ACTION_PARENT_NOT_FOUND';
  end if;
  if parent_status = 'archived' then
    raise exception using errcode = '23514', message = 'ATLAS_ACTION_PARENT_ARCHIVED';
  end if;

  with recursive ancestors(id, parent_action_id) as (
    select action.id, action.parent_action_id
      from public.atlas_actions action
     where action.id = new.parent_action_id
    union all
    select action.id, action.parent_action_id
      from public.atlas_actions action
      join ancestors on action.id = ancestors.parent_action_id
  )
  select exists(select 1 from ancestors where id = new.id) into cycle_found;

  if cycle_found then
    raise exception using errcode = '23514', message = 'ATLAS_ACTION_HIERARCHY_CYCLE';
  end if;
  return new;
end
$function$;

create or replace function public.atlas_validate_action_resolution()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.status in ('done', 'completed', 'closed') and new.resolution is null then
    new.resolution := 'completed';
  elsif new.status in ('cancelled', 'canceled') and new.resolution is null then
    new.resolution := 'canceled';
  end if;

  if new.resolution = 'duplicate' and (new.duplicate_of_id is null or new.status not in ('done', 'completed', 'closed', 'archived')) then
    raise exception using errcode = '23514', message = 'ATLAS_DUPLICATE_RESOLUTION_INVALID';
  end if;
  if new.resolution is distinct from 'duplicate' and new.duplicate_of_id is not null then
    raise exception using errcode = '23514', message = 'ATLAS_DUPLICATE_CANONICAL_WITHOUT_RESOLUTION';
  end if;
  if new.status in ('not_started', 'in_progress', 'waiting', 'blocked', 'todo', 'open') and new.resolution is not null then
    raise exception using errcode = '23514', message = 'ATLAS_ACTIVE_ACTION_HAS_RESOLUTION';
  end if;
  if tg_op = 'UPDATE'
     and old.resolution = 'duplicate'
     and new.resolution = 'duplicate'
     and new.status in ('done', 'completed', 'closed')
     and new.evidence_json is distinct from old.evidence_json
  then
    raise exception using errcode = '23514', message = 'ATLAS_DUPLICATE_ACTION_COMPLETION_FORBIDDEN';
  end if;
  return new;
end
$function$;

revoke all on function public.atlas_validate_action_hierarchy() from public;
revoke all on function public.atlas_validate_action_resolution() from public;

drop trigger if exists atlas_actions_validate_hierarchy on public.atlas_actions;
create trigger atlas_actions_validate_hierarchy
before insert or update of parent_action_id on public.atlas_actions
for each row execute function public.atlas_validate_action_hierarchy();

drop trigger if exists atlas_actions_validate_resolution on public.atlas_actions;
create trigger atlas_actions_validate_resolution
before insert or update of status, resolution, duplicate_of_id, evidence_json on public.atlas_actions
for each row execute function public.atlas_validate_action_resolution();

create or replace function public.atlas_audit_action_relation()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  event_name text;
  actor_name text;
begin
  event_name := case
    when tg_op = 'INSERT' then 'relation_created'
    when new.status = 'resolved' and old.status = 'active' then 'relation_resolved'
    when new.status = 'archived' and old.status <> 'archived' then 'relation_archived'
    when new.relation_type is distinct from old.relation_type then 'relation_changed'
    else 'relation_updated'
  end;
  actor_name := case when tg_op = 'INSERT' then new.created_by else new.updated_by end;

  insert into public.atlas_activity_log (action_id, event, old_value, new_value, actor)
  values (
    new.source_action_id,
    event_name,
    case when tg_op = 'INSERT' then null else to_jsonb(old)::text end,
    to_jsonb(new)::text,
    actor_name
  );
  insert into public.atlas_activity_log (action_id, event, old_value, new_value, actor)
  values (
    new.target_action_id,
    event_name,
    case when tg_op = 'INSERT' then null else to_jsonb(old)::text end,
    to_jsonb(new)::text,
    actor_name
  );
  return new;
end
$function$;

create or replace function public.atlas_sync_relation_blocked_by()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE'
     and old.relation_type = 'blocks'
     and old.status = 'active'
     and (
       new.relation_type <> 'blocks' or new.status <> 'active'
       or new.source_action_id <> old.source_action_id
       or new.target_action_id <> old.target_action_id
     )
     and not exists (
       select 1 from public.atlas_action_relations relation
        where relation.id <> new.id
          and relation.source_action_id = old.source_action_id
          and relation.target_action_id = old.target_action_id
          and relation.relation_type = 'blocks'
          and relation.status = 'active'
     )
  then
    update public.atlas_actions action
       set blocked_by = coalesce((
         select jsonb_agg(blocker.value order by blocker.ordinality)
           from jsonb_array_elements_text(coalesce(action.blocked_by, '[]'::jsonb)) with ordinality blocker(value, ordinality)
          where blocker.value <> old.source_action_id
       ), '[]'::jsonb),
       updated_at = timezone('utc', now())
     where action.id = old.target_action_id;
  end if;

  if new.relation_type = 'blocks' and new.status = 'active' then
    update public.atlas_actions action
       set blocked_by = case
         when coalesce(action.blocked_by, '[]'::jsonb) @> jsonb_build_array(new.source_action_id)
           then coalesce(action.blocked_by, '[]'::jsonb)
         else coalesce(action.blocked_by, '[]'::jsonb) || jsonb_build_array(new.source_action_id)
       end,
       updated_at = timezone('utc', now())
     where action.id = new.target_action_id;
  end if;
  return new;
end
$function$;

revoke all on function public.atlas_audit_action_relation() from public;
revoke all on function public.atlas_sync_relation_blocked_by() from public;

drop trigger if exists atlas_action_relations_audit on public.atlas_action_relations;
create trigger atlas_action_relations_audit
after insert or update on public.atlas_action_relations
for each row execute function public.atlas_audit_action_relation();

drop trigger if exists atlas_action_relations_sync_blocked_by on public.atlas_action_relations;
create trigger atlas_action_relations_sync_blocked_by
after insert or update on public.atlas_action_relations
for each row execute function public.atlas_sync_relation_blocked_by();

create or replace function public.set_atlas_action_parent(
  p_action_id text,
  p_parent_action_id text,
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
  previous_parent text;
  server_timestamp timestamptz := timezone('utc', now());
begin
  if p_actor not in ('ransomed', 'codex', 'claude') then
    raise exception using errcode = '22023', message = 'ATLAS_ACTOR_NOT_ALLOWED';
  end if;
  select * into action_row from public.atlas_actions where id = p_action_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ATLAS_ACTION_NOT_FOUND'; end if;
  if action_row.status = 'archived' then raise exception using errcode = '55000', message = 'ATLAS_ACTION_ARCHIVED'; end if;
  if p_expected_revision is not null and action_row.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'ATLAS_REVISION_CONFLICT';
  end if;
  previous_parent := action_row.parent_action_id;

  update public.atlas_actions
     set parent_action_id = p_parent_action_id,
         revision = revision + 1,
         updated_at = server_timestamp
   where id = p_action_id
  returning * into action_row;

  insert into public.atlas_activity_log (action_id, event, old_value, new_value, actor, created_at)
  values (
    p_action_id,
    case when p_parent_action_id is null then 'parent_removed' else 'parent_changed' end,
    previous_parent,
    jsonb_build_object('parent_action_id', p_parent_action_id, 'revision', action_row.revision)::text,
    p_actor,
    server_timestamp
  );
  if p_parent_action_id is not null then
    insert into public.atlas_activity_log (action_id, event, old_value, new_value, actor, created_at)
    values (p_parent_action_id, 'sub_action_attached', previous_parent, p_action_id, p_actor, server_timestamp);
  end if;
  return to_jsonb(action_row);
end
$function$;

create or replace function public.create_atlas_sub_action(
  p_parent_action_id text,
  p_child_action_id text,
  p_title text,
  p_description text,
  p_due_date date,
  p_actor text,
  p_expected_parent_revision bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  parent_row public.atlas_actions%rowtype;
  child_row public.atlas_actions%rowtype;
  server_timestamp timestamptz := timezone('utc', now());
begin
  if p_actor not in ('ransomed', 'codex', 'claude') then
    raise exception using errcode = '22023', message = 'ATLAS_ACTOR_NOT_ALLOWED';
  end if;
  if nullif(btrim(p_title), '') is null then
    raise exception using errcode = '22023', message = 'ATLAS_SUB_ACTION_TITLE_REQUIRED';
  end if;
  select * into parent_row from public.atlas_actions where id = p_parent_action_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ATLAS_ACTION_NOT_FOUND'; end if;
  if parent_row.status = 'archived' then raise exception using errcode = '55000', message = 'ATLAS_ACTION_ARCHIVED'; end if;
  if p_expected_parent_revision is not null and parent_row.revision <> p_expected_parent_revision then
    raise exception using errcode = '40001', message = 'ATLAS_REVISION_CONFLICT';
  end if;

  insert into public.atlas_actions (
    id, title, description, status, business, priority, due_date, owners,
    tags, notes, recurrence, work_mode, project_id, project_milestone_id,
    parent_action_id, approval_state, created_at, updated_at
  ) values (
    p_child_action_id, btrim(p_title), coalesce(p_description, ''), 'not_started',
    parent_row.business, parent_row.priority, p_due_date, parent_row.owners,
    '[]'::jsonb, '', 'none', parent_row.work_mode, parent_row.project_id,
    parent_row.project_milestone_id, p_parent_action_id, 'not_required',
    server_timestamp, server_timestamp
  ) returning * into child_row;

  insert into public.atlas_activity_log (action_id, event, old_value, new_value, actor, created_at)
  values (p_child_action_id, 'created', null, child_row.title, p_actor, server_timestamp);
  insert into public.atlas_activity_log (action_id, event, old_value, new_value, actor, created_at)
  values (p_parent_action_id, 'sub_action_created', null, p_child_action_id, p_actor, server_timestamp);
  return to_jsonb(child_row);
end
$function$;

create or replace function public.mark_atlas_action_duplicate(
  p_action_id text,
  p_canonical_action_id text,
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
  canonical_row public.atlas_actions%rowtype;
  relation_row public.atlas_action_relations%rowtype;
  server_timestamp timestamptz := timezone('utc', now());
  duplicate_evidence jsonb;
begin
  if p_actor not in ('ransomed', 'codex', 'claude') then
    raise exception using errcode = '22023', message = 'ATLAS_ACTOR_NOT_ALLOWED';
  end if;
  if p_action_id = p_canonical_action_id then
    raise exception using errcode = '22023', message = 'ATLAS_DUPLICATE_SELF';
  end if;
  perform 1 from public.atlas_actions
   where id in (p_action_id, p_canonical_action_id)
   order by id
   for update;
  select * into action_row from public.atlas_actions where id = p_action_id;
  select * into canonical_row from public.atlas_actions where id = p_canonical_action_id;
  if action_row.id is null or canonical_row.id is null then
    raise exception using errcode = 'P0002', message = 'ATLAS_ACTION_NOT_FOUND';
  end if;
  if action_row.status = 'archived' or canonical_row.status = 'archived' then
    raise exception using errcode = '55000', message = 'ATLAS_ACTION_ARCHIVED';
  end if;
  if canonical_row.resolution = 'duplicate' then
    raise exception using errcode = '22023', message = 'ATLAS_DUPLICATE_CANONICAL_IS_DUPLICATE';
  end if;
  if p_expected_revision is not null and action_row.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'ATLAS_REVISION_CONFLICT';
  end if;
  if action_row.resolution = 'duplicate' then
    if action_row.duplicate_of_id = p_canonical_action_id then return to_jsonb(action_row); end if;
    raise exception using errcode = '22023', message = 'ATLAS_ACTION_ALREADY_DUPLICATE';
  end if;

  duplicate_evidence := jsonb_build_object(
    'version', 2,
    'kind', 'duplicate_resolution',
    'summary', format('Marked duplicate of %s: %s', canonical_row.id, canonical_row.title),
    'sources', jsonb_build_array(jsonb_build_object('type', 'atlas_action', 'id', canonical_row.id)),
    'verification', jsonb_build_object('status', 'resolved')
  );

  insert into public.atlas_action_relations (
    id, source_action_id, target_action_id, relation_type, status, note,
    created_by, updated_by
  ) values (
    gen_random_uuid()::text, p_action_id, p_canonical_action_id, 'duplicate',
    'active', '', p_actor, p_actor
  ) returning * into relation_row;

  update public.atlas_actions
     set status = 'done',
         resolution = 'duplicate',
         duplicate_of_id = p_canonical_action_id,
         evidence_json = duplicate_evidence,
         completed_at = server_timestamp,
         revision = revision + 1,
         updated_at = server_timestamp
   where id = p_action_id
  returning * into action_row;

  insert into public.atlas_activity_log (action_id, event, old_value, new_value, actor, created_at)
  values (
    p_action_id, 'duplicate_resolved', null,
    jsonb_build_object('canonical_action_id', p_canonical_action_id, 'relation_id', relation_row.id, 'revision', action_row.revision)::text,
    p_actor, server_timestamp
  );
  return to_jsonb(action_row);
end
$function$;

create or replace function public.restore_atlas_duplicate_action(
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
  server_timestamp timestamptz := timezone('utc', now());
begin
  if p_actor <> 'ransomed' then
    raise exception using errcode = '42501', message = 'ATLAS_OWNER_REQUIRED';
  end if;
  select * into action_row from public.atlas_actions where id = p_action_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ATLAS_ACTION_NOT_FOUND'; end if;
  if action_row.resolution <> 'duplicate' then
    raise exception using errcode = '22023', message = 'ATLAS_ACTION_NOT_DUPLICATE';
  end if;
  if p_expected_revision is not null and action_row.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'ATLAS_REVISION_CONFLICT';
  end if;

  update public.atlas_action_relations
     set status = 'archived', revision = revision + 1, updated_by = p_actor, updated_at = server_timestamp
   where source_action_id = p_action_id and relation_type = 'duplicate' and status = 'active';
  update public.atlas_actions
     set status = 'not_started', resolution = null, duplicate_of_id = null,
         evidence_json = '{}'::jsonb, completed_at = null,
         revision = revision + 1, updated_at = server_timestamp
   where id = p_action_id
  returning * into action_row;
  insert into public.atlas_activity_log (action_id, event, old_value, new_value, actor, created_at)
  values (p_action_id, 'duplicate_restored', 'duplicate', jsonb_build_object('status', 'not_started', 'revision', action_row.revision)::text, p_actor, server_timestamp);
  return to_jsonb(action_row);
end
$function$;

create or replace function public.atlas_reclassify_completed_block_relations()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  relation_row public.atlas_action_relations%rowtype;
  canonical_source text;
  canonical_target text;
begin
  if new.status not in ('done', 'completed', 'closed')
     or old.status in ('done', 'completed', 'closed')
  then return new;
  end if;

  for relation_row in
    select * from public.atlas_action_relations
     where source_action_id = new.id and relation_type = 'blocks' and status = 'active'
     for update
  loop
    canonical_source := least(relation_row.source_action_id, relation_row.target_action_id);
    canonical_target := greatest(relation_row.source_action_id, relation_row.target_action_id);
    if exists (
      select 1 from public.atlas_action_relations
       where source_action_id = canonical_source and target_action_id = canonical_target
         and relation_type = 'related' and status = 'active'
    ) then
      update public.atlas_action_relations
         set status = 'resolved', revision = revision + 1,
             updated_by = 'system', updated_at = timezone('utc', now())
       where id = relation_row.id;
    else
      update public.atlas_action_relations
         set relation_type = 'related', source_action_id = canonical_source,
             target_action_id = canonical_target, revision = revision + 1,
             updated_by = 'system', updated_at = timezone('utc', now())
       where id = relation_row.id;
    end if;
  end loop;
  return new;
end
$function$;

revoke all on function public.set_atlas_action_parent(text, text, text, bigint) from public;
revoke all on function public.create_atlas_sub_action(text, text, text, text, date, text, bigint) from public;
revoke all on function public.mark_atlas_action_duplicate(text, text, text, bigint) from public;
revoke all on function public.restore_atlas_duplicate_action(text, text, bigint) from public;
revoke all on function public.atlas_reclassify_completed_block_relations() from public;

drop trigger if exists atlas_actions_reclassify_completed_blocks on public.atlas_actions;
create trigger atlas_actions_reclassify_completed_blocks
after update of status on public.atlas_actions
for each row execute function public.atlas_reclassify_completed_block_relations();

-- Preserve legacy blocked_by edges in the structured graph.
insert into public.atlas_action_relations (
  id, source_action_id, target_action_id, relation_type, status, note,
  created_by, updated_by
)
select
  gen_random_uuid()::text,
  case when blocker.status in ('done', 'completed', 'closed') then least(blocker.id, blocked.id) else blocker.id end,
  case when blocker.status in ('done', 'completed', 'closed') then greatest(blocker.id, blocked.id) else blocked.id end,
  case when blocker.status in ('done', 'completed', 'closed') then 'related' else 'blocks' end,
  'active',
  'Migrated from atlas_actions.blocked_by',
  'migration',
  'migration'
from public.atlas_actions blocked
cross join lateral jsonb_array_elements_text(
  case when jsonb_typeof(blocked.blocked_by) = 'array' then blocked.blocked_by else '[]'::jsonb end
) dependency(blocker_id)
join public.atlas_actions blocker on blocker.id = dependency.blocker_id
where blocker.id <> blocked.id
on conflict do nothing;

insert into public.atlas_config (key, value)
values (
  'estimate_settings',
  '{"enabled":true,"scale":"fibonacci","extended":false,"allow_zero":true,"unestimated_value":1}'::jsonb
)
on conflict (key) do nothing;

alter table public.atlas_action_relations enable row level security;
revoke all on table public.atlas_action_relations from public;

drop trigger if exists atlas_action_relations_reject_delete on public.atlas_action_relations;
create trigger atlas_action_relations_reject_delete
before delete on public.atlas_action_relations
for each row execute function public.atlas_reject_immutable_delete();

do $migration$
declare
  role_name text;
  function_signature text;
begin
  foreach role_name in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on table public.atlas_action_relations from %I', role_name);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on table public.atlas_action_relations to service_role;
    revoke delete, truncate on table public.atlas_action_relations from service_role;
  end if;

  foreach function_signature in array array[
    'public.set_atlas_action_parent(text,text,text,bigint)',
    'public.create_atlas_sub_action(text,text,text,text,date,text,bigint)',
    'public.mark_atlas_action_duplicate(text,text,text,bigint)',
    'public.restore_atlas_duplicate_action(text,text,bigint)'
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

comment on table public.atlas_action_relations is
  'Typed, revisioned, non-deletable relations between ATLAS actions.';
comment on function public.mark_atlas_action_duplicate(text, text, text, bigint) is
  'Atomically resolves an action as a duplicate of a canonical action with typed evidence and audit history.';
