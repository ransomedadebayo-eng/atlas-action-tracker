-- Atlas Media Diet: structured, audited weekly curation without external queue writes.

create table if not exists public.atlas_media_plans (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  weekly_revision_id uuid references public.atlas_weekly_plan_revisions(id) on delete restrict,
  capacity_class text not null default 'unknown' check (capacity_class in ('recovery','standard','expansion','unknown')),
  source_status text not null default 'unavailable' check (source_status in ('complete','partial','unavailable')),
  source_fingerprint text not null,
  status text not null default 'active' check (status in ('active','archived')),
  revision bigint not null default 1 check (revision >= 1),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  check (extract(isodow from week_start)=1)
);

create table if not exists public.atlas_media_plan_items (
  id uuid primary key default gen_random_uuid(),
  media_plan_id uuid not null references public.atlas_media_plans(id) on delete restrict,
  source_key text not null,
  platform text not null check (platform in ('youtube','apple_podcasts','apple_music','other')),
  category text not null check (category in ('brief_news','faith_family_health','growth','music','leisure','reset')),
  item_type text not null check (item_type in ('consumable','reset')),
  title text not null check (length(btrim(title)) between 1 and 500),
  creator text not null default '' check (length(creator)<=500),
  source_url text check (source_url is null or source_url ~ '^https://'),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 600),
  planned_date date,
  trigger_kind text not null check (trigger_kind in ('weekday_morning','daytime_transition_1','daytime_transition_2','saturday_walk','sunday_faith','sunday_restoration','after_work_reset','flex')),
  purpose text not null default '' check (length(purpose)<=1000),
  rank integer not null check (rank between 0 and 6),
  status text not null default 'queued' check (status in ('queued','done','later','skipped','removed')),
  status_changed_at timestamptz,
  completed_at timestamptz,
  revision bigint not null default 1 check (revision>=1),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  unique(media_plan_id,source_key),
  check ((item_type='reset' and category='reset' and trigger_kind='after_work_reset') or (item_type='consumable' and category<>'reset'))
);

create unique index if not exists atlas_media_active_reset_idx
  on public.atlas_media_plan_items(media_plan_id)
  where item_type='reset' and status in ('queued','later');
create index if not exists atlas_media_items_plan_rank_idx
  on public.atlas_media_plan_items(media_plan_id,rank,created_at);
create index if not exists atlas_media_items_plan_status_idx
  on public.atlas_media_plan_items(media_plan_id,status,planned_date,rank);

create table if not exists public.atlas_media_plan_activity (
  id bigint generated always as identity primary key,
  media_plan_id uuid references public.atlas_media_plans(id) on delete restrict,
  item_id uuid references public.atlas_media_plan_items(id) on delete restrict,
  week_start date not null,
  event text not null check (event in ('plan_created','plan_refreshed','item_created','item_updated','item_status')),
  actor text not null,
  idempotency_key text unique,
  revision bigint,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
  created_at timestamptz not null default timezone('utc',now())
);
create index if not exists atlas_media_activity_week_idx on public.atlas_media_plan_activity(week_start,created_at desc);
create index if not exists atlas_media_activity_plan_idx on public.atlas_media_plan_activity(media_plan_id,created_at desc);

create or replace function public.atlas_reject_media_activity_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin
  raise exception using errcode='55000',message='ATLAS_MEDIA_ACTIVITY_IMMUTABLE';
end
$function$;

create or replace function public.atlas_validate_media_item_date()
returns trigger language plpgsql set search_path='' as $function$
declare plan_week date;
begin
  select week_start into plan_week from public.atlas_media_plans where id=new.media_plan_id;
  if plan_week is null then raise exception using errcode='23503',message='ATLAS_MEDIA_PLAN_NOT_FOUND'; end if;
  if new.planned_date is not null and (new.planned_date<plan_week or new.planned_date>=plan_week+7) then
    raise exception using errcode='22023',message='ATLAS_MEDIA_ITEM_DATE_OUT_OF_RANGE';
  end if;
  return new;
end
$function$;

create or replace function public.atlas_enforce_media_item_limit()
returns trigger language plpgsql set search_path='' as $function$
declare active_count integer;
begin
  if new.status not in ('queued','later') then return new; end if;
  select count(*) into active_count from public.atlas_media_plan_items
  where media_plan_id=new.media_plan_id and status in ('queued','later') and id<>new.id;
  if active_count>=7 then raise exception using errcode='22023',message='ATLAS_MEDIA_PLAN_ITEM_LIMIT'; end if;
  return new;
end
$function$;

create or replace function public.atlas_audit_media_item_row()
returns trigger language plpgsql security definer set search_path='' as $function$
declare plan_week date;
begin
  select week_start into plan_week from public.atlas_media_plans where id=new.media_plan_id;
  insert into public.atlas_media_plan_activity(media_plan_id,item_id,week_start,event,actor,revision,details)
  values(new.media_plan_id,new.id,plan_week,case when tg_op='INSERT' then 'item_created' else 'item_updated' end,new.updated_by,new.revision,
    jsonb_build_object('old_status',case when tg_op='UPDATE' then old.status else null end,'new_status',new.status,'source_key',new.source_key));
  return new;
end
$function$;

drop trigger if exists atlas_media_plans_reject_delete on public.atlas_media_plans;
create trigger atlas_media_plans_reject_delete before delete on public.atlas_media_plans for each row execute function public.atlas_reject_immutable_delete();
drop trigger if exists atlas_media_plan_items_reject_delete on public.atlas_media_plan_items;
create trigger atlas_media_plan_items_reject_delete before delete on public.atlas_media_plan_items for each row execute function public.atlas_reject_immutable_delete();
drop trigger if exists atlas_media_plan_activity_reject_mutation on public.atlas_media_plan_activity;
create trigger atlas_media_plan_activity_reject_mutation before update or delete on public.atlas_media_plan_activity for each row execute function public.atlas_reject_media_activity_mutation();
drop trigger if exists atlas_media_plan_items_validate_date on public.atlas_media_plan_items;
create trigger atlas_media_plan_items_validate_date before insert or update of media_plan_id,planned_date on public.atlas_media_plan_items for each row execute function public.atlas_validate_media_item_date();
drop trigger if exists atlas_media_plan_items_limit on public.atlas_media_plan_items;
create trigger atlas_media_plan_items_limit before insert or update of media_plan_id,status on public.atlas_media_plan_items for each row execute function public.atlas_enforce_media_item_limit();
drop trigger if exists atlas_media_plan_items_audit_row on public.atlas_media_plan_items;
create trigger atlas_media_plan_items_audit_row after insert or update on public.atlas_media_plan_items for each row execute function public.atlas_audit_media_item_row();

create or replace function public.atlas_media_assert_actor(p_actor text)
returns void language plpgsql security definer set search_path='' as $function$
begin
  if p_actor is null or p_actor not in ('ransomed','codex','claude','system') then
    raise exception using errcode='22023',message='ATLAS_MEDIA_ACTOR_NOT_ALLOWED';
  end if;
end
$function$;

create or replace function public.atlas_media_validate_item(p_item jsonb,p_week_start date)
returns void language plpgsql security definer set search_path='' as $function$
declare url text:=nullif(p_item->>'source_url',''); planned date;
begin
  if nullif(btrim(p_item->>'source_key'),'') is null or length(p_item->>'source_key')>500 then raise exception using errcode='22023',message='ATLAS_MEDIA_SOURCE_KEY_INVALID'; end if;
  if (p_item->>'platform') not in ('youtube','apple_podcasts','apple_music','other') then raise exception using errcode='22023',message='ATLAS_MEDIA_PLATFORM_INVALID'; end if;
  if (p_item->>'category') not in ('brief_news','faith_family_health','growth','music','leisure','reset') then raise exception using errcode='22023',message='ATLAS_MEDIA_CATEGORY_INVALID'; end if;
  if (p_item->>'item_type') not in ('consumable','reset') then raise exception using errcode='22023',message='ATLAS_MEDIA_ITEM_TYPE_INVALID'; end if;
  if ((p_item->>'item_type')='reset')<>(p_item->>'category'='reset') then raise exception using errcode='22023',message='ATLAS_MEDIA_RESET_INVALID'; end if;
  if (p_item->>'item_type')='reset' and (p_item->>'trigger_kind')<>'after_work_reset' then raise exception using errcode='22023',message='ATLAS_MEDIA_RESET_INVALID'; end if;
  if nullif(btrim(p_item->>'title'),'') is null or length(p_item->>'title')>500 then raise exception using errcode='22023',message='ATLAS_MEDIA_TITLE_INVALID'; end if;
  if length(coalesce(p_item->>'creator',''))>500 or length(coalesce(p_item->>'purpose',''))>1000 then raise exception using errcode='22023',message='ATLAS_MEDIA_TEXT_INVALID'; end if;
  if url is not null and url!~'^https://' then raise exception using errcode='22023',message='ATLAS_MEDIA_SOURCE_URL_INVALID'; end if;
  if (p_item->>'trigger_kind') not in ('weekday_morning','daytime_transition_1','daytime_transition_2','saturday_walk','sunday_faith','sunday_restoration','after_work_reset','flex') then raise exception using errcode='22023',message='ATLAS_MEDIA_TRIGGER_INVALID'; end if;
  if coalesce(p_item->>'rank','')!~'^\d+$' or (p_item->>'rank')::integer not between 0 and 6 then raise exception using errcode='22023',message='ATLAS_MEDIA_RANK_INVALID'; end if;
  if nullif(p_item->>'duration_minutes','') is not null and (coalesce(p_item->>'duration_minutes','')!~'^\d+$' or (p_item->>'duration_minutes')::integer not between 1 and 600) then raise exception using errcode='22023',message='ATLAS_MEDIA_DURATION_INVALID'; end if;
  if nullif(p_item->>'planned_date','') is not null then
    begin planned:=(p_item->>'planned_date')::date; exception when others then raise exception using errcode='22023',message='ATLAS_MEDIA_ITEM_DATE_INVALID'; end;
    if planned<p_week_start or planned>=p_week_start+7 then raise exception using errcode='22023',message='ATLAS_MEDIA_ITEM_DATE_OUT_OF_RANGE'; end if;
  end if;
end
$function$;

create or replace function public.upsert_atlas_media_plan(
  p_week_start date,p_weekly_revision_id uuid,p_capacity_class text,p_source_status text,
  p_source_fingerprint text,p_items jsonb,p_actor text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare plan_row public.atlas_media_plans%rowtype; existing_activity public.atlas_media_plan_activity%rowtype;
  item jsonb; existing_item public.atlas_media_plan_items%rowtype; item_keys text[]:=array[]::text[];
  item_ranks integer[]:=array[]::integer[]; reset_count integer:=0; event_name text; payload_count integer;
begin
  perform public.atlas_media_assert_actor(p_actor);
  if nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>256 then raise exception using errcode='22023',message='ATLAS_MEDIA_IDEMPOTENCY_KEY_INVALID'; end if;
  select * into existing_activity from public.atlas_media_plan_activity where idempotency_key=p_idempotency_key;
  if found then
    select * into plan_row from public.atlas_media_plans where id=existing_activity.media_plan_id;
    return jsonb_build_object('plan',to_jsonb(plan_row),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.rank),'[]'::jsonb) from public.atlas_media_plan_items i where i.media_plan_id=plan_row.id and i.status<>'removed'),'idempotent',true);
  end if;
  if extract(isodow from p_week_start)<>1 then raise exception using errcode='22023',message='ATLAS_MEDIA_PLAN_MONDAY_REQUIRED'; end if;
  if p_capacity_class not in ('recovery','standard','expansion','unknown') then raise exception using errcode='22023',message='ATLAS_MEDIA_CAPACITY_INVALID'; end if;
  if p_source_status not in ('complete','partial','unavailable') then raise exception using errcode='22023',message='ATLAS_MEDIA_SOURCE_STATUS_INVALID'; end if;
  if nullif(btrim(p_source_fingerprint),'') is null or length(p_source_fingerprint)>500 then raise exception using errcode='22023',message='ATLAS_MEDIA_FINGERPRINT_INVALID'; end if;
  if jsonb_typeof(p_items)<>'array' then raise exception using errcode='22023',message='ATLAS_MEDIA_ITEMS_INVALID'; end if;
  payload_count:=jsonb_array_length(p_items);
  if payload_count<1 or payload_count>7 then raise exception using errcode='22023',message='ATLAS_MEDIA_PLAN_ITEM_LIMIT'; end if;
  if p_weekly_revision_id is not null and not exists(select 1 from public.atlas_weekly_plan_revisions where id=p_weekly_revision_id and week_start=p_week_start) then raise exception using errcode='23503',message='ATLAS_MEDIA_WEEKLY_REVISION_INVALID'; end if;
  for item in select * from jsonb_array_elements(p_items) loop
    perform public.atlas_media_validate_item(item,p_week_start);
    if (item->>'source_key')=any(item_keys) then raise exception using errcode='22023',message='ATLAS_MEDIA_SOURCE_KEY_DUPLICATE'; end if;
    if (item->>'rank')::integer=any(item_ranks) then raise exception using errcode='22023',message='ATLAS_MEDIA_RANK_DUPLICATE'; end if;
    item_keys:=array_append(item_keys,item->>'source_key'); item_ranks:=array_append(item_ranks,(item->>'rank')::integer);
    if item->>'item_type'='reset' then reset_count:=reset_count+1; end if;
  end loop;
  if reset_count>1 then raise exception using errcode='22023',message='ATLAS_MEDIA_PLAN_RESET_LIMIT'; end if;

  select * into plan_row from public.atlas_media_plans where week_start=p_week_start for update;
  if found then
    update public.atlas_media_plans set weekly_revision_id=p_weekly_revision_id,capacity_class=p_capacity_class,source_status=p_source_status,
      source_fingerprint=p_source_fingerprint,status='active',revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now())
    where id=plan_row.id returning * into plan_row; event_name:='plan_refreshed';
  else
    insert into public.atlas_media_plans(week_start,weekly_revision_id,capacity_class,source_status,source_fingerprint,created_by,updated_by)
    values(p_week_start,p_weekly_revision_id,p_capacity_class,p_source_status,p_source_fingerprint,p_actor,p_actor)
    returning * into plan_row; event_name:='plan_created';
  end if;

  update public.atlas_media_plan_items set status='removed',status_changed_at=timezone('utc',now()),revision=revision+1,
    updated_by=p_actor,updated_at=timezone('utc',now())
  where media_plan_id=plan_row.id and status='queued' and not(source_key=any(item_keys));

  for item in select * from jsonb_array_elements(p_items) order by (value->>'rank')::integer loop
    select * into existing_item from public.atlas_media_plan_items where media_plan_id=plan_row.id and source_key=item->>'source_key' for update;
    if found then
      update public.atlas_media_plan_items set
        platform=item->>'platform',category=item->>'category',item_type=item->>'item_type',title=item->>'title',creator=coalesce(item->>'creator',''),
        source_url=nullif(item->>'source_url',''),duration_minutes=nullif(item->>'duration_minutes','')::integer,
        planned_date=nullif(item->>'planned_date','')::date,trigger_kind=item->>'trigger_kind',purpose=coalesce(item->>'purpose',''),rank=(item->>'rank')::integer,
        status=case when status in ('done','later','skipped') then status else 'queued' end,
        revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now())
      where id=existing_item.id;
    else
      insert into public.atlas_media_plan_items(media_plan_id,source_key,platform,category,item_type,title,creator,source_url,duration_minutes,planned_date,trigger_kind,purpose,rank,created_by,updated_by)
      values(plan_row.id,item->>'source_key',item->>'platform',item->>'category',item->>'item_type',item->>'title',coalesce(item->>'creator',''),
        nullif(item->>'source_url',''),nullif(item->>'duration_minutes','')::integer,nullif(item->>'planned_date','')::date,
        item->>'trigger_kind',coalesce(item->>'purpose',''),(item->>'rank')::integer,p_actor,p_actor);
    end if;
  end loop;
  insert into public.atlas_media_plan_activity(media_plan_id,week_start,event,actor,idempotency_key,revision,details)
  values(plan_row.id,p_week_start,event_name,p_actor,p_idempotency_key,plan_row.revision,jsonb_build_object('source_fingerprint',p_source_fingerprint,'item_count',payload_count,'source_status',p_source_status));
  return jsonb_build_object('plan',to_jsonb(plan_row),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.rank),'[]'::jsonb) from public.atlas_media_plan_items i where i.media_plan_id=plan_row.id and i.status<>'removed'),'idempotent',false);
end
$function$;

create or replace function public.transition_atlas_media_item_status(
  p_item_id uuid,p_expected_revision bigint,p_status text,p_actor text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare item_row public.atlas_media_plan_items%rowtype; plan_row public.atlas_media_plans%rowtype; activity_row public.atlas_media_plan_activity%rowtype;
begin
  perform public.atlas_media_assert_actor(p_actor);
  if p_actor<>'ransomed' then raise exception using errcode='42501',message='ATLAS_MEDIA_ITEM_OWNER_REQUIRED'; end if;
  if p_status not in ('queued','done','later','skipped') then raise exception using errcode='22023',message='ATLAS_MEDIA_ITEM_STATUS_INVALID'; end if;
  if nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>256 then raise exception using errcode='22023',message='ATLAS_MEDIA_IDEMPOTENCY_KEY_INVALID'; end if;
  select * into activity_row from public.atlas_media_plan_activity where idempotency_key=p_idempotency_key;
  if found then select * into item_row from public.atlas_media_plan_items where id=activity_row.item_id; return jsonb_build_object('item',to_jsonb(item_row),'idempotent',true); end if;
  select * into item_row from public.atlas_media_plan_items where id=p_item_id for update;
  if not found then raise exception using errcode='P0002',message='ATLAS_MEDIA_ITEM_NOT_FOUND'; end if;
  if item_row.item_type='reset' then raise exception using errcode='22023',message='ATLAS_MEDIA_RESET_STATUS_IMMUTABLE'; end if;
  if item_row.status='removed' then raise exception using errcode='55000',message='ATLAS_MEDIA_ITEM_REMOVED'; end if;
  if p_expected_revision is null or item_row.revision<>p_expected_revision then raise exception using errcode='40001',message='ATLAS_MEDIA_ITEM_REVISION_CONFLICT'; end if;
  update public.atlas_media_plan_items set status=p_status,status_changed_at=timezone('utc',now()),completed_at=case when p_status='done' then timezone('utc',now()) else null end,
    revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now()) where id=p_item_id returning * into item_row;
  select * into plan_row from public.atlas_media_plans where id=item_row.media_plan_id;
  insert into public.atlas_media_plan_activity(media_plan_id,item_id,week_start,event,actor,idempotency_key,revision,details)
  values(plan_row.id,item_row.id,plan_row.week_start,'item_status',p_actor,p_idempotency_key,item_row.revision,jsonb_build_object('status',p_status));
  return jsonb_build_object('item',to_jsonb(item_row),'idempotent',false);
end
$function$;

alter table public.atlas_media_plans enable row level security;
alter table public.atlas_media_plan_items enable row level security;
alter table public.atlas_media_plan_activity enable row level security;
revoke all on table public.atlas_media_plans,public.atlas_media_plan_items,public.atlas_media_plan_activity from public;
revoke all on function public.atlas_media_assert_actor(text) from public;
revoke all on function public.atlas_media_validate_item(jsonb,date) from public;
revoke all on function public.upsert_atlas_media_plan(date,uuid,text,text,text,jsonb,text,text) from public;
revoke all on function public.transition_atlas_media_item_status(uuid,bigint,text,text,text) from public;

do $block$
begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant select,insert,update on public.atlas_media_plans,public.atlas_media_plan_items to service_role;
    grant select,insert on public.atlas_media_plan_activity to service_role;
    grant usage,select on sequence public.atlas_media_plan_activity_id_seq to service_role;
    revoke delete,truncate on public.atlas_media_plans,public.atlas_media_plan_items,public.atlas_media_plan_activity from service_role;
    revoke update on public.atlas_media_plan_activity from service_role;
    grant execute on function public.upsert_atlas_media_plan(date,uuid,text,text,text,jsonb,text,text) to service_role;
    grant execute on function public.transition_atlas_media_item_status(uuid,bigint,text,text,text) to service_role;
  end if;
end
$block$;

