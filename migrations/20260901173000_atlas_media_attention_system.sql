-- Make Atlas Media an attention system: weekly intent, transparent selection,
-- bounded consumption, and owner-authored usefulness feedback.

alter table public.atlas_media_plans
  add column if not exists intent_summary text not null default 'Choose inputs deliberately and stop when the planned window ends.',
  add column if not exists input_jobs text[] not null default array[]::text[],
  add column if not exists weekly_budget integer not null default 3;

alter table public.atlas_media_plan_items
  add column if not exists input_job text not null default 'advance',
  add column if not exists selection_reason text not null default '',
  add column if not exists stop_rule text not null default '';

update public.atlas_media_plan_items
set input_job=case
  when item_type='reset' then 'reset'
  when category='brief_news' then 'orient'
  when category in ('music','leisure') then 'restore'
  else 'advance'
end
where input_job is null or input_job='advance';

create or replace function public.atlas_media_jobs_valid(p_jobs text[])
returns boolean language sql immutable set search_path='' as $function$
  select p_jobs is not null
    and cardinality(p_jobs)<=2
    and not exists(select 1 from unnest(p_jobs) value where value not in ('orient','advance','restore'))
    and cardinality(p_jobs)=(select count(distinct value) from unnest(p_jobs) value)
$function$;

do $block$
begin
  if not exists(select 1 from pg_constraint where conname='atlas_media_plan_intent_summary_check') then
    alter table public.atlas_media_plans add constraint atlas_media_plan_intent_summary_check
      check(length(btrim(intent_summary)) between 1 and 1000);
  end if;
  if not exists(select 1 from pg_constraint where conname='atlas_media_plan_input_jobs_check') then
    alter table public.atlas_media_plans add constraint atlas_media_plan_input_jobs_check
      check(public.atlas_media_jobs_valid(input_jobs));
  end if;
  if not exists(select 1 from pg_constraint where conname='atlas_media_plan_weekly_budget_check') then
    alter table public.atlas_media_plans add constraint atlas_media_plan_weekly_budget_check
      check(weekly_budget between 0 and 6);
  end if;
  if not exists(select 1 from pg_constraint where conname='atlas_media_item_input_job_check') then
    alter table public.atlas_media_plan_items add constraint atlas_media_item_input_job_check
      check(input_job in ('orient','advance','restore','reset'));
  end if;
  if not exists(select 1 from pg_constraint where conname='atlas_media_item_selection_reason_check') then
    alter table public.atlas_media_plan_items add constraint atlas_media_item_selection_reason_check
      check(length(selection_reason)<=1000);
  end if;
  if not exists(select 1 from pg_constraint where conname='atlas_media_item_stop_rule_check') then
    alter table public.atlas_media_plan_items add constraint atlas_media_item_stop_rule_check
      check(length(stop_rule)<=500);
  end if;
end
$block$;

create table if not exists public.atlas_media_item_feedback (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.atlas_media_plan_items(id) on delete restrict,
  week_start date not null,
  outcome text not null check(outcome in ('helpful','neutral','not_for_me','led_to_drift')),
  note text not null default '' check(length(note)<=1000),
  actor text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc',now())
);
create index if not exists atlas_media_feedback_item_idx
  on public.atlas_media_item_feedback(item_id,created_at desc);
create index if not exists atlas_media_feedback_week_idx
  on public.atlas_media_item_feedback(week_start,created_at desc);

drop trigger if exists atlas_media_feedback_reject_mutation on public.atlas_media_item_feedback;
create trigger atlas_media_feedback_reject_mutation
  before update or delete on public.atlas_media_item_feedback
  for each row execute function public.atlas_reject_media_activity_mutation();

create or replace function public.record_atlas_media_item_feedback(
  p_item_id uuid,p_outcome text,p_note text,p_actor text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare item_row public.atlas_media_plan_items%rowtype;
  plan_row public.atlas_media_plans%rowtype;
  feedback_row public.atlas_media_item_feedback%rowtype;
begin
  perform public.atlas_media_assert_actor(p_actor);
  if p_actor<>'ransomed' then raise exception using errcode='42501',message='ATLAS_MEDIA_FEEDBACK_OWNER_REQUIRED'; end if;
  if nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>256 then raise exception using errcode='22023',message='ATLAS_MEDIA_IDEMPOTENCY_KEY_INVALID'; end if;
  select * into feedback_row from public.atlas_media_item_feedback where idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('feedback',to_jsonb(feedback_row),'idempotent',true); end if;
  if p_outcome not in ('helpful','neutral','not_for_me','led_to_drift') then raise exception using errcode='22023',message='ATLAS_MEDIA_FEEDBACK_INVALID'; end if;
  if length(coalesce(p_note,''))>1000 then raise exception using errcode='22023',message='ATLAS_MEDIA_FEEDBACK_NOTE_INVALID'; end if;
  select * into item_row from public.atlas_media_plan_items where id=p_item_id;
  if not found then raise exception using errcode='P0002',message='ATLAS_MEDIA_ITEM_NOT_FOUND'; end if;
  select * into plan_row from public.atlas_media_plans where id=item_row.media_plan_id;
  insert into public.atlas_media_item_feedback(item_id,week_start,outcome,note,actor,idempotency_key)
  values(item_row.id,plan_row.week_start,p_outcome,coalesce(p_note,''),p_actor,p_idempotency_key)
  returning * into feedback_row;
  return jsonb_build_object('feedback',to_jsonb(feedback_row),'idempotent',false);
end
$function$;

create or replace function public.upsert_atlas_media_plan_v2(
  p_week_start date,p_weekly_revision_id uuid,p_capacity_class text,p_source_status text,
  p_source_fingerprint text,p_intent_summary text,p_input_jobs text[],p_weekly_budget integer,
  p_items jsonb,p_actor text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare plan_row public.atlas_media_plans%rowtype;
  existing_activity public.atlas_media_plan_activity%rowtype;
  item jsonb; existing_item public.atlas_media_plan_items%rowtype;
  item_keys text[]:=array[]::text[];item_ranks integer[]:=array[]::integer[];
  reset_count integer:=0;consumable_count integer:=0;event_name text;payload_count integer;
  item_date date;bounds record;capacity_budget integer;
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
  if nullif(btrim(p_intent_summary),'') is null or length(p_intent_summary)>1000 then raise exception using errcode='22023',message='ATLAS_MEDIA_INTENT_INVALID'; end if;
  if not public.atlas_media_jobs_valid(p_input_jobs) then raise exception using errcode='22023',message='ATLAS_MEDIA_INPUT_JOBS_INVALID'; end if;
  capacity_budget:=case p_capacity_class when 'recovery' then 3 when 'standard' then 5 when 'expansion' then 6 else 3 end;
  if p_weekly_budget is null or p_weekly_budget<0 or p_weekly_budget>capacity_budget then raise exception using errcode='22023',message='ATLAS_MEDIA_WEEKLY_BUDGET_INVALID'; end if;
  if jsonb_typeof(p_items)<>'array' then raise exception using errcode='22023',message='ATLAS_MEDIA_ITEMS_INVALID'; end if;
  payload_count:=jsonb_array_length(p_items);
  if payload_count<1 or payload_count>7 then raise exception using errcode='22023',message='ATLAS_MEDIA_PLAN_ITEM_LIMIT'; end if;
  if p_weekly_revision_id is not null and not exists(select 1 from public.atlas_weekly_plan_revisions where id=p_weekly_revision_id and week_start=p_week_start) then raise exception using errcode='23503',message='ATLAS_MEDIA_WEEKLY_REVISION_INVALID'; end if;
  for item in select * from jsonb_array_elements(p_items) loop
    perform public.atlas_media_validate_item(item,p_week_start);
    if (item->>'source_key')=any(item_keys) then raise exception using errcode='22023',message='ATLAS_MEDIA_SOURCE_KEY_DUPLICATE'; end if;
    if (item->>'rank')::integer=any(item_ranks) then raise exception using errcode='22023',message='ATLAS_MEDIA_RANK_DUPLICATE'; end if;
    if (item->>'input_job') not in ('orient','advance','restore','reset') then raise exception using errcode='22023',message='ATLAS_MEDIA_INPUT_JOB_INVALID'; end if;
    if nullif(btrim(item->>'selection_reason'),'') is null or length(item->>'selection_reason')>1000 then raise exception using errcode='22023',message='ATLAS_MEDIA_SELECTION_REASON_INVALID'; end if;
    if nullif(btrim(item->>'stop_rule'),'') is null or length(item->>'stop_rule')>500 then raise exception using errcode='22023',message='ATLAS_MEDIA_STOP_RULE_INVALID'; end if;
    item_keys:=array_append(item_keys,item->>'source_key');
    item_ranks:=array_append(item_ranks,(item->>'rank')::integer);
    if item->>'item_type'='reset' then
      reset_count:=reset_count+1;
      if item->>'input_job'<>'reset' then raise exception using errcode='22023',message='ATLAS_MEDIA_RESET_JOB_INVALID'; end if;
    else
      consumable_count:=consumable_count+1;
      if nullif(item->>'planned_date','') is null then raise exception using errcode='22023',message='ATLAS_MEDIA_WINDOW_REQUIRED'; end if;
      if not (item->>'input_job'=any(p_input_jobs)) then raise exception using errcode='22023',message='ATLAS_MEDIA_ITEM_JOB_NOT_PLANNED'; end if;
    end if;
  end loop;
  if reset_count<>1 then raise exception using errcode='22023',message='ATLAS_MEDIA_PLAN_RESET_REQUIRED'; end if;
  if consumable_count>p_weekly_budget then raise exception using errcode='22023',message='ATLAS_MEDIA_WEEKLY_BUDGET_EXCEEDED'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) value where value->>'item_type'='consumable' group by (value->>'planned_date')::date having count(*)>case when p_capacity_class in ('standard','expansion') then 2 else 1 end) then raise exception using errcode='22023',message='ATLAS_MEDIA_DAILY_CAP'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) value where value->>'item_type'='consumable' group by (value->>'planned_date')::date,case when value->>'trigger_kind' in ('weekday_morning','sunday_faith') then 'morning' else 'later' end having count(*)>1) then raise exception using errcode='22023',message='ATLAS_MEDIA_DAILY_WINDOW_DUPLICATE'; end if;
  select * into plan_row from public.atlas_media_plans where week_start=p_week_start for update;
  if found then
    update public.atlas_media_plans set weekly_revision_id=p_weekly_revision_id,capacity_class=p_capacity_class,source_status=p_source_status,source_fingerprint=p_source_fingerprint,intent_summary=p_intent_summary,input_jobs=p_input_jobs,weekly_budget=p_weekly_budget,status='active',revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now()) where id=plan_row.id returning * into plan_row;
    event_name:='plan_refreshed';
  else
    insert into public.atlas_media_plans(week_start,weekly_revision_id,capacity_class,source_status,source_fingerprint,intent_summary,input_jobs,weekly_budget,created_by,updated_by)
    values(p_week_start,p_weekly_revision_id,p_capacity_class,p_source_status,p_source_fingerprint,p_intent_summary,p_input_jobs,p_weekly_budget,p_actor,p_actor)
    returning * into plan_row;
    event_name:='plan_created';
  end if;
  update public.atlas_media_plan_items set status='removed',status_changed_at=timezone('utc',now()),revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now())
  where media_plan_id=plan_row.id and status='queued' and not(source_key=any(item_keys));
  for item in select * from jsonb_array_elements(p_items) order by (value->>'rank')::integer loop
    item_date:=nullif(item->>'planned_date','')::date;
    select * into bounds from public.atlas_media_window_bounds(item_date,item->>'trigger_kind');
    select * into existing_item from public.atlas_media_plan_items where media_plan_id=plan_row.id and source_key=item->>'source_key' for update;
    if found then
      update public.atlas_media_plan_items set platform=item->>'platform',category=item->>'category',item_type=item->>'item_type',title=item->>'title',creator=coalesce(item->>'creator',''),source_url=nullif(item->>'source_url',''),duration_minutes=nullif(item->>'duration_minutes','')::integer,planned_date=item_date,trigger_kind=item->>'trigger_kind',purpose=coalesce(item->>'purpose',''),input_job=item->>'input_job',selection_reason=item->>'selection_reason',stop_rule=item->>'stop_rule',rank=(item->>'rank')::integer,eligible_from=bounds.eligible_from,eligible_until=bounds.eligible_until,window_group=bounds.window_group,status=case when status in ('done','later','skipped') then status else 'queued' end,revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now()) where id=existing_item.id;
    else
      insert into public.atlas_media_plan_items(media_plan_id,source_key,platform,category,item_type,title,creator,source_url,duration_minutes,planned_date,trigger_kind,purpose,input_job,selection_reason,stop_rule,rank,eligible_from,eligible_until,window_group,created_by,updated_by)
      values(plan_row.id,item->>'source_key',item->>'platform',item->>'category',item->>'item_type',item->>'title',coalesce(item->>'creator',''),nullif(item->>'source_url',''),nullif(item->>'duration_minutes','')::integer,item_date,item->>'trigger_kind',coalesce(item->>'purpose',''),item->>'input_job',item->>'selection_reason',item->>'stop_rule',(item->>'rank')::integer,bounds.eligible_from,bounds.eligible_until,bounds.window_group,p_actor,p_actor);
    end if;
  end loop;
  insert into public.atlas_media_plan_activity(media_plan_id,week_start,event,actor,idempotency_key,revision,details)
  values(plan_row.id,p_week_start,event_name,p_actor,p_idempotency_key,plan_row.revision,jsonb_build_object('source_fingerprint',p_source_fingerprint,'item_count',payload_count,'source_status',p_source_status,'intent_summary',p_intent_summary,'input_jobs',to_jsonb(p_input_jobs),'weekly_budget',p_weekly_budget));
  return jsonb_build_object('plan',to_jsonb(plan_row),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.rank),'[]'::jsonb) from public.atlas_media_plan_items i where i.media_plan_id=plan_row.id and i.status<>'removed'),'idempotent',false);
end
$function$;

alter table public.atlas_media_item_feedback enable row level security;
revoke all on table public.atlas_media_item_feedback from public;
revoke all on function public.atlas_media_jobs_valid(text[]) from public;
revoke all on function public.record_atlas_media_item_feedback(uuid,text,text,text,text) from public;
revoke all on function public.upsert_atlas_media_plan_v2(date,uuid,text,text,text,text,text[],integer,jsonb,text,text) from public;

do $block$
begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant select,insert on public.atlas_media_item_feedback to service_role;
    revoke update,delete,truncate on public.atlas_media_item_feedback from service_role;
    grant execute on function public.record_atlas_media_item_feedback(uuid,text,text,text,text) to service_role;
    grant execute on function public.upsert_atlas_media_plan_v2(date,uuid,text,text,text,text,text[],integer,jsonb,text,text) to service_role;
  end if;
end
$block$;
