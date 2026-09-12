-- Atlas Media daily guidance: capacity-aware windows, bounded Twitter, and audited YouTube staging.

alter table public.atlas_media_plan_items
  add column if not exists eligible_from timestamptz,
  add column if not exists eligible_until timestamptz,
  add column if not exists window_group text;

alter table public.atlas_media_plan_items drop constraint if exists atlas_media_plan_items_window_group_check;
alter table public.atlas_media_plan_items add constraint atlas_media_plan_items_window_group_check
  check (window_group is null or window_group in ('morning','later','reset')) not valid;

create or replace function public.atlas_media_window_bounds(p_planned_date date,p_trigger_kind text)
returns table(eligible_from timestamptz,eligible_until timestamptz,window_group text)
language plpgsql immutable set search_path='' as $function$
declare start_hour integer; start_minute integer:=0; end_hour integer; resolved_group text;
begin
  if p_trigger_kind='after_work_reset' or p_planned_date is null then
    return query select null::timestamptz,null::timestamptz,'reset'::text; return;
  end if;
  case p_trigger_kind
    when 'weekday_morning' then start_hour:=5;start_minute:=30;end_hour:=9;resolved_group:='morning';
    when 'daytime_transition_1' then start_hour:=11;start_minute:=30;end_hour:=14;resolved_group:='later';
    when 'daytime_transition_2' then start_hour:=15;end_hour:=18;resolved_group:='later';
    when 'saturday_walk' then start_hour:=9;end_hour:=16;resolved_group:='later';
    when 'sunday_faith' then start_hour:=7;end_hour:=12;resolved_group:='morning';
    when 'sunday_restoration' then start_hour:=12;end_hour:=20;resolved_group:='later';
    when 'flex' then start_hour:=18;end_hour:=22;resolved_group:='later';
    else raise exception using errcode='22023',message='ATLAS_MEDIA_TRIGGER_INVALID';
  end case;
  return query select
    make_timestamptz(extract(year from p_planned_date)::integer,extract(month from p_planned_date)::integer,extract(day from p_planned_date)::integer,start_hour,start_minute,0,'America/Los_Angeles'),
    make_timestamptz(extract(year from p_planned_date)::integer,extract(month from p_planned_date)::integer,extract(day from p_planned_date)::integer,end_hour,0,0,'America/Los_Angeles'),
    resolved_group;
end
$function$;

with resolved as (
  select item.id,bounds.eligible_from,bounds.eligible_until,bounds.window_group
  from public.atlas_media_plan_items item
  cross join lateral public.atlas_media_window_bounds(item.planned_date,item.trigger_kind) bounds
  where item.eligible_from is null or item.eligible_until is null or item.window_group is null
)
update public.atlas_media_plan_items item set
  eligible_from=resolved.eligible_from,eligible_until=resolved.eligible_until,window_group=resolved.window_group
from resolved where resolved.id=item.id;

with ranked as (
  select item.id,row_number() over(partition by item.media_plan_id,item.planned_date order by item.rank,item.created_at) as daily_rank
  from public.atlas_media_plan_items item join public.atlas_media_plans plan on plan.id=item.media_plan_id
  where plan.capacity_class in ('recovery','unknown') and item.item_type='consumable' and item.status='queued'
)
update public.atlas_media_plan_items item set status='removed',status_changed_at=timezone('utc',now()),revision=revision+1,
  updated_by='system',updated_at=timezone('utc',now())
from ranked where ranked.id=item.id and ranked.daily_rank>1;

alter table public.atlas_media_plan_items validate constraint atlas_media_plan_items_window_group_check;

create or replace function public.atlas_validate_media_daily_window()
returns trigger language plpgsql set search_path='' as $function$
declare plan_row public.atlas_media_plans%rowtype; same_day integer; same_group integer; daily_limit integer;
begin
  select * into plan_row from public.atlas_media_plans where id=new.media_plan_id;
  if new.item_type='reset' then
    if new.eligible_from is not null or new.eligible_until is not null or new.window_group<>'reset' then raise exception using errcode='22023',message='ATLAS_MEDIA_RESET_WINDOW_INVALID'; end if;
    return new;
  end if;
  if new.planned_date is null or new.eligible_from is null or new.eligible_until is null or new.window_group not in ('morning','later') then raise exception using errcode='22023',message='ATLAS_MEDIA_WINDOW_REQUIRED'; end if;
  if new.eligible_from>=new.eligible_until or (new.eligible_from at time zone 'America/Los_Angeles')::date<>new.planned_date or (new.eligible_until at time zone 'America/Los_Angeles')::date<>new.planned_date then raise exception using errcode='22023',message='ATLAS_MEDIA_WINDOW_INVALID'; end if;
  if new.status='removed' then return new; end if;
  daily_limit:=case when plan_row.capacity_class in ('standard','expansion') then 2 else 1 end;
  select count(*) into same_day from public.atlas_media_plan_items where media_plan_id=new.media_plan_id and item_type='consumable' and status<>'removed' and planned_date=new.planned_date and id<>new.id;
  if same_day>=daily_limit then raise exception using errcode='22023',message='ATLAS_MEDIA_DAILY_CAP'; end if;
  select count(*) into same_group from public.atlas_media_plan_items where media_plan_id=new.media_plan_id and item_type='consumable' and status<>'removed' and planned_date=new.planned_date and window_group=new.window_group and id<>new.id;
  if same_group>0 then raise exception using errcode='22023',message='ATLAS_MEDIA_DAILY_WINDOW_DUPLICATE'; end if;
  return new;
end
$function$;

drop trigger if exists atlas_media_plan_items_validate_window on public.atlas_media_plan_items;
create trigger atlas_media_plan_items_validate_window before insert or update of media_plan_id,item_type,planned_date,eligible_from,eligible_until,window_group,status
on public.atlas_media_plan_items for each row execute function public.atlas_validate_media_daily_window();

create table if not exists public.atlas_media_daily_allowances (
  id uuid primary key default gen_random_uuid(),
  allowance_date date not null unique,
  twitter_started_at timestamptz not null,
  twitter_expires_at timestamptz not null,
  revision bigint not null default 1 check(revision>=1),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  check(twitter_expires_at=twitter_started_at+interval '15 minutes')
);

create table if not exists public.atlas_media_daily_allowance_activity (
  id bigint generated always as identity primary key,
  allowance_id uuid not null references public.atlas_media_daily_allowances(id) on delete restrict,
  allowance_date date not null,
  event text not null check(event in ('twitter_started')),
  actor text not null,
  idempotency_key text not null unique,
  details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
  created_at timestamptz not null default timezone('utc',now())
);

create table if not exists public.atlas_media_external_sync_runs (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  provider text not null check(provider in ('youtube')),
  account_key text not null check(length(btrim(account_key)) between 1 and 100),
  playlist_title text not null check(length(btrim(playlist_title)) between 1 and 200),
  source_fingerprint text not null,
  mode text not null default 'dry_run' check(mode in ('dry_run','apply')),
  status text not null default 'prepared' check(status in ('prepared','applied','partial','failed')),
  manifest jsonb not null check(jsonb_typeof(manifest)='object'),
  approval_hash text,
  actor text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc',now())
);

create table if not exists public.atlas_media_external_sync_items (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references public.atlas_media_external_sync_runs(id) on delete restrict,
  media_item_id uuid,
  operation text not null check(operation in ('add','remove')),
  video_id text not null check(length(btrim(video_id)) between 1 and 100),
  playlist_item_id text,
  status text not null default 'planned' check(status in ('planned','applied','failed')),
  details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
  created_at timestamptz not null default timezone('utc',now())
);

create or replace function public.atlas_reject_media_allowance_activity_mutation()
returns trigger language plpgsql set search_path='' as $function$ begin raise exception using errcode='55000',message='ATLAS_MEDIA_ALLOWANCE_ACTIVITY_IMMUTABLE'; end $function$;
create or replace function public.atlas_reject_media_sync_mutation()
returns trigger language plpgsql set search_path='' as $function$ begin raise exception using errcode='55000',message='ATLAS_MEDIA_SYNC_IMMUTABLE'; end $function$;

drop trigger if exists atlas_media_allowance_activity_reject_mutation on public.atlas_media_daily_allowance_activity;
create trigger atlas_media_allowance_activity_reject_mutation before update or delete on public.atlas_media_daily_allowance_activity for each row execute function public.atlas_reject_media_allowance_activity_mutation();
drop trigger if exists atlas_media_allowances_reject_delete on public.atlas_media_daily_allowances;
create trigger atlas_media_allowances_reject_delete before delete on public.atlas_media_daily_allowances for each row execute function public.atlas_reject_immutable_delete();
drop trigger if exists atlas_media_sync_runs_reject_mutation on public.atlas_media_external_sync_runs;
create trigger atlas_media_sync_runs_reject_mutation before update or delete on public.atlas_media_external_sync_runs for each row execute function public.atlas_reject_media_sync_mutation();
drop trigger if exists atlas_media_sync_items_reject_mutation on public.atlas_media_external_sync_items;
create trigger atlas_media_sync_items_reject_mutation before update or delete on public.atlas_media_external_sync_items for each row execute function public.atlas_reject_media_sync_mutation();

create or replace function public.start_atlas_media_twitter_allowance_at(p_date date,p_actor text,p_idempotency_key text,p_expected_revision bigint,p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare row_value public.atlas_media_daily_allowances%rowtype; activity_row public.atlas_media_daily_allowance_activity%rowtype; local_time time; local_date date;
begin
  perform public.atlas_media_assert_actor(p_actor);
  if p_actor<>'ransomed' then raise exception using errcode='42501',message='ATLAS_MEDIA_TWITTER_OWNER_REQUIRED'; end if;
  if nullif(btrim(p_idempotency_key),'') is null then raise exception using errcode='22023',message='ATLAS_MEDIA_IDEMPOTENCY_KEY_INVALID'; end if;
  select * into activity_row from public.atlas_media_daily_allowance_activity where idempotency_key=p_idempotency_key;
  if found then select * into row_value from public.atlas_media_daily_allowances where id=activity_row.allowance_id; return jsonb_build_object('allowance',to_jsonb(row_value),'idempotent',true); end if;
  local_date:=(p_observed_at at time zone 'America/Los_Angeles')::date;local_time:=(p_observed_at at time zone 'America/Los_Angeles')::time;
  if p_date<>local_date or local_time<time '18:00' or local_time>=time '20:00' then raise exception using errcode='22023',message='ATLAS_MEDIA_TWITTER_WINDOW_CLOSED'; end if;
  select * into row_value from public.atlas_media_daily_allowances where allowance_date=p_date for update;
  if found then
    if p_expected_revision is not null and row_value.revision<>p_expected_revision then raise exception using errcode='40001',message='ATLAS_MEDIA_ALLOWANCE_REVISION_CONFLICT'; end if;
    raise exception using errcode='55000',message='ATLAS_MEDIA_TWITTER_ALREADY_USED';
  end if;
  insert into public.atlas_media_daily_allowances(allowance_date,twitter_started_at,twitter_expires_at,created_by,updated_by)
  values(p_date,p_observed_at,p_observed_at+interval '15 minutes',p_actor,p_actor) returning * into row_value;
  insert into public.atlas_media_daily_allowance_activity(allowance_id,allowance_date,event,actor,idempotency_key,details)
  values(row_value.id,p_date,'twitter_started',p_actor,p_idempotency_key,jsonb_build_object('expires_at',row_value.twitter_expires_at));
  return jsonb_build_object('allowance',to_jsonb(row_value),'idempotent',false);
end
$function$;

create or replace function public.start_atlas_media_twitter_allowance(p_date date,p_actor text,p_idempotency_key text,p_expected_revision bigint default null)
returns jsonb language sql security definer set search_path='' as $function$
  select public.start_atlas_media_twitter_allowance_at(p_date,p_actor,p_idempotency_key,p_expected_revision,timezone('utc',now()));
$function$;

create or replace function public.record_atlas_media_sync_manifest(p_week_start date,p_provider text,p_account_key text,p_playlist_title text,p_source_fingerprint text,p_manifest jsonb,p_actor text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare run_row public.atlas_media_external_sync_runs%rowtype; entry jsonb;
begin
  perform public.atlas_media_assert_actor(p_actor);
  select * into run_row from public.atlas_media_external_sync_runs where idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('run',to_jsonb(run_row),'idempotent',true); end if;
  if p_provider<>'youtube' or p_account_key<>'personal' or nullif(btrim(p_playlist_title),'') is null then raise exception using errcode='22023',message='ATLAS_MEDIA_SYNC_TARGET_INVALID'; end if;
  if nullif(btrim(p_source_fingerprint),'') is null or jsonb_typeof(p_manifest)<>'object' then raise exception using errcode='22023',message='ATLAS_MEDIA_SYNC_MANIFEST_INVALID'; end if;
  if jsonb_typeof(coalesce(p_manifest->'additions','[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_manifest->'removals','[]'::jsonb))<>'array' then raise exception using errcode='22023',message='ATLAS_MEDIA_SYNC_MANIFEST_INVALID'; end if;
  insert into public.atlas_media_external_sync_runs(week_start,provider,account_key,playlist_title,source_fingerprint,mode,status,manifest,actor,idempotency_key)
  values(p_week_start,p_provider,p_account_key,p_playlist_title,p_source_fingerprint,'dry_run','prepared',p_manifest,p_actor,p_idempotency_key) returning * into run_row;
  for entry in select * from jsonb_array_elements(coalesce(p_manifest->'additions','[]'::jsonb)) loop
    insert into public.atlas_media_external_sync_items(sync_run_id,media_item_id,operation,video_id,playlist_item_id,status,details)
    values(run_row.id,nullif(entry->>'media_item_id','')::uuid,'add',entry->>'video_id',null,'planned',entry);
  end loop;
  for entry in select * from jsonb_array_elements(coalesce(p_manifest->'removals','[]'::jsonb)) loop
    insert into public.atlas_media_external_sync_items(sync_run_id,media_item_id,operation,video_id,playlist_item_id,status,details)
    values(run_row.id,nullif(entry->>'media_item_id','')::uuid,'remove',entry->>'video_id',nullif(entry->>'playlist_item_id',''),'planned',entry);
  end loop;
  return jsonb_build_object('run',to_jsonb(run_row),'idempotent',false);
end
$function$;

create or replace function public.upsert_atlas_media_plan(
  p_week_start date,p_weekly_revision_id uuid,p_capacity_class text,p_source_status text,
  p_source_fingerprint text,p_items jsonb,p_actor text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare plan_row public.atlas_media_plans%rowtype; existing_activity public.atlas_media_plan_activity%rowtype;
  item jsonb; existing_item public.atlas_media_plan_items%rowtype; item_keys text[]:=array[]::text[];
  item_ranks integer[]:=array[]::integer[]; reset_count integer:=0; event_name text; payload_count integer;
  item_date date; bounds record;
begin
  perform public.atlas_media_assert_actor(p_actor);
  if nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>256 then raise exception using errcode='22023',message='ATLAS_MEDIA_IDEMPOTENCY_KEY_INVALID'; end if;
  select * into existing_activity from public.atlas_media_plan_activity where idempotency_key=p_idempotency_key;
  if found then select * into plan_row from public.atlas_media_plans where id=existing_activity.media_plan_id; return jsonb_build_object('plan',to_jsonb(plan_row),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.rank),'[]'::jsonb) from public.atlas_media_plan_items i where i.media_plan_id=plan_row.id and i.status<>'removed'),'idempotent',true); end if;
  if extract(isodow from p_week_start)<>1 then raise exception using errcode='22023',message='ATLAS_MEDIA_PLAN_MONDAY_REQUIRED'; end if;
  if p_capacity_class not in ('recovery','standard','expansion','unknown') then raise exception using errcode='22023',message='ATLAS_MEDIA_CAPACITY_INVALID'; end if;
  if p_source_status not in ('complete','partial','unavailable') then raise exception using errcode='22023',message='ATLAS_MEDIA_SOURCE_STATUS_INVALID'; end if;
  if nullif(btrim(p_source_fingerprint),'') is null or length(p_source_fingerprint)>500 then raise exception using errcode='22023',message='ATLAS_MEDIA_FINGERPRINT_INVALID'; end if;
  if jsonb_typeof(p_items)<>'array' then raise exception using errcode='22023',message='ATLAS_MEDIA_ITEMS_INVALID'; end if;
  payload_count:=jsonb_array_length(p_items);if payload_count<1 or payload_count>7 then raise exception using errcode='22023',message='ATLAS_MEDIA_PLAN_ITEM_LIMIT'; end if;
  if p_weekly_revision_id is not null and not exists(select 1 from public.atlas_weekly_plan_revisions where id=p_weekly_revision_id and week_start=p_week_start) then raise exception using errcode='23503',message='ATLAS_MEDIA_WEEKLY_REVISION_INVALID'; end if;
  for item in select * from jsonb_array_elements(p_items) loop
    perform public.atlas_media_validate_item(item,p_week_start);
    if (item->>'source_key')=any(item_keys) then raise exception using errcode='22023',message='ATLAS_MEDIA_SOURCE_KEY_DUPLICATE'; end if;
    if (item->>'rank')::integer=any(item_ranks) then raise exception using errcode='22023',message='ATLAS_MEDIA_RANK_DUPLICATE'; end if;
    item_keys:=array_append(item_keys,item->>'source_key');item_ranks:=array_append(item_ranks,(item->>'rank')::integer);
    if item->>'item_type'='reset' then reset_count:=reset_count+1; elsif nullif(item->>'planned_date','') is null then raise exception using errcode='22023',message='ATLAS_MEDIA_WINDOW_REQUIRED'; end if;
  end loop;
  if reset_count>1 then raise exception using errcode='22023',message='ATLAS_MEDIA_PLAN_RESET_LIMIT'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) value where value->>'item_type'='consumable' group by (value->>'planned_date')::date having count(*)>case when p_capacity_class in ('standard','expansion') then 2 else 1 end) then raise exception using errcode='22023',message='ATLAS_MEDIA_DAILY_CAP'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) value where value->>'item_type'='consumable' group by (value->>'planned_date')::date,case when value->>'trigger_kind' in ('weekday_morning','sunday_faith') then 'morning' else 'later' end having count(*)>1) then raise exception using errcode='22023',message='ATLAS_MEDIA_DAILY_WINDOW_DUPLICATE'; end if;
  select * into plan_row from public.atlas_media_plans where week_start=p_week_start for update;
  if found then update public.atlas_media_plans set weekly_revision_id=p_weekly_revision_id,capacity_class=p_capacity_class,source_status=p_source_status,source_fingerprint=p_source_fingerprint,status='active',revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now()) where id=plan_row.id returning * into plan_row;event_name:='plan_refreshed';
  else insert into public.atlas_media_plans(week_start,weekly_revision_id,capacity_class,source_status,source_fingerprint,created_by,updated_by) values(p_week_start,p_weekly_revision_id,p_capacity_class,p_source_status,p_source_fingerprint,p_actor,p_actor) returning * into plan_row;event_name:='plan_created';end if;
  update public.atlas_media_plan_items set status='removed',status_changed_at=timezone('utc',now()),revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now()) where media_plan_id=plan_row.id and status='queued' and not(source_key=any(item_keys));
  for item in select * from jsonb_array_elements(p_items) order by (value->>'rank')::integer loop
    item_date:=nullif(item->>'planned_date','')::date;select * into bounds from public.atlas_media_window_bounds(item_date,item->>'trigger_kind');
    select * into existing_item from public.atlas_media_plan_items where media_plan_id=plan_row.id and source_key=item->>'source_key' for update;
    if found then update public.atlas_media_plan_items set platform=item->>'platform',category=item->>'category',item_type=item->>'item_type',title=item->>'title',creator=coalesce(item->>'creator',''),source_url=nullif(item->>'source_url',''),duration_minutes=nullif(item->>'duration_minutes','')::integer,planned_date=item_date,trigger_kind=item->>'trigger_kind',purpose=coalesce(item->>'purpose',''),rank=(item->>'rank')::integer,eligible_from=bounds.eligible_from,eligible_until=bounds.eligible_until,window_group=bounds.window_group,status=case when status in ('done','later','skipped') then status else 'queued' end,revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now()) where id=existing_item.id;
    else insert into public.atlas_media_plan_items(media_plan_id,source_key,platform,category,item_type,title,creator,source_url,duration_minutes,planned_date,trigger_kind,purpose,rank,eligible_from,eligible_until,window_group,created_by,updated_by) values(plan_row.id,item->>'source_key',item->>'platform',item->>'category',item->>'item_type',item->>'title',coalesce(item->>'creator',''),nullif(item->>'source_url',''),nullif(item->>'duration_minutes','')::integer,item_date,item->>'trigger_kind',coalesce(item->>'purpose',''),(item->>'rank')::integer,bounds.eligible_from,bounds.eligible_until,bounds.window_group,p_actor,p_actor);end if;
  end loop;
  insert into public.atlas_media_plan_activity(media_plan_id,week_start,event,actor,idempotency_key,revision,details) values(plan_row.id,p_week_start,event_name,p_actor,p_idempotency_key,plan_row.revision,jsonb_build_object('source_fingerprint',p_source_fingerprint,'item_count',payload_count,'source_status',p_source_status));
  return jsonb_build_object('plan',to_jsonb(plan_row),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.rank),'[]'::jsonb) from public.atlas_media_plan_items i where i.media_plan_id=plan_row.id and i.status<>'removed'),'idempotent',false);
end
$function$;

alter table public.atlas_media_daily_allowances enable row level security;
alter table public.atlas_media_daily_allowance_activity enable row level security;
alter table public.atlas_media_external_sync_runs enable row level security;
alter table public.atlas_media_external_sync_items enable row level security;
revoke all on table public.atlas_media_daily_allowances,public.atlas_media_daily_allowance_activity,public.atlas_media_external_sync_runs,public.atlas_media_external_sync_items from public;
revoke all on function public.atlas_media_window_bounds(date,text) from public;
revoke all on function public.start_atlas_media_twitter_allowance_at(date,text,text,bigint,timestamptz) from public;
revoke all on function public.start_atlas_media_twitter_allowance(date,text,text,bigint) from public;
revoke all on function public.record_atlas_media_sync_manifest(date,text,text,text,text,jsonb,text,text) from public;

do $block$
begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant select,insert,update on public.atlas_media_daily_allowances to service_role;
    grant select,insert on public.atlas_media_daily_allowance_activity,public.atlas_media_external_sync_runs,public.atlas_media_external_sync_items to service_role;
    grant usage,select on sequence public.atlas_media_daily_allowance_activity_id_seq to service_role;
    revoke delete,truncate on public.atlas_media_daily_allowances,public.atlas_media_daily_allowance_activity,public.atlas_media_external_sync_runs,public.atlas_media_external_sync_items from service_role;
    revoke update on public.atlas_media_daily_allowance_activity,public.atlas_media_external_sync_runs,public.atlas_media_external_sync_items from service_role;
    grant execute on function public.start_atlas_media_twitter_allowance(date,text,text,bigint) to service_role;
    grant execute on function public.record_atlas_media_sync_manifest(date,text,text,text,text,jsonb,text,text) to service_role;
    grant execute on function public.upsert_atlas_media_plan(date,uuid,text,text,text,jsonb,text,text) to service_role;
  end if;
end
$block$;
