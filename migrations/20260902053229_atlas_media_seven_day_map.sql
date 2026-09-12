-- Restore the original Media product contract: curate the whole week once,
-- show one clear decision per day, and keep workload capacity out of curation.

alter table public.atlas_media_plan_items
  drop constraint if exists atlas_media_plan_items_platform_check;
alter table public.atlas_media_plan_items
  add constraint atlas_media_plan_items_platform_check
  check(platform in ('youtube','spotify','apple_podcasts','apple_music','other'));

create or replace function public.atlas_media_jobs_valid(p_jobs text[])
returns boolean language sql immutable set search_path='' as $function$
  select p_jobs is not null
    and cardinality(p_jobs)<=3
    and not exists(select 1 from unnest(p_jobs) value where value not in ('orient','advance','restore'))
    and cardinality(p_jobs)=(select count(distinct value) from unnest(p_jobs) value)
$function$;

create or replace function public.atlas_media_validate_item(p_item jsonb,p_week_start date)
returns void language plpgsql security definer set search_path='' as $function$
declare url text:=nullif(p_item->>'source_url',''); planned date;
begin
  if nullif(btrim(p_item->>'source_key'),'') is null or length(p_item->>'source_key')>500 then raise exception using errcode='22023',message='ATLAS_MEDIA_SOURCE_KEY_INVALID'; end if;
  if (p_item->>'platform') not in ('youtube','spotify','apple_podcasts','apple_music','other') then raise exception using errcode='22023',message='ATLAS_MEDIA_PLATFORM_INVALID'; end if;
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

create or replace function public.atlas_validate_media_daily_window()
returns trigger language plpgsql set search_path='' as $function$
declare same_day integer;
begin
  if new.item_type='reset' then
    if new.eligible_from is not null or new.eligible_until is not null or new.window_group<>'reset' then raise exception using errcode='22023',message='ATLAS_MEDIA_RESET_WINDOW_INVALID'; end if;
    return new;
  end if;
  if new.planned_date is null or new.eligible_from is null or new.eligible_until is null or new.window_group not in ('morning','later') then raise exception using errcode='22023',message='ATLAS_MEDIA_WINDOW_REQUIRED'; end if;
  if new.eligible_from>=new.eligible_until or (new.eligible_from at time zone 'America/Los_Angeles')::date<>new.planned_date or (new.eligible_until at time zone 'America/Los_Angeles')::date<>new.planned_date then raise exception using errcode='22023',message='ATLAS_MEDIA_WINDOW_INVALID'; end if;
  if new.status='removed' then return new; end if;
  select count(*) into same_day from public.atlas_media_plan_items where media_plan_id=new.media_plan_id and item_type='consumable' and status<>'removed' and planned_date=new.planned_date and id<>new.id;
  if same_day>=1 then raise exception using errcode='22023',message='ATLAS_MEDIA_DAILY_CAP'; end if;
  return new;
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
  item_date date;bounds record;
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
  if p_weekly_budget is null or p_weekly_budget<1 or p_weekly_budget>6 then raise exception using errcode='22023',message='ATLAS_MEDIA_WEEKLY_BUDGET_INVALID'; end if;
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
  if exists(select 1 from jsonb_array_elements(p_items) value where value->>'item_type'='consumable' group by (value->>'planned_date')::date having count(*)>1) then raise exception using errcode='22023',message='ATLAS_MEDIA_DAILY_CAP'; end if;
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

revoke all on function public.atlas_media_validate_item(jsonb,date) from public;
revoke all on function public.atlas_media_jobs_valid(text[]) from public;
revoke all on function public.upsert_atlas_media_plan_v2(date,uuid,text,text,text,text,text[],integer,jsonb,text,text) from public;

do $block$
begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function public.upsert_atlas_media_plan_v2(date,uuid,text,text,text,text,text[],integer,jsonb,text,text) to service_role;
  end if;
end
$block$;
