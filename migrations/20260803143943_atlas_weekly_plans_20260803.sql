-- Atlas Weekly Plan: versioned, Pacific-time weekly planning with immutable publication.

create table if not exists public.atlas_weekly_plan_revisions (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  version integer not null,
  status text not null default 'draft' check (status in ('draft', 'review_requested', 'published', 'superseded')),
  title text not null default '',
  summary text not null default '',
  source_coverage jsonb not null default '{}'::jsonb,
  source_fingerprint text,
  calendar_acknowledged boolean not null default false,
  revision bigint not null default 0,
  created_by text not null default 'system',
  updated_by text not null default 'system',
  published_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  published_at timestamptz,
  unique (week_start, version),
  check (extract(isodow from week_start) = 1)
);

create unique index if not exists atlas_weekly_active_draft_idx
  on public.atlas_weekly_plan_revisions (week_start)
  where status in ('draft', 'review_requested');

create unique index if not exists atlas_weekly_current_publication_idx
  on public.atlas_weekly_plan_revisions (week_start)
  where status = 'published';

create index if not exists atlas_weekly_revisions_week_idx
  on public.atlas_weekly_plan_revisions (week_start, version desc);

create table if not exists public.atlas_weekly_plan_items (
  id uuid primary key default gen_random_uuid(),
  weekly_revision_id uuid not null references public.atlas_weekly_plan_revisions(id) on delete cascade,
  kind text not null check (kind in ('must_win', 'day_focus', 'risk', 'deferred', 'carryover', 'context')),
  plan_date date,
  rank integer not null default 0,
  source_action_id text references public.atlas_actions(id),
  title text not null,
  notes text not null default '',
  rationale text not null default '',
  action_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (
    (kind in ('must_win', 'day_focus', 'deferred', 'carryover') and source_action_id is not null)
    or kind in ('risk', 'context')
  )
);

create or replace function public.validate_atlas_weekly_plan_item_date()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  week_start date;
begin
  select r.week_start into week_start
  from public.atlas_weekly_plan_revisions r
  where r.id = new.weekly_revision_id;
  if week_start is null then raise exception using errcode = '23503', message = 'ATLAS_WEEKLY_REVISION_NOT_FOUND'; end if;
  if new.plan_date is not null and (new.plan_date < week_start or new.plan_date >= week_start + 7) then
    raise exception using errcode = '22023', message = 'ATLAS_WEEKLY_DATE_OUT_OF_RANGE';
  end if;
  return new;
end
$function$;

drop trigger if exists atlas_weekly_plan_item_date_trigger on public.atlas_weekly_plan_items;
create trigger atlas_weekly_plan_item_date_trigger
before insert or update on public.atlas_weekly_plan_items
for each row execute function public.validate_atlas_weekly_plan_item_date();

create unique index if not exists atlas_weekly_item_action_day_idx
  on public.atlas_weekly_plan_items (
    weekly_revision_id,
    source_action_id,
    coalesce(plan_date, date '9999-12-31')
  )
  where source_action_id is not null;

create index if not exists atlas_weekly_items_revision_idx
  on public.atlas_weekly_plan_items (weekly_revision_id, plan_date, rank);

create table if not exists public.atlas_weekly_plan_commitments (
  id uuid primary key default gen_random_uuid(),
  weekly_revision_id uuid not null references public.atlas_weekly_plan_revisions(id) on delete cascade,
  source_ref text not null,
  source_label text not null default 'calendar',
  title text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean not null default false,
  captured_at timestamptz not null default timezone('utc', now()),
  source_as_of timestamptz,
  coverage_status text not null default 'complete' check (coverage_status in ('complete', 'partial', 'stale', 'unavailable')),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists atlas_weekly_commitments_revision_idx
  on public.atlas_weekly_plan_commitments (weekly_revision_id, starts_at);

create table if not exists public.atlas_weekly_plan_activity (
  id bigint generated always as identity primary key,
  weekly_revision_id uuid references public.atlas_weekly_plan_revisions(id),
  week_start date not null,
  event text not null check (event in ('created', 'saved', 'review_requested', 'published', 'superseded', 'forked', 'refresh_available')),
  actor text not null,
  idempotency_key text,
  revision bigint,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (idempotency_key)
);

create index if not exists atlas_weekly_activity_week_idx
  on public.atlas_weekly_plan_activity (week_start, created_at desc);

alter table public.atlas_daily_plans
  add column if not exists source_weekly_revision_id uuid references public.atlas_weekly_plan_revisions(id),
  add column if not exists weekly_deviation_reason text;

alter table public.atlas_daily_plan_items
  add column if not exists source_weekly_item_id uuid references public.atlas_weekly_plan_items(id);

create or replace function public.atlas_weekly_assert_actor(p_actor text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_actor is null or p_actor not in ('ransomed', 'codex', 'claude', 'system') then
    raise exception using errcode = '22023', message = 'ATLAS_WEEKLY_ACTOR_NOT_ALLOWED';
  end if;
end
$function$;

create or replace function public.create_atlas_weekly_plan_draft(
  p_week_start date,
  p_title text default '',
  p_summary text default '',
  p_source_coverage jsonb default '{}'::jsonb,
  p_source_fingerprint text default null,
  p_actor text default 'system',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_row public.atlas_weekly_plan_revisions%rowtype;
  new_row public.atlas_weekly_plan_revisions%rowtype;
  next_version integer;
begin
  perform public.atlas_weekly_assert_actor(p_actor);
  if extract(isodow from p_week_start) <> 1 then
    raise exception using errcode = '22023', message = 'ATLAS_WEEKLY_MONDAY_REQUIRED';
  end if;

  if p_idempotency_key is not null then
    select r.* into existing_row
    from public.atlas_weekly_plan_activity a
    join public.atlas_weekly_plan_revisions r on r.id = a.weekly_revision_id
    where a.idempotency_key = p_idempotency_key;
    if found then return jsonb_build_object('revision', to_jsonb(existing_row), 'idempotent', true); end if;
  end if;

  select * into existing_row
  from public.atlas_weekly_plan_revisions
  where week_start = p_week_start and status in ('draft', 'review_requested')
  for update;
  if found then
    if existing_row.source_fingerprint is distinct from p_source_fingerprint
       and existing_row.status = 'draft'
       and existing_row.revision = 0
    then
      update public.atlas_weekly_plan_revisions
      set title = coalesce(nullif(p_title, ''), title),
          summary = coalesce(nullif(p_summary, ''), summary),
          source_coverage = coalesce(p_source_coverage, source_coverage),
          source_fingerprint = p_source_fingerprint,
          updated_at = timezone('utc', now())
      where id = existing_row.id
      returning * into existing_row;
    else
      insert into public.atlas_weekly_plan_activity (weekly_revision_id, week_start, event, actor, details)
      values (existing_row.id, p_week_start, 'refresh_available', p_actor,
        jsonb_build_object('source_fingerprint', p_source_fingerprint));
    end if;
    return jsonb_build_object('revision', to_jsonb(existing_row), 'existing', true);
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.atlas_weekly_plan_revisions where week_start = p_week_start;
  insert into public.atlas_weekly_plan_revisions (
    week_start, version, title, summary, source_coverage, source_fingerprint, created_by, updated_by
  ) values (
    p_week_start, next_version, coalesce(p_title, ''), coalesce(p_summary, ''), coalesce(p_source_coverage, '{}'::jsonb),
    p_source_fingerprint, p_actor, p_actor
  ) returning * into new_row;
  insert into public.atlas_weekly_plan_activity (weekly_revision_id, week_start, event, actor, idempotency_key, revision)
  values (new_row.id, p_week_start, 'created', p_actor, p_idempotency_key, new_row.revision);
  return jsonb_build_object('revision', to_jsonb(new_row), 'created', true);
end
$function$;

create or replace function public.save_atlas_weekly_plan_revision(
  p_revision_id uuid,
  p_expected_revision bigint,
  p_payload jsonb,
  p_actor text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  revision_row public.atlas_weekly_plan_revisions%rowtype;
  item jsonb;
  commitment jsonb;
  new_revision bigint;
begin
  perform public.atlas_weekly_assert_actor(p_actor);
  if p_idempotency_key is not null then
    select r.* into revision_row
    from public.atlas_weekly_plan_activity a
    join public.atlas_weekly_plan_revisions r on r.id = a.weekly_revision_id
    where a.idempotency_key = p_idempotency_key;
    if found then return jsonb_build_object('revision', to_jsonb(revision_row), 'idempotent', true); end if;
  end if;
  select * into revision_row from public.atlas_weekly_plan_revisions where id = p_revision_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ATLAS_WEEKLY_NOT_FOUND'; end if;
  if revision_row.status not in ('draft', 'review_requested') then
    raise exception using errcode = '22023', message = 'ATLAS_WEEKLY_IMMUTABLE';
  end if;
  if p_expected_revision is not null and revision_row.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'ATLAS_WEEKLY_REVISION_CONFLICT';
  end if;

  delete from public.atlas_weekly_plan_items where weekly_revision_id = p_revision_id;
  delete from public.atlas_weekly_plan_commitments where weekly_revision_id = p_revision_id;

  for item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) loop
    insert into public.atlas_weekly_plan_items (
      weekly_revision_id, kind, plan_date, rank, source_action_id, title, notes, rationale
    ) values (
      p_revision_id,
      item->>'kind',
      nullif(item->>'plan_date', '')::date,
      coalesce(nullif(item->>'rank', '')::integer, 0),
      nullif(item->>'source_action_id', ''),
      coalesce(item->>'title', ''),
      coalesce(item->>'notes', ''),
      coalesce(item->>'rationale', '')
    );
  end loop;

  for commitment in select * from jsonb_array_elements(coalesce(p_payload->'commitments', '[]'::jsonb)) loop
    insert into public.atlas_weekly_plan_commitments (
      weekly_revision_id, source_ref, source_label, title, starts_at, ends_at, all_day, captured_at, source_as_of, coverage_status
    ) values (
      p_revision_id,
      coalesce(commitment->>'source_ref', md5(random()::text || clock_timestamp()::text)),
      coalesce(commitment->>'source_label', 'calendar'),
      coalesce(commitment->>'title', ''),
      nullif(commitment->>'starts_at', '')::timestamptz,
      nullif(commitment->>'ends_at', '')::timestamptz,
      coalesce((commitment->>'all_day')::boolean, false),
      coalesce(nullif(commitment->>'captured_at', '')::timestamptz, timezone('utc', now())),
      nullif(commitment->>'source_as_of', '')::timestamptz,
      coalesce(commitment->>'coverage_status', 'complete')
    );
  end loop;

  new_revision := revision_row.revision + 1;
  update public.atlas_weekly_plan_revisions
  set title = coalesce(p_payload->>'title', title),
      summary = coalesce(p_payload->>'summary', summary),
      source_coverage = coalesce(p_payload->'source_coverage', source_coverage),
      calendar_acknowledged = coalesce((p_payload->>'calendar_acknowledged')::boolean, calendar_acknowledged),
      status = case when status = 'review_requested' then 'draft' else status end,
      revision = new_revision,
      updated_by = p_actor,
      updated_at = timezone('utc', now())
  where id = p_revision_id
  returning * into revision_row;

  insert into public.atlas_weekly_plan_activity (weekly_revision_id, week_start, event, actor, idempotency_key, revision)
  values (p_revision_id, revision_row.week_start, 'saved', p_actor, p_idempotency_key, new_revision);
  return jsonb_build_object('revision', to_jsonb(revision_row), 'revision_number', new_revision);
end
$function$;

create or replace function public.request_atlas_weekly_plan_review(
  p_revision_id uuid,
  p_expected_revision bigint,
  p_actor text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  revision_row public.atlas_weekly_plan_revisions%rowtype;
begin
  perform public.atlas_weekly_assert_actor(p_actor);
  if p_idempotency_key is not null then
    select r.* into revision_row
    from public.atlas_weekly_plan_activity a
    join public.atlas_weekly_plan_revisions r on r.id = a.weekly_revision_id
    where a.idempotency_key = p_idempotency_key;
    if found then return jsonb_build_object('revision', to_jsonb(revision_row), 'idempotent', true); end if;
  end if;
  select * into revision_row from public.atlas_weekly_plan_revisions where id = p_revision_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ATLAS_WEEKLY_NOT_FOUND'; end if;
  if revision_row.status <> 'draft' then raise exception using errcode = '22023', message = 'ATLAS_WEEKLY_REVIEW_INVALID'; end if;
  if p_expected_revision is not null and revision_row.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'ATLAS_WEEKLY_REVISION_CONFLICT';
  end if;
  update public.atlas_weekly_plan_revisions
  set status = 'review_requested', revision = revision + 1, updated_by = p_actor, updated_at = timezone('utc', now())
  where id = p_revision_id returning * into revision_row;
  insert into public.atlas_weekly_plan_activity (weekly_revision_id, week_start, event, actor, idempotency_key, revision)
  values (p_revision_id, revision_row.week_start, 'review_requested', p_actor, p_idempotency_key, revision_row.revision);
  return jsonb_build_object('revision', to_jsonb(revision_row));
end
$function$;

create or replace function public.publish_atlas_weekly_plan(
  p_revision_id uuid,
  p_expected_revision bigint,
  p_actor text,
  p_calendar_acknowledged boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  revision_row public.atlas_weekly_plan_revisions%rowtype;
  old_id uuid;
  calendar_needs_ack boolean;
begin
  perform public.atlas_weekly_assert_actor(p_actor);
  if p_actor <> 'ransomed' then raise exception using errcode = '42501', message = 'ATLAS_WEEKLY_OWNER_REQUIRED'; end if;
  if p_idempotency_key is not null then
    select r.* into revision_row
    from public.atlas_weekly_plan_activity a
    join public.atlas_weekly_plan_revisions r on r.id = a.weekly_revision_id
    where a.idempotency_key = p_idempotency_key;
    if found then return jsonb_build_object('revision', to_jsonb(revision_row), 'idempotent', true); end if;
  end if;
  select * into revision_row from public.atlas_weekly_plan_revisions where id = p_revision_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ATLAS_WEEKLY_NOT_FOUND'; end if;
  if revision_row.status <> 'review_requested' then raise exception using errcode = '22023', message = 'ATLAS_WEEKLY_PUBLISH_INVALID'; end if;
  if p_expected_revision is not null and revision_row.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'ATLAS_WEEKLY_REVISION_CONFLICT';
  end if;
  select exists (
    select 1 from public.atlas_weekly_plan_commitments
    where weekly_revision_id = p_revision_id and coverage_status in ('stale', 'partial', 'unavailable')
  ) into calendar_needs_ack;
  calendar_needs_ack := calendar_needs_ack
    or coalesce(revision_row.source_coverage->'calendar'->>'status', '') in ('stale', 'partial', 'unavailable');
  if calendar_needs_ack and not p_calendar_acknowledged then
    raise exception using errcode = '22023', message = 'ATLAS_WEEKLY_CALENDAR_ACK_REQUIRED';
  end if;

  update public.atlas_weekly_plan_revisions
  set status = 'superseded', updated_at = timezone('utc', now())
  where week_start = revision_row.week_start and status = 'published'
  returning id into old_id;

  update public.atlas_weekly_plan_items i
  set action_snapshot = coalesce((select jsonb_build_object(
    'id', a.id, 'title', a.title, 'status', a.status, 'priority', a.priority, 'due_date', a.due_date,
    'business', a.business, 'owners', a.owners, 'completed_at', a.completed_at, 'revision', a.revision
  ) from public.atlas_actions a where a.id = i.source_action_id), i.action_snapshot)
  where i.weekly_revision_id = p_revision_id;

  update public.atlas_weekly_plan_revisions
  set status = 'published', published_by = p_actor, published_at = timezone('utc', now()),
      calendar_acknowledged = p_calendar_acknowledged, revision = revision + 1,
      updated_by = p_actor, updated_at = timezone('utc', now())
  where id = p_revision_id returning * into revision_row;
  insert into public.atlas_weekly_plan_activity (weekly_revision_id, week_start, event, actor, idempotency_key, revision, details)
  values (p_revision_id, revision_row.week_start, 'published', p_actor, p_idempotency_key, revision_row.revision,
    jsonb_build_object('superseded_revision_id', old_id));
  return jsonb_build_object('revision', to_jsonb(revision_row), 'superseded_revision_id', old_id);
end
$function$;

create or replace function public.fork_atlas_weekly_plan(
  p_revision_id uuid,
  p_actor text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  source_row public.atlas_weekly_plan_revisions%rowtype;
  new_row public.atlas_weekly_plan_revisions%rowtype;
  next_version integer;
begin
  perform public.atlas_weekly_assert_actor(p_actor);
  if p_idempotency_key is not null then
    select r.* into new_row
    from public.atlas_weekly_plan_activity a
    join public.atlas_weekly_plan_revisions r on r.id = a.weekly_revision_id
    where a.idempotency_key = p_idempotency_key;
    if found then return jsonb_build_object('revision', to_jsonb(new_row), 'idempotent', true); end if;
  end if;
  select * into source_row from public.atlas_weekly_plan_revisions where id = p_revision_id;
  if not found then raise exception using errcode = 'P0002', message = 'ATLAS_WEEKLY_NOT_FOUND'; end if;
  if source_row.status not in ('published', 'superseded') then raise exception using errcode = '22023', message = 'ATLAS_WEEKLY_FORK_INVALID'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.atlas_weekly_plan_revisions where week_start = source_row.week_start;
  insert into public.atlas_weekly_plan_revisions (
    week_start, version, title, summary, source_coverage, source_fingerprint, created_by, updated_by
  ) values (
    source_row.week_start, next_version, source_row.title, source_row.summary, source_row.source_coverage,
    source_row.source_fingerprint, p_actor, p_actor
  ) returning * into new_row;
  insert into public.atlas_weekly_plan_items (weekly_revision_id, kind, plan_date, rank, source_action_id, title, notes, rationale, action_snapshot)
    select new_row.id, kind, plan_date, rank, source_action_id, title, notes, rationale, action_snapshot
    from public.atlas_weekly_plan_items where weekly_revision_id = source_row.id;
  insert into public.atlas_weekly_plan_commitments (weekly_revision_id, source_ref, source_label, title, starts_at, ends_at, all_day, captured_at, source_as_of, coverage_status)
    select new_row.id, source_ref, source_label, title, starts_at, ends_at, all_day, captured_at, source_as_of, coverage_status
    from public.atlas_weekly_plan_commitments where weekly_revision_id = source_row.id;
  insert into public.atlas_weekly_plan_activity (weekly_revision_id, week_start, event, actor, idempotency_key, revision, details)
  values (new_row.id, new_row.week_start, 'forked', p_actor, p_idempotency_key, new_row.revision,
    jsonb_build_object('source_revision_id', source_row.id));
  return jsonb_build_object('revision', to_jsonb(new_row));
end
$function$;

revoke all on function public.atlas_weekly_assert_actor(text) from public;
revoke all on function public.create_atlas_weekly_plan_draft(date, text, text, jsonb, text, text, text) from public;
revoke all on function public.save_atlas_weekly_plan_revision(uuid, bigint, jsonb, text, text) from public;
revoke all on function public.request_atlas_weekly_plan_review(uuid, bigint, text, text) from public;
revoke all on function public.publish_atlas_weekly_plan(uuid, bigint, text, boolean, text) from public;
revoke all on function public.fork_atlas_weekly_plan(uuid, text, text) from public;

do $migration$
declare
  signature text;
begin
  foreach signature in array array[
    'public.atlas_weekly_assert_actor(text)',
    'public.create_atlas_weekly_plan_draft(date,text,text,jsonb,text,text,text)',
    'public.save_atlas_weekly_plan_revision(uuid,bigint,jsonb,text,text)',
    'public.request_atlas_weekly_plan_review(uuid,bigint,text,text)',
    'public.publish_atlas_weekly_plan(uuid,bigint,text,boolean,text)',
    'public.fork_atlas_weekly_plan(uuid,text,text)'
  ] loop
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', signature);
    end if;
  end loop;
end
$migration$;
