-- Linear parity slice 9: business-scoped workflows, Triage, deterministic
-- workflow rules, and receipt-backed inactivity policies.
-- Forward-only. Configuration and history are archived, never deleted.

create table if not exists public.atlas_workflows (
  id uuid primary key default gen_random_uuid(),
  business text,
  name text not null,
  description text not null default '',
  revision bigint not null default 0 check (revision >= 0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  check (length(btrim(name)) between 1 and 120),
  check (length(description) <= 2000)
);

create unique index if not exists atlas_workflows_active_scope_idx
  on public.atlas_workflows ((coalesce(business, '__workspace__')))
  where archived_at is null;
create index if not exists atlas_workflows_business_idx
  on public.atlas_workflows (business, archived_at);

create table if not exists public.atlas_workflow_statuses (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.atlas_workflows(id) on delete restrict,
  status_key text not null,
  name text not null,
  description text not null default '',
  color text not null default '#71717a',
  category text not null check (category in (
    'triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled', 'duplicate'
  )),
  legacy_status text not null check (legacy_status in (
    'not_started', 'in_progress', 'waiting', 'blocked', 'done', 'completed',
    'closed', 'cancelled', 'canceled', 'todo', 'open'
  )),
  position integer not null default 0 check (position between 0 and 1000),
  is_default boolean not null default false,
  is_system boolean not null default false,
  revision bigint not null default 0 check (revision >= 0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  check (status_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  check (length(btrim(name)) between 1 and 80),
  check (length(description) <= 1000),
  check (color ~ '^#[0-9A-Fa-f]{6}$'),
  check (not is_system or category = 'duplicate')
);

create unique index if not exists atlas_workflow_statuses_active_key_idx
  on public.atlas_workflow_statuses (workflow_id, status_key)
  where archived_at is null;
create unique index if not exists atlas_workflow_statuses_active_name_idx
  on public.atlas_workflow_statuses (workflow_id, lower(name))
  where archived_at is null;
create unique index if not exists atlas_workflow_statuses_default_idx
  on public.atlas_workflow_statuses (workflow_id)
  where is_default and archived_at is null;
create unique index if not exists atlas_workflow_statuses_duplicate_idx
  on public.atlas_workflow_statuses (workflow_id)
  where category = 'duplicate' and archived_at is null;
create index if not exists atlas_workflow_statuses_order_idx
  on public.atlas_workflow_statuses (workflow_id, category, position)
  where archived_at is null;

create table if not exists public.atlas_triage_settings (
  workflow_id uuid primary key references public.atlas_workflows(id) on delete restrict,
  enabled boolean not null default false,
  require_priority boolean not null default false,
  responsible_member_ids jsonb not null default '[]'::jsonb,
  default_accept_status_id uuid references public.atlas_workflow_statuses(id) on delete restrict,
  auto_close_days integer check (auto_close_days is null or auto_close_days between 1 and 3650),
  auto_archive_days integer check (auto_archive_days is null or auto_archive_days between 1 and 3650),
  auto_close_categories jsonb not null default '["backlog","unstarted"]'::jsonb,
  revision bigint not null default 0 check (revision >= 0),
  updated_by text not null,
  updated_at timestamptz not null default timezone('utc', now()),
  check (jsonb_typeof(responsible_member_ids) = 'array'),
  check (jsonb_typeof(auto_close_categories) = 'array')
);

alter table public.atlas_actions
  add column if not exists workflow_status_id uuid;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'atlas_actions_workflow_status_id_fkey'
  ) then
    alter table public.atlas_actions
      add constraint atlas_actions_workflow_status_id_fkey
      foreign key (workflow_status_id)
      references public.atlas_workflow_statuses(id)
      on delete restrict;
  end if;
end
$migration$;

create index if not exists atlas_actions_workflow_status_idx
  on public.atlas_actions (workflow_status_id, updated_at desc);

create table if not exists public.atlas_triage_entries (
  id uuid primary key default gen_random_uuid(),
  action_id text not null unique references public.atlas_actions(id) on delete restrict,
  workflow_id uuid not null references public.atlas_workflows(id) on delete restrict,
  state text not null default 'pending' check (state in (
    'pending', 'accepted', 'declined', 'duplicate', 'snoozed', 'archived'
  )),
  source_type text not null default 'manual' check (source_type in (
    'manual', 'integration', 'external_member', 'email', 'transcript', 'webhook', 'import'
  )),
  source_ref text,
  snoozed_until timestamptz,
  decision_reason text not null default '',
  decision_by text,
  canonical_action_id text references public.atlas_actions(id) on delete restrict,
  last_activity_at timestamptz not null default timezone('utc', now()),
  revision bigint not null default 0 check (revision >= 0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (length(coalesce(source_ref, '')) <= 500),
  check (length(decision_reason) <= 2000),
  check ((state = 'snoozed') = (snoozed_until is not null)),
  check ((state = 'duplicate') = (canonical_action_id is not null))
);

create index if not exists atlas_triage_entries_queue_idx
  on public.atlas_triage_entries (workflow_id, state, snoozed_until, created_at);

create table if not exists public.atlas_triage_events (
  id uuid primary key default gen_random_uuid(),
  triage_entry_id uuid not null references public.atlas_triage_entries(id) on delete restrict,
  action_id text not null references public.atlas_actions(id) on delete restrict,
  event text not null check (event in (
    'entered', 'accepted', 'declined', 'duplicate', 'snoozed', 'unsnoozed', 'archived'
  )),
  old_value jsonb,
  new_value jsonb,
  actor text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists atlas_triage_events_entry_idx
  on public.atlas_triage_events (triage_entry_id, created_at desc);

create table if not exists public.atlas_workflow_rules (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.atlas_workflows(id) on delete restrict,
  name text not null,
  description text not null default '',
  trigger_type text not null check (trigger_type in (
    'triage_entered', 'action_created', 'action_updated', 'status_changed',
    'priority_changed', 'manual'
  )),
  conditions jsonb not null default '{"mode":"all","items":[]}'::jsonb,
  effects jsonb not null default '{}'::jsonb,
  position integer not null default 0 check (position between 0 and 1000),
  enabled boolean not null default false,
  revision bigint not null default 0 check (revision >= 0),
  created_by text not null,
  updated_by text not null,
  activated_by text,
  activated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  check (length(btrim(name)) between 1 and 120),
  check (length(description) <= 2000),
  check (jsonb_typeof(conditions) = 'object'),
  check (jsonb_typeof(effects) = 'object'),
  check ((enabled and activated_at is not null and activated_by is not null) or not enabled)
);

create unique index if not exists atlas_workflow_rules_active_name_idx
  on public.atlas_workflow_rules (workflow_id, lower(name))
  where archived_at is null;
create index if not exists atlas_workflow_rules_execution_idx
  on public.atlas_workflow_rules (workflow_id, trigger_type, enabled, position)
  where archived_at is null;

create table if not exists public.atlas_workflow_rule_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.atlas_workflows(id) on delete restrict,
  action_id text not null references public.atlas_actions(id) on delete restrict,
  event_key text not null,
  trigger_type text not null,
  matched_rule_ids jsonb not null default '[]'::jsonb,
  proposed_effects jsonb not null default '{}'::jsonb,
  applied_effects jsonb not null default '{}'::jsonb,
  conflicts jsonb not null default '[]'::jsonb,
  status text not null check (status in ('previewed', 'applied', 'no_match', 'conflicted')),
  dry_run boolean not null default true,
  actor text not null,
  created_at timestamptz not null default timezone('utc', now()),
  check (length(event_key) between 1 and 250),
  check (jsonb_typeof(matched_rule_ids) = 'array'),
  check (jsonb_typeof(proposed_effects) = 'object'),
  check (jsonb_typeof(applied_effects) = 'object'),
  check (jsonb_typeof(conflicts) = 'array')
);

create unique index if not exists atlas_workflow_rule_runs_applied_event_idx
  on public.atlas_workflow_rule_runs (workflow_id, event_key)
  where not dry_run;
create index if not exists atlas_workflow_rule_runs_action_idx
  on public.atlas_workflow_rule_runs (action_id, created_at desc);

create table if not exists public.atlas_inactivity_policy_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.atlas_workflows(id) on delete restrict,
  run_key text not null unique,
  dry_run boolean not null default true,
  as_of timestamptz not null,
  candidate_action_ids jsonb not null default '[]'::jsonb,
  closed_action_ids jsonb not null default '[]'::jsonb,
  archived_action_ids jsonb not null default '[]'::jsonb,
  skipped jsonb not null default '[]'::jsonb,
  actor text not null,
  created_at timestamptz not null default timezone('utc', now()),
  check (length(run_key) between 1 and 250),
  check (jsonb_typeof(candidate_action_ids) = 'array'),
  check (jsonb_typeof(closed_action_ids) = 'array'),
  check (jsonb_typeof(archived_action_ids) = 'array'),
  check (jsonb_typeof(skipped) = 'array')
);

create index if not exists atlas_inactivity_policy_runs_workflow_idx
  on public.atlas_inactivity_policy_runs (workflow_id, created_at desc);

create table if not exists public.atlas_workflow_activity_log (
  id bigint generated by default as identity primary key,
  workflow_id uuid not null references public.atlas_workflows(id) on delete restrict,
  entity_type text not null check (entity_type in (
    'workflow', 'status', 'triage_setting', 'triage_entry', 'rule', 'rule_run', 'inactivity_run'
  )),
  entity_id text not null,
  event text not null,
  old_value jsonb,
  new_value jsonb,
  actor text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists atlas_workflow_activity_log_workflow_idx
  on public.atlas_workflow_activity_log (workflow_id, created_at desc);

-- Seed one workspace fallback plus every configured/observed business lane.
with scopes as (
  select null::text as business
  union
  select item ->> 'id'
    from public.atlas_config config,
         lateral jsonb_array_elements(
           case when jsonb_typeof(config.value) = 'array' then config.value else '[]'::jsonb end
         ) item
   where config.key = 'businesses'
     and nullif(item ->> 'id', '') is not null
  union
  select distinct business
    from public.atlas_actions
   where nullif(business, '') is not null
)
insert into public.atlas_workflows (business, name, description, created_by, updated_by)
select business,
       case when business is null then 'Workspace workflow' else initcap(replace(business, '_', ' ')) || ' workflow' end,
       'Default Atlas workflow seeded from the existing action lifecycle.',
       'codex',
       'codex'
  from scopes
on conflict do nothing;

insert into public.atlas_workflow_statuses (
  workflow_id, status_key, name, description, color, category, legacy_status,
  position, is_default, is_system, created_by, updated_by
)
select workflow.id,
       seed.status_key,
       seed.name,
       seed.description,
       seed.color,
       seed.category,
       seed.legacy_status,
       seed.position,
       seed.is_default,
       seed.is_system,
       'codex',
       'codex'
  from public.atlas_workflows workflow
 cross join (values
    ('triage', 'Triage', 'Incoming work awaiting review.', '#f59e0b', 'triage', 'open', 0, false, false),
    ('backlog', 'Backlog', 'Valid work not yet committed.', '#71717a', 'backlog', 'not_started', 0, false, false),
    ('todo', 'Todo', 'Ready to start.', '#a1a1aa', 'unstarted', 'not_started', 0, true, false),
    ('in_progress', 'In Progress', 'Actively being worked.', '#3b82f6', 'started', 'in_progress', 0, false, false),
    ('waiting', 'Waiting', 'Waiting for an external condition.', '#a855f7', 'started', 'waiting', 1, false, false),
    ('blocked', 'Blocked', 'Cannot proceed until a blocker clears.', '#ef4444', 'started', 'blocked', 2, false, false),
    ('done', 'Done', 'Completed with evidence.', '#22c55e', 'completed', 'done', 0, false, false),
    ('canceled', 'Canceled', 'Closed without completion.', '#737373', 'canceled', 'canceled', 0, false, false),
    ('duplicate', 'Duplicate', 'System-managed duplicate resolution.', '#52525b', 'duplicate', 'done', 0, false, true)
  ) as seed(status_key, name, description, color, category, legacy_status, position, is_default, is_system)
 where workflow.archived_at is null
on conflict do nothing;

insert into public.atlas_triage_settings (
  workflow_id, enabled, require_priority, responsible_member_ids,
  default_accept_status_id, updated_by
)
select workflow.id,
       false,
       false,
       '["ransomed"]'::jsonb,
       status.id,
       'codex'
  from public.atlas_workflows workflow
  join public.atlas_workflow_statuses status
    on status.workflow_id = workflow.id
   and status.is_default
   and status.archived_at is null
on conflict (workflow_id) do nothing;

-- Preserve the compatibility lifecycle exactly while assigning presentation
-- statuses. Duplicate resolution is mapped to the reserved Duplicate state.
update public.atlas_actions action
   set workflow_status_id = status.id
  from public.atlas_workflows workflow
  join public.atlas_workflow_statuses status on status.workflow_id = workflow.id
 where action.workflow_status_id is null
   and workflow.archived_at is null
   and workflow.business is not distinct from action.business
   and status.archived_at is null
   and status.status_key = case
     when action.resolution = 'duplicate' then 'duplicate'
     when action.status = 'archived' then coalesce(nullif(action.archived_from_status, 'archived'), 'not_started')
     when action.status in ('done', 'completed', 'closed') then 'done'
     when action.status in ('cancelled', 'canceled') then 'canceled'
     when action.status = 'in_progress' then 'in_progress'
     when action.status = 'waiting' then 'waiting'
     when action.status = 'blocked' then 'blocked'
     when action.status = 'open' then 'triage'
     else 'todo'
   end;

-- Archived actions can contain historical aliases not represented by a status
-- key; use the closest category without changing their archived state.
update public.atlas_actions action
   set workflow_status_id = status.id
  from public.atlas_workflows workflow
  join public.atlas_workflow_statuses status
    on status.workflow_id = workflow.id and status.status_key = 'todo'
 where action.workflow_status_id is null
   and workflow.archived_at is null
   and workflow.business is not distinct from action.business;

create or replace function public.atlas_validate_workflow_status_definition()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.category = 'triage' and new.legacy_status <> 'open' then
    raise exception using errcode = '23514', message = 'ATLAS_TRIAGE_STATUS_LEGACY_INVALID';
  elsif new.category in ('backlog', 'unstarted') and new.legacy_status not in ('not_started', 'todo') then
    raise exception using errcode = '23514', message = 'ATLAS_UNSTARTED_STATUS_LEGACY_INVALID';
  elsif new.category = 'started' and new.legacy_status not in ('in_progress', 'waiting', 'blocked') then
    raise exception using errcode = '23514', message = 'ATLAS_STARTED_STATUS_LEGACY_INVALID';
  elsif new.category = 'completed' and new.legacy_status not in ('done', 'completed', 'closed') then
    raise exception using errcode = '23514', message = 'ATLAS_COMPLETED_STATUS_LEGACY_INVALID';
  elsif new.category = 'canceled' and new.legacy_status not in ('cancelled', 'canceled') then
    raise exception using errcode = '23514', message = 'ATLAS_CANCELED_STATUS_LEGACY_INVALID';
  elsif new.category = 'duplicate' and (new.legacy_status not in ('done', 'completed', 'closed') or not new.is_system) then
    raise exception using errcode = '23514', message = 'ATLAS_DUPLICATE_STATUS_INVALID';
  end if;

  if tg_op = 'UPDATE' and old.is_system and (
    new.name is distinct from old.name
    or new.status_key is distinct from old.status_key
    or new.category is distinct from old.category
    or new.legacy_status is distinct from old.legacy_status
    or new.archived_at is not null
  ) then
    raise exception using errcode = '23514', message = 'ATLAS_SYSTEM_STATUS_IMMUTABLE';
  end if;
  if new.archived_at is not null and new.is_default then
    raise exception using errcode = '23514', message = 'ATLAS_DEFAULT_STATUS_ARCHIVE_FORBIDDEN';
  end if;
  return new;
end
$function$;

create or replace function public.atlas_sync_action_workflow_status()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  workflow_row public.atlas_workflows%rowtype;
  status_row public.atlas_workflow_statuses%rowtype;
  requested_key text;
begin
  if new.status = 'archived' then return new; end if;

  select * into workflow_row
    from public.atlas_workflows workflow
   where workflow.archived_at is null
     and workflow.business is not distinct from new.business
   limit 1;
  if not found then
    select * into workflow_row
      from public.atlas_workflows workflow
     where workflow.archived_at is null and workflow.business is null
     limit 1;
  end if;
  if not found then
    raise exception using errcode = '23503', message = 'ATLAS_ACTION_WORKFLOW_NOT_FOUND';
  end if;

  if new.workflow_status_id is not null
     and (tg_op = 'INSERT' or new.workflow_status_id is distinct from old.workflow_status_id)
  then
    select * into status_row
      from public.atlas_workflow_statuses status
     where status.id = new.workflow_status_id
       and status.workflow_id = workflow_row.id
       and status.archived_at is null;
    if not found then
      raise exception using errcode = '23503', message = 'ATLAS_ACTION_WORKFLOW_STATUS_INVALID';
    end if;
    new.status := status_row.legacy_status;
    return new;
  end if;

  requested_key := case
    when new.resolution = 'duplicate' then 'duplicate'
    when new.status in ('done', 'completed', 'closed') then 'done'
    when new.status in ('cancelled', 'canceled') then 'canceled'
    when new.status = 'in_progress' then 'in_progress'
    when new.status = 'waiting' then 'waiting'
    when new.status = 'blocked' then 'blocked'
    when new.status = 'open' then 'triage'
    else 'todo'
  end;

  select * into status_row
    from public.atlas_workflow_statuses status
   where status.workflow_id = workflow_row.id
     and status.archived_at is null
     and status.status_key = requested_key
   order by status.position
   limit 1;
  if not found then
    select * into status_row
      from public.atlas_workflow_statuses status
     where status.workflow_id = workflow_row.id
       and status.archived_at is null
       and (
         status.legacy_status = new.status
         or (new.status in ('not_started', 'todo') and status.category in ('backlog', 'unstarted'))
       )
     order by status.is_default desc, status.position
     limit 1;
  end if;
  if not found then
    raise exception using errcode = '23503', message = 'ATLAS_ACTION_WORKFLOW_STATUS_NOT_FOUND';
  end if;
  new.workflow_status_id := status_row.id;
  new.status := status_row.legacy_status;
  return new;
end
$function$;

create or replace function public.atlas_validate_triage_settings()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.default_accept_status_id is not null and not exists (
    select 1
      from public.atlas_workflow_statuses status
     where status.id = new.default_accept_status_id
       and status.workflow_id = new.workflow_id
       and status.archived_at is null
       and status.category in ('backlog', 'unstarted', 'started')
  ) then
    raise exception using errcode = '23503', message = 'ATLAS_TRIAGE_ACCEPT_STATUS_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(new.responsible_member_ids) member_id(value)
     where not exists (
       select 1 from public.atlas_members member
        where member.id = member_id.value and member.is_active
     )
  ) then
    raise exception using errcode = '23503', message = 'ATLAS_TRIAGE_RESPONSIBILITY_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(new.auto_close_categories) category(value)
     where category.value not in ('backlog', 'unstarted', 'started')
  ) then
    raise exception using errcode = '23514', message = 'ATLAS_INACTIVITY_CATEGORY_INVALID';
  end if;
  return new;
end
$function$;

drop trigger if exists atlas_workflow_statuses_validate on public.atlas_workflow_statuses;
create trigger atlas_workflow_statuses_validate
before insert or update on public.atlas_workflow_statuses
for each row execute function public.atlas_validate_workflow_status_definition();

drop trigger if exists atlas_actions_sync_workflow_status on public.atlas_actions;
create trigger atlas_actions_sync_workflow_status
before insert or update of status, resolution, workflow_status_id, business on public.atlas_actions
for each row execute function public.atlas_sync_action_workflow_status();

drop trigger if exists atlas_triage_settings_validate on public.atlas_triage_settings;
create trigger atlas_triage_settings_validate
before insert or update on public.atlas_triage_settings
for each row execute function public.atlas_validate_triage_settings();

create or replace function public.enter_atlas_triage_action(
  p_action_id text,
  p_source_type text,
  p_source_ref text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  action_row public.atlas_actions%rowtype;
  workflow_row public.atlas_workflows%rowtype;
  setting_row public.atlas_triage_settings%rowtype;
  triage_status_id uuid;
  entry_row public.atlas_triage_entries%rowtype;
  old_entry jsonb;
  server_timestamp timestamptz := timezone('utc', now());
begin
  if p_actor is null or p_actor not in ('ransomed', 'codex', 'claude') then
    raise exception using errcode = '22023', message = 'ATLAS_ACTOR_NOT_ALLOWED';
  end if;
  if p_source_type not in ('manual', 'integration', 'external_member', 'email', 'transcript', 'webhook', 'import') then
    raise exception using errcode = '22023', message = 'ATLAS_TRIAGE_SOURCE_INVALID';
  end if;

  select * into action_row from public.atlas_actions where id = p_action_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ATLAS_ACTION_NOT_FOUND'; end if;
  if action_row.status = 'archived' then raise exception using errcode = '55000', message = 'ATLAS_ACTION_ARCHIVED'; end if;

  select * into workflow_row
    from public.atlas_workflows
   where archived_at is null and business is not distinct from action_row.business
   limit 1;
  if not found then raise exception using errcode = '23503', message = 'ATLAS_ACTION_WORKFLOW_NOT_FOUND'; end if;
  select * into setting_row from public.atlas_triage_settings where workflow_id = workflow_row.id;
  if not found or not setting_row.enabled then
    raise exception using errcode = '55000', message = 'ATLAS_TRIAGE_DISABLED';
  end if;
  select id into triage_status_id
    from public.atlas_workflow_statuses
   where workflow_id = workflow_row.id and category = 'triage' and archived_at is null
   order by position limit 1;
  if triage_status_id is null then raise exception using errcode = '23503', message = 'ATLAS_TRIAGE_STATUS_NOT_FOUND'; end if;

  select to_jsonb(entry) into old_entry
    from public.atlas_triage_entries entry where entry.action_id = p_action_id;

  insert into public.atlas_triage_entries (
    action_id, workflow_id, state, source_type, source_ref, snoozed_until,
    decision_reason, decision_by, canonical_action_id, last_activity_at,
    created_by, updated_by
  ) values (
    p_action_id, workflow_row.id, 'pending', p_source_type, p_source_ref, null,
    '', null, null, server_timestamp, p_actor, p_actor
  )
  on conflict (action_id) do update
     set workflow_id = excluded.workflow_id,
         state = 'pending',
         source_type = excluded.source_type,
         source_ref = excluded.source_ref,
         snoozed_until = null,
         decision_reason = '',
         decision_by = null,
         canonical_action_id = null,
         last_activity_at = server_timestamp,
         revision = public.atlas_triage_entries.revision + 1,
         updated_by = p_actor,
         updated_at = server_timestamp
  returning * into entry_row;

  update public.atlas_actions
     set workflow_status_id = triage_status_id,
         revision = revision + 1,
         updated_at = server_timestamp
   where id = p_action_id
  returning * into action_row;

  insert into public.atlas_triage_events (triage_entry_id, action_id, event, old_value, new_value, actor)
  values (entry_row.id, p_action_id, 'entered', old_entry, to_jsonb(entry_row), p_actor);
  insert into public.atlas_activity_log (action_id, event, old_value, new_value, actor, created_at)
  values (p_action_id, 'triage_entered', old_entry::text, to_jsonb(entry_row)::text, p_actor, server_timestamp);
  insert into public.atlas_workflow_activity_log (workflow_id, entity_type, entity_id, event, old_value, new_value, actor, created_at)
  values (workflow_row.id, 'triage_entry', entry_row.id::text, 'entered', old_entry, to_jsonb(entry_row), p_actor, server_timestamp);

  return jsonb_build_object('entry', to_jsonb(entry_row), 'action', to_jsonb(action_row));
end
$function$;

create or replace function public.configure_atlas_workflow_status(
  p_workflow_id uuid,
  p_status_id uuid,
  p_status_key text,
  p_name text,
  p_description text,
  p_color text,
  p_category text,
  p_legacy_status text,
  p_position integer,
  p_is_default boolean,
  p_actor text,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  status_row public.atlas_workflow_statuses%rowtype;
  server_timestamp timestamptz := timezone('utc', now());
begin
  if p_actor is null or p_actor not in ('ransomed', 'codex', 'claude') then
    raise exception using errcode = '22023', message = 'ATLAS_ACTOR_NOT_ALLOWED';
  end if;
  if not exists (select 1 from public.atlas_workflows where id = p_workflow_id and archived_at is null) then
    raise exception using errcode = 'P0002', message = 'ATLAS_WORKFLOW_NOT_FOUND';
  end if;
  if p_is_default and p_category not in ('backlog', 'unstarted') then
    raise exception using errcode = '23514', message = 'ATLAS_DEFAULT_STATUS_CATEGORY_INVALID';
  end if;

  if p_status_id is null then
    if p_category = 'duplicate' then
      raise exception using errcode = '23514', message = 'ATLAS_DUPLICATE_STATUS_RESERVED';
    end if;
    if p_is_default then
      update public.atlas_workflow_statuses
         set is_default = false, revision = revision + 1,
             updated_by = p_actor, updated_at = server_timestamp
       where workflow_id = p_workflow_id and is_default and archived_at is null;
    end if;
    insert into public.atlas_workflow_statuses (
      workflow_id, status_key, name, description, color, category,
      legacy_status, position, is_default, is_system, created_by, updated_by
    ) values (
      p_workflow_id, p_status_key, p_name, coalesce(p_description, ''), p_color,
      p_category, p_legacy_status, p_position, p_is_default, false, p_actor, p_actor
    ) returning * into status_row;
  else
    select * into status_row
      from public.atlas_workflow_statuses
     where id = p_status_id and workflow_id = p_workflow_id
     for update;
    if not found then raise exception using errcode = 'P0002', message = 'ATLAS_WORKFLOW_STATUS_NOT_FOUND'; end if;
    if p_expected_revision is not null and status_row.revision <> p_expected_revision then
      raise exception using errcode = '40001', message = 'ATLAS_REVISION_CONFLICT';
    end if;
    if status_row.is_system then
      raise exception using errcode = '23514', message = 'ATLAS_SYSTEM_STATUS_IMMUTABLE';
    end if;
    if p_is_default then
      update public.atlas_workflow_statuses
         set is_default = false, revision = revision + 1,
             updated_by = p_actor, updated_at = server_timestamp
       where workflow_id = p_workflow_id and id <> p_status_id
         and is_default and archived_at is null;
    end if;
    update public.atlas_workflow_statuses
       set status_key = p_status_key,
           name = p_name,
           description = coalesce(p_description, ''),
           color = p_color,
           category = p_category,
           legacy_status = p_legacy_status,
           position = p_position,
           is_default = p_is_default,
           revision = revision + 1,
           updated_by = p_actor,
           updated_at = server_timestamp
     where id = p_status_id
    returning * into status_row;
  end if;

  insert into public.atlas_workflow_activity_log (
    workflow_id, entity_type, entity_id, event, new_value, actor, created_at
  ) values (
    p_workflow_id, 'status', status_row.id::text,
    case when p_status_id is null then 'created' else 'updated' end,
    to_jsonb(status_row), p_actor, server_timestamp
  );
  return to_jsonb(status_row);
end
$function$;

create or replace function public.archive_atlas_workflow_status(
  p_status_id uuid,
  p_replacement_status_id uuid,
  p_actor text,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  status_row public.atlas_workflow_statuses%rowtype;
  replacement_row public.atlas_workflow_statuses%rowtype;
  server_timestamp timestamptz := timezone('utc', now());
begin
  if p_actor is null or p_actor not in ('ransomed', 'codex', 'claude') then
    raise exception using errcode = '22023', message = 'ATLAS_ACTOR_NOT_ALLOWED';
  end if;
  select * into status_row from public.atlas_workflow_statuses where id = p_status_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ATLAS_WORKFLOW_STATUS_NOT_FOUND'; end if;
  if status_row.archived_at is not null then return to_jsonb(status_row); end if;
  if status_row.is_system or status_row.is_default then
    raise exception using errcode = '23514', message = 'ATLAS_WORKFLOW_STATUS_ARCHIVE_FORBIDDEN';
  end if;
  if p_expected_revision is not null and status_row.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'ATLAS_REVISION_CONFLICT';
  end if;
  if not exists (
    select 1 from public.atlas_workflow_statuses
     where workflow_id = status_row.workflow_id and category = status_row.category
       and id <> status_row.id and archived_at is null
  ) then
    raise exception using errcode = '23514', message = 'ATLAS_WORKFLOW_CATEGORY_LAST_STATUS';
  end if;
  select * into replacement_row
    from public.atlas_workflow_statuses
   where id = p_replacement_status_id
     and workflow_id = status_row.workflow_id
     and category = status_row.category
     and archived_at is null;
  if not found then
    raise exception using errcode = '23503', message = 'ATLAS_WORKFLOW_REPLACEMENT_STATUS_INVALID';
  end if;

  update public.atlas_actions
     set workflow_status_id = replacement_row.id,
         revision = revision + 1,
         updated_at = server_timestamp
   where workflow_status_id = status_row.id and status <> 'archived';
  update public.atlas_actions
     set workflow_status_id = replacement_row.id,
         revision = revision + 1,
         updated_at = server_timestamp
   where workflow_status_id = status_row.id and status = 'archived';
  update public.atlas_triage_settings
     set default_accept_status_id = replacement_row.id,
         revision = revision + 1,
         updated_by = p_actor,
         updated_at = server_timestamp
   where default_accept_status_id = status_row.id;
  update public.atlas_workflow_statuses
     set archived_at = server_timestamp,
         revision = revision + 1,
         updated_by = p_actor,
         updated_at = server_timestamp
   where id = status_row.id returning * into status_row;

  insert into public.atlas_workflow_activity_log (
    workflow_id, entity_type, entity_id, event, new_value, actor, created_at
  ) values (
    status_row.workflow_id, 'status', status_row.id::text, 'archived',
    jsonb_build_object('status', to_jsonb(status_row), 'replacement_status_id', replacement_row.id),
    p_actor, server_timestamp
  );
  return to_jsonb(status_row);
end
$function$;

create or replace function public.reorder_atlas_workflow_statuses(
  p_workflow_id uuid,
  p_status_ids uuid[],
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  expected_count integer;
  supplied_count integer;
  status_id uuid;
  next_position integer := 0;
  server_timestamp timestamptz := timezone('utc', now());
begin
  if p_actor is null or p_actor not in ('ransomed', 'codex', 'claude') then
    raise exception using errcode = '22023', message = 'ATLAS_ACTOR_NOT_ALLOWED';
  end if;
  select count(*) into expected_count from public.atlas_workflow_statuses
   where workflow_id = p_workflow_id and archived_at is null;
  select count(distinct value) into supplied_count from unnest(p_status_ids) item(value);
  if supplied_count <> expected_count or exists (
    select 1 from unnest(p_status_ids) item(value)
     where not exists (
       select 1 from public.atlas_workflow_statuses status
        where status.id = item.value and status.workflow_id = p_workflow_id and status.archived_at is null
     )
  ) then
    raise exception using errcode = '22023', message = 'ATLAS_WORKFLOW_STATUS_ORDER_INVALID';
  end if;
  foreach status_id in array p_status_ids loop
    update public.atlas_workflow_statuses
       set position = next_position, revision = revision + 1,
           updated_by = p_actor, updated_at = server_timestamp
     where id = status_id;
    next_position := next_position + 1;
  end loop;
  insert into public.atlas_workflow_activity_log (
    workflow_id, entity_type, entity_id, event, new_value, actor, created_at
  ) values (
    p_workflow_id, 'workflow', p_workflow_id::text, 'statuses_reordered',
    to_jsonb(p_status_ids), p_actor, server_timestamp
  );
  return jsonb_build_object('workflow_id', p_workflow_id, 'status_ids', to_jsonb(p_status_ids));
end
$function$;

create or replace function public.transition_atlas_triage_action(
  p_action_id text,
  p_decision text,
  p_actor text,
  p_target_status_id uuid default null,
  p_reason text default '',
  p_snoozed_until timestamptz default null,
  p_canonical_action_id text default null,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  action_row public.atlas_actions%rowtype;
  entry_row public.atlas_triage_entries%rowtype;
  setting_row public.atlas_triage_settings%rowtype;
  target_status public.atlas_workflow_statuses%rowtype;
  old_entry jsonb;
  server_timestamp timestamptz := timezone('utc', now());
begin
  if p_actor is null or p_actor not in ('ransomed', 'codex', 'claude') then
    raise exception using errcode = '22023', message = 'ATLAS_ACTOR_NOT_ALLOWED';
  end if;
  if p_decision not in ('accept', 'decline', 'duplicate', 'snooze') then
    raise exception using errcode = '22023', message = 'ATLAS_TRIAGE_DECISION_INVALID';
  end if;

  select * into entry_row from public.atlas_triage_entries where action_id = p_action_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ATLAS_TRIAGE_ENTRY_NOT_FOUND'; end if;
  if entry_row.state not in ('pending', 'snoozed') then
    raise exception using errcode = '55000', message = 'ATLAS_TRIAGE_ENTRY_DECIDED';
  end if;
  if p_expected_revision is not null and entry_row.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'ATLAS_REVISION_CONFLICT';
  end if;
  old_entry := to_jsonb(entry_row);
  select * into action_row from public.atlas_actions where id = p_action_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ATLAS_ACTION_NOT_FOUND'; end if;
  select * into setting_row from public.atlas_triage_settings where workflow_id = entry_row.workflow_id;

  if p_decision = 'accept' then
    if setting_row.require_priority and action_row.priority is null then
      raise exception using errcode = '23514', message = 'ATLAS_TRIAGE_PRIORITY_REQUIRED';
    end if;
    select * into target_status
      from public.atlas_workflow_statuses
     where id = coalesce(p_target_status_id, setting_row.default_accept_status_id)
       and workflow_id = entry_row.workflow_id
       and archived_at is null
       and category in ('backlog', 'unstarted', 'started');
    if not found then raise exception using errcode = '23503', message = 'ATLAS_TRIAGE_ACCEPT_STATUS_INVALID'; end if;
    update public.atlas_actions
       set workflow_status_id = target_status.id,
           revision = revision + 1,
           updated_at = server_timestamp
     where id = p_action_id returning * into action_row;
    update public.atlas_triage_entries
       set state = 'accepted', snoozed_until = null, decision_reason = coalesce(p_reason, ''),
           decision_by = p_actor, canonical_action_id = null, revision = revision + 1,
           updated_by = p_actor, updated_at = server_timestamp
     where id = entry_row.id returning * into entry_row;
  elsif p_decision = 'decline' then
    select * into target_status
      from public.atlas_workflow_statuses
     where workflow_id = entry_row.workflow_id and category = 'canceled' and archived_at is null
     order by position limit 1;
    if not found then raise exception using errcode = '23503', message = 'ATLAS_CANCELED_STATUS_NOT_FOUND'; end if;
    update public.atlas_actions
       set workflow_status_id = target_status.id,
           resolution = 'canceled',
           evidence_json = jsonb_build_object(
             'version', 2, 'kind', 'triage_decline',
             'summary', coalesce(nullif(p_reason, ''), 'Declined from Triage.'),
             'verification', jsonb_build_object('status', 'system_recorded')
           ),
           revision = revision + 1,
           updated_at = server_timestamp
     where id = p_action_id returning * into action_row;
    update public.atlas_triage_entries
       set state = 'declined', snoozed_until = null, decision_reason = coalesce(p_reason, ''),
           decision_by = p_actor, canonical_action_id = null, revision = revision + 1,
           updated_by = p_actor, updated_at = server_timestamp
     where id = entry_row.id returning * into entry_row;
  elsif p_decision = 'duplicate' then
    if p_canonical_action_id is null then
      raise exception using errcode = '22023', message = 'ATLAS_TRIAGE_CANONICAL_ACTION_REQUIRED';
    end if;
    perform public.mark_atlas_action_duplicate(p_action_id, p_canonical_action_id, p_actor, action_row.revision);
    select * into action_row from public.atlas_actions where id = p_action_id;
    update public.atlas_triage_entries
       set state = 'duplicate', snoozed_until = null, decision_reason = coalesce(p_reason, ''),
           decision_by = p_actor, canonical_action_id = p_canonical_action_id,
           revision = revision + 1, updated_by = p_actor, updated_at = server_timestamp
     where id = entry_row.id returning * into entry_row;
  else
    if p_snoozed_until is null or p_snoozed_until <= server_timestamp then
      raise exception using errcode = '22023', message = 'ATLAS_TRIAGE_SNOOZE_INVALID';
    end if;
    update public.atlas_triage_entries
       set state = 'snoozed', snoozed_until = p_snoozed_until,
           decision_reason = coalesce(p_reason, ''), decision_by = p_actor,
           canonical_action_id = null, revision = revision + 1,
           updated_by = p_actor, updated_at = server_timestamp
     where id = entry_row.id returning * into entry_row;
  end if;

  insert into public.atlas_triage_events (triage_entry_id, action_id, event, old_value, new_value, actor)
  values (entry_row.id, p_action_id, p_decision || case when p_decision = 'accept' then 'ed' when p_decision = 'decline' then 'd' when p_decision = 'snooze' then 'd' else '' end, old_entry, to_jsonb(entry_row), p_actor);
  insert into public.atlas_activity_log (action_id, event, old_value, new_value, actor, created_at)
  values (p_action_id, 'triage_' || p_decision, old_entry::text, to_jsonb(entry_row)::text, p_actor, server_timestamp);
  insert into public.atlas_workflow_activity_log (workflow_id, entity_type, entity_id, event, old_value, new_value, actor, created_at)
  values (entry_row.workflow_id, 'triage_entry', entry_row.id::text, p_decision, old_entry, to_jsonb(entry_row), p_actor, server_timestamp);

  return jsonb_build_object('entry', to_jsonb(entry_row), 'action', to_jsonb(action_row));
end
$function$;

create or replace function public.record_atlas_workflow_rule_run(
  p_workflow_id uuid,
  p_action_id text,
  p_event_key text,
  p_trigger_type text,
  p_matched_rule_ids jsonb,
  p_proposed_effects jsonb,
  p_conflicts jsonb,
  p_actor text,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  action_row public.atlas_actions%rowtype;
  workflow_row public.atlas_workflows%rowtype;
  target_status public.atlas_workflow_statuses%rowtype;
  run_row public.atlas_workflow_rule_runs%rowtype;
  applied jsonb := '{}'::jsonb;
  run_status text;
  unknown_key text;
  server_timestamp timestamptz := timezone('utc', now());
begin
  if p_actor is null or p_actor not in ('ransomed', 'codex', 'claude') then
    raise exception using errcode = '22023', message = 'ATLAS_ACTOR_NOT_ALLOWED';
  end if;
  if p_trigger_type not in ('triage_entered', 'action_created', 'action_updated', 'status_changed', 'priority_changed', 'manual') then
    raise exception using errcode = '22023', message = 'ATLAS_WORKFLOW_TRIGGER_INVALID';
  end if;
  if jsonb_typeof(p_matched_rule_ids) <> 'array'
     or jsonb_typeof(p_proposed_effects) <> 'object'
     or jsonb_typeof(p_conflicts) <> 'array'
  then
    raise exception using errcode = '22023', message = 'ATLAS_WORKFLOW_RULE_PAYLOAD_INVALID';
  end if;
  select key into unknown_key
    from jsonb_object_keys(p_proposed_effects) key
   where key not in ('workflow_status_id', 'priority', 'owners', 'tags', 'project_id', 'work_mode')
   limit 1;
  if unknown_key is not null then
    raise exception using errcode = '22023', message = 'ATLAS_WORKFLOW_EFFECT_FORBIDDEN';
  end if;

  if not p_dry_run then
    select * into run_row
      from public.atlas_workflow_rule_runs
     where workflow_id = p_workflow_id and event_key = p_event_key and not dry_run;
    if found then return to_jsonb(run_row); end if;
  end if;

  select * into workflow_row from public.atlas_workflows where id = p_workflow_id and archived_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'ATLAS_WORKFLOW_NOT_FOUND'; end if;
  select * into action_row from public.atlas_actions where id = p_action_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ATLAS_ACTION_NOT_FOUND'; end if;
  if workflow_row.business is distinct from action_row.business then
    raise exception using errcode = '23503', message = 'ATLAS_ACTION_WORKFLOW_MISMATCH';
  end if;

  if p_proposed_effects ? 'workflow_status_id' then
    select * into target_status
      from public.atlas_workflow_statuses
     where id = (p_proposed_effects ->> 'workflow_status_id')::uuid
       and workflow_id = p_workflow_id
       and archived_at is null
       and category in ('triage', 'backlog', 'unstarted', 'started');
    if not found then
      raise exception using errcode = '23503', message = 'ATLAS_WORKFLOW_AUTOMATION_STATUS_FORBIDDEN';
    end if;
  end if;
  if p_proposed_effects ? 'priority' and p_proposed_effects ->> 'priority' not in ('p0', 'p1', 'p2', 'p3') then
    raise exception using errcode = '22023', message = 'ATLAS_WORKFLOW_AUTOMATION_PRIORITY_INVALID';
  end if;
  if p_proposed_effects ? 'work_mode' and p_proposed_effects ->> 'work_mode' not in ('autonomous', 'review_required', 'user_only') then
    raise exception using errcode = '22023', message = 'ATLAS_WORKFLOW_AUTOMATION_WORK_MODE_INVALID';
  end if;
  if p_proposed_effects ? 'owners' and jsonb_typeof(p_proposed_effects -> 'owners') <> 'array' then
    raise exception using errcode = '22023', message = 'ATLAS_WORKFLOW_AUTOMATION_OWNERS_INVALID';
  end if;
  if p_proposed_effects ? 'tags' and jsonb_typeof(p_proposed_effects -> 'tags') <> 'array' then
    raise exception using errcode = '22023', message = 'ATLAS_WORKFLOW_AUTOMATION_TAGS_INVALID';
  end if;

  if not p_dry_run and jsonb_array_length(p_matched_rule_ids) > 0 then
    update public.atlas_actions
       set workflow_status_id = case when p_proposed_effects ? 'workflow_status_id' then target_status.id else workflow_status_id end,
           priority = case when p_proposed_effects ? 'priority' then p_proposed_effects ->> 'priority' else priority end,
           owners = case when p_proposed_effects ? 'owners' then p_proposed_effects -> 'owners' else owners end,
           tags = case when p_proposed_effects ? 'tags' then p_proposed_effects -> 'tags' else tags end,
           project_id = case when p_proposed_effects ? 'project_id' then nullif(p_proposed_effects ->> 'project_id', '') else project_id end,
           project_milestone_id = case when p_proposed_effects ? 'project_id' and project_id is distinct from nullif(p_proposed_effects ->> 'project_id', '') then null else project_milestone_id end,
           work_mode = case when p_proposed_effects ? 'work_mode' then p_proposed_effects ->> 'work_mode' else work_mode end,
           revision = revision + 1,
           updated_at = server_timestamp
     where id = p_action_id
    returning * into action_row;
    applied := p_proposed_effects;
    run_status := case when jsonb_array_length(p_conflicts) > 0 then 'conflicted' else 'applied' end;
    insert into public.atlas_activity_log (action_id, event, old_value, new_value, actor, created_at)
    values (p_action_id, 'workflow_automation_applied', null, jsonb_build_object('event_key', p_event_key, 'effects', applied, 'conflicts', p_conflicts)::text, p_actor, server_timestamp);
  elsif p_dry_run then
    run_status := 'previewed';
  else
    run_status := 'no_match';
  end if;

  insert into public.atlas_workflow_rule_runs (
    workflow_id, action_id, event_key, trigger_type, matched_rule_ids,
    proposed_effects, applied_effects, conflicts, status, dry_run, actor, created_at
  ) values (
    p_workflow_id, p_action_id, p_event_key, p_trigger_type, p_matched_rule_ids,
    p_proposed_effects, applied, p_conflicts, run_status, p_dry_run, p_actor, server_timestamp
  ) returning * into run_row;
  insert into public.atlas_workflow_activity_log (workflow_id, entity_type, entity_id, event, new_value, actor, created_at)
  values (p_workflow_id, 'rule_run', run_row.id::text, run_status, to_jsonb(run_row), p_actor, server_timestamp);

  return jsonb_build_object('run', to_jsonb(run_row), 'action', to_jsonb(action_row));
end
$function$;

create or replace function public.apply_atlas_inactivity_action(
  p_workflow_id uuid,
  p_action_id text,
  p_mode text,
  p_as_of timestamptz,
  p_run_key text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  action_row public.atlas_actions%rowtype;
  setting_row public.atlas_triage_settings%rowtype;
  status_row public.atlas_workflow_statuses%rowtype;
  canceled_status_id uuid;
  already_applied boolean;
  server_timestamp timestamptz := timezone('utc', now());
begin
  if p_actor is null or p_actor not in ('ransomed', 'codex', 'claude') then
    raise exception using errcode = '22023', message = 'ATLAS_ACTOR_NOT_ALLOWED';
  end if;
  if p_mode not in ('close', 'archive') then
    raise exception using errcode = '22023', message = 'ATLAS_INACTIVITY_MODE_INVALID';
  end if;
  select exists (
    select 1 from public.atlas_activity_log
     where action_id = p_action_id and event = 'inactivity_' || p_mode
       and new_value::jsonb ->> 'run_key' = p_run_key
  ) into already_applied;
  if already_applied then
    select * into action_row from public.atlas_actions where id = p_action_id;
    return jsonb_build_object('action', to_jsonb(action_row), 'applied', false, 'idempotent', true);
  end if;

  select * into setting_row from public.atlas_triage_settings where workflow_id = p_workflow_id;
  if not found then raise exception using errcode = 'P0002', message = 'ATLAS_INACTIVITY_SETTINGS_NOT_FOUND'; end if;
  select * into action_row from public.atlas_actions where id = p_action_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ATLAS_ACTION_NOT_FOUND'; end if;
  select * into status_row from public.atlas_workflow_statuses where id = action_row.workflow_status_id;
  if not found or status_row.workflow_id <> p_workflow_id then
    raise exception using errcode = '23503', message = 'ATLAS_ACTION_WORKFLOW_MISMATCH';
  end if;

  if p_mode = 'close' then
    if setting_row.auto_close_days is null
       or action_row.updated_at > p_as_of - make_interval(days => setting_row.auto_close_days)
       or not setting_row.auto_close_categories ? status_row.category
       or action_row.status = 'archived'
       or coalesce(action_row.approval_state, 'not_required') in ('needs_review', 'deferred')
       or action_row.work_mode = 'user_only'
    then
      raise exception using errcode = '55000', message = 'ATLAS_INACTIVITY_ACTION_NOT_ELIGIBLE';
    end if;
    select id into canceled_status_id
      from public.atlas_workflow_statuses
     where workflow_id = p_workflow_id and category = 'canceled' and archived_at is null
     order by position limit 1;
    update public.atlas_actions
       set workflow_status_id = canceled_status_id,
           resolution = 'canceled',
           evidence_json = jsonb_build_object(
             'version', 2, 'kind', 'inactivity_policy',
             'summary', format('Closed after %s days without activity.', setting_row.auto_close_days),
             'run_key', p_run_key,
             'verification', jsonb_build_object('status', 'system_recorded')
           ),
           revision = revision + 1,
           updated_at = server_timestamp
     where id = p_action_id returning * into action_row;
  else
    if setting_row.auto_archive_days is null
       or action_row.updated_at > p_as_of - make_interval(days => setting_row.auto_archive_days)
       or action_row.status not in ('done', 'completed', 'closed', 'cancelled', 'canceled')
    then
      raise exception using errcode = '55000', message = 'ATLAS_INACTIVITY_ACTION_NOT_ELIGIBLE';
    end if;
    perform public.archive_atlas_action(p_action_id, p_actor, action_row.revision);
    select * into action_row from public.atlas_actions where id = p_action_id;
  end if;

  insert into public.atlas_activity_log (action_id, event, new_value, actor, created_at)
  values (
    p_action_id, 'inactivity_' || p_mode,
    jsonb_build_object('run_key', p_run_key, 'workflow_id', p_workflow_id, 'as_of', p_as_of)::text,
    p_actor, server_timestamp
  );
  return jsonb_build_object('action', to_jsonb(action_row), 'applied', true, 'idempotent', false);
end
$function$;

create or replace function public.atlas_unsnooze_triage_on_action_activity()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  entry_row public.atlas_triage_entries%rowtype;
begin
  if new.title is not distinct from old.title
     and new.description is not distinct from old.description
     and new.priority is not distinct from old.priority
     and new.owners is not distinct from old.owners
     and new.tags is not distinct from old.tags
     and new.notes is not distinct from old.notes
     and new.source_label is not distinct from old.source_label
     and new.due_date is not distinct from old.due_date
     and new.project_id is not distinct from old.project_id
     and new.work_mode is not distinct from old.work_mode
  then
    return new;
  end if;
  update public.atlas_triage_entries
     set state = 'pending', snoozed_until = null, decision_reason = '', decision_by = null,
         revision = revision + 1, updated_by = 'system', updated_at = timezone('utc', now()),
         last_activity_at = timezone('utc', now())
   where action_id = new.id and state = 'snoozed'
  returning * into entry_row;
  if found then
    insert into public.atlas_triage_events (triage_entry_id, action_id, event, new_value, actor)
    values (entry_row.id, new.id, 'unsnoozed', to_jsonb(entry_row), 'system');
  end if;
  return new;
end
$function$;

create or replace function public.atlas_unsnooze_triage_on_comment()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  entry_row public.atlas_triage_entries%rowtype;
begin
  if new.target_type <> 'action' or new.status <> 'active' then return new; end if;
  update public.atlas_triage_entries
     set state = 'pending', snoozed_until = null, decision_reason = '', decision_by = null,
         revision = revision + 1, updated_by = new.created_by,
         updated_at = timezone('utc', now()), last_activity_at = timezone('utc', now())
   where action_id = new.target_id and state = 'snoozed'
  returning * into entry_row;
  if found then
    insert into public.atlas_triage_events (triage_entry_id, action_id, event, new_value, actor)
    values (entry_row.id, new.target_id, 'unsnoozed', to_jsonb(entry_row), new.created_by);
  end if;
  return new;
end
$function$;

drop trigger if exists atlas_actions_unsnooze_triage on public.atlas_actions;
create trigger atlas_actions_unsnooze_triage
after update on public.atlas_actions
for each row execute function public.atlas_unsnooze_triage_on_action_activity();

drop trigger if exists atlas_comments_unsnooze_triage on public.atlas_comments;
create trigger atlas_comments_unsnooze_triage
after insert on public.atlas_comments
for each row execute function public.atlas_unsnooze_triage_on_comment();

create or replace function public.atlas_reject_workflow_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'ATLAS_WORKFLOW_HISTORY_IMMUTABLE';
end
$function$;

create or replace function public.atlas_reject_workflow_delete()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'ATLAS_WORKFLOW_DELETE_FORBIDDEN';
end
$function$;

drop trigger if exists atlas_triage_events_immutable on public.atlas_triage_events;
create trigger atlas_triage_events_immutable
before update or delete on public.atlas_triage_events
for each row execute function public.atlas_reject_workflow_history_mutation();
drop trigger if exists atlas_workflow_rule_runs_immutable on public.atlas_workflow_rule_runs;
create trigger atlas_workflow_rule_runs_immutable
before update or delete on public.atlas_workflow_rule_runs
for each row execute function public.atlas_reject_workflow_history_mutation();
drop trigger if exists atlas_inactivity_policy_runs_immutable on public.atlas_inactivity_policy_runs;
create trigger atlas_inactivity_policy_runs_immutable
before update or delete on public.atlas_inactivity_policy_runs
for each row execute function public.atlas_reject_workflow_history_mutation();
drop trigger if exists atlas_workflow_activity_log_immutable on public.atlas_workflow_activity_log;
create trigger atlas_workflow_activity_log_immutable
before update or delete on public.atlas_workflow_activity_log
for each row execute function public.atlas_reject_workflow_history_mutation();

do $migration$
declare
  table_name text;
begin
  foreach table_name in array array[
    'atlas_workflows', 'atlas_workflow_statuses', 'atlas_triage_settings',
    'atlas_triage_entries', 'atlas_workflow_rules'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_no_delete', table_name);
    execute format(
      'create trigger %I before delete on public.%I for each row execute function public.atlas_reject_workflow_delete()',
      table_name || '_no_delete', table_name
    );
  end loop;
end
$migration$;

do $migration$
declare
  table_name text;
  role_name text;
begin
  foreach table_name in array array[
    'atlas_workflows', 'atlas_workflow_statuses', 'atlas_triage_settings',
    'atlas_triage_entries', 'atlas_triage_events', 'atlas_workflow_rules',
    'atlas_workflow_rule_runs', 'atlas_inactivity_policy_runs',
    'atlas_workflow_activity_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public', table_name);
    foreach role_name in array array['anon', 'authenticated']
    loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('revoke all on table public.%I from %I', table_name, role_name);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('revoke all on table public.%I from service_role', table_name);
      if table_name in ('atlas_triage_events', 'atlas_workflow_rule_runs', 'atlas_inactivity_policy_runs', 'atlas_workflow_activity_log') then
        execute format('grant select, insert on table public.%I to service_role', table_name);
      else
        execute format('grant select, insert, update on table public.%I to service_role', table_name);
      end if;
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage, select on sequence public.atlas_workflow_activity_log_id_seq to service_role;
  end if;
end
$migration$;

revoke all on function public.atlas_validate_workflow_status_definition() from public;
revoke all on function public.atlas_sync_action_workflow_status() from public;
revoke all on function public.atlas_validate_triage_settings() from public;
revoke all on function public.enter_atlas_triage_action(text, text, text, text) from public;
revoke all on function public.configure_atlas_workflow_status(uuid, uuid, text, text, text, text, text, text, integer, boolean, text, bigint) from public;
revoke all on function public.archive_atlas_workflow_status(uuid, uuid, text, bigint) from public;
revoke all on function public.reorder_atlas_workflow_statuses(uuid, uuid[], text) from public;
revoke all on function public.transition_atlas_triage_action(text, text, text, uuid, text, timestamptz, text, bigint) from public;
revoke all on function public.record_atlas_workflow_rule_run(uuid, text, text, text, jsonb, jsonb, jsonb, text, boolean) from public;
revoke all on function public.apply_atlas_inactivity_action(uuid, text, text, timestamptz, text, text) from public;
revoke all on function public.atlas_unsnooze_triage_on_action_activity() from public;
revoke all on function public.atlas_unsnooze_triage_on_comment() from public;
revoke all on function public.atlas_reject_workflow_history_mutation() from public;
revoke all on function public.atlas_reject_workflow_delete() from public;

do $migration$
declare
  function_signature text;
  role_name text;
begin
  foreach function_signature in array array[
    'public.enter_atlas_triage_action(text,text,text,text)',
    'public.configure_atlas_workflow_status(uuid,uuid,text,text,text,text,text,text,integer,boolean,text,bigint)',
    'public.archive_atlas_workflow_status(uuid,uuid,text,bigint)',
    'public.reorder_atlas_workflow_statuses(uuid,uuid[],text)',
    'public.transition_atlas_triage_action(text,text,text,uuid,text,timestamptz,text,bigint)',
    'public.record_atlas_workflow_rule_run(uuid,text,text,text,jsonb,jsonb,jsonb,text,boolean)',
    'public.apply_atlas_inactivity_action(uuid,text,text,timestamptz,text,text)'
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

comment on table public.atlas_workflows is
  'Business-scoped ordered action workflows with archived history.';
comment on table public.atlas_triage_entries is
  'Revisioned Triage inbox records for explicit accept, decline, duplicate, and snooze decisions.';
comment on table public.atlas_workflow_rules is
  'Owner-activated deterministic rules whose effects cannot cross Atlas terminal or external approval boundaries.';
comment on function public.record_atlas_workflow_rule_run(uuid, text, text, text, jsonb, jsonb, jsonb, text, boolean) is
  'Records a preview or idempotently applies an already evaluated safe workflow-rule effect set.';
