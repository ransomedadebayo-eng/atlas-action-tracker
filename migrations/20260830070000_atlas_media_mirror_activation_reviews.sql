-- Activate bounded YouTube mirroring and persist compact weekly input reviews.

create table if not exists public.atlas_media_sync_protocols (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider='youtube'),
  account_key text not null,
  playlist_id text not null,
  playlist_title text not null,
  protocol_hash text not null unique,
  constraints_json jsonb not null check(jsonb_typeof(constraints_json)='object'),
  status text not null default 'active' check(status in('active','revoked')),
  approved_by text not null,
  approved_at timestamptz not null,
  idempotency_key text not null unique,
  revision bigint not null default 1 check(revision>=1),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);

create table if not exists public.atlas_media_input_reviews (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  source_status text not null check(source_status in('complete','partial','unavailable')),
  coverage jsonb not null check(jsonb_typeof(coverage)='object'),
  summary text not null check(length(btrim(summary)) between 1 and 2000),
  metrics jsonb not null check(jsonb_typeof(metrics)='object'),
  themes jsonb not null check(jsonb_typeof(themes)='array'),
  drift jsonb not null check(jsonb_typeof(drift)='array'),
  recommendations jsonb not null check(jsonb_typeof(recommendations)='array'),
  actor text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc',now())
);
create index if not exists atlas_media_input_reviews_week_idx on public.atlas_media_input_reviews(week_start,created_at desc);

create or replace function public.atlas_reject_media_input_review_mutation()
returns trigger language plpgsql set search_path='' as $function$ begin raise exception using errcode='55000',message='ATLAS_MEDIA_INPUT_REVIEW_IMMUTABLE'; end $function$;
drop trigger if exists atlas_media_sync_protocols_reject_delete on public.atlas_media_sync_protocols;
create trigger atlas_media_sync_protocols_reject_delete before delete on public.atlas_media_sync_protocols for each row execute function public.atlas_reject_immutable_delete();
drop trigger if exists atlas_media_input_reviews_reject_mutation on public.atlas_media_input_reviews;
create trigger atlas_media_input_reviews_reject_mutation before update or delete on public.atlas_media_input_reviews for each row execute function public.atlas_reject_media_input_review_mutation();

create or replace function public.activate_atlas_media_sync_protocol(p_provider text,p_account_key text,p_playlist_id text,p_playlist_title text,p_protocol_hash text,p_constraints jsonb,p_actor text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare row_value public.atlas_media_sync_protocols%rowtype;
begin
  perform public.atlas_media_assert_actor(p_actor);
  if p_actor<>'ransomed' then raise exception using errcode='42501',message='ATLAS_MEDIA_SYNC_PROTOCOL_OWNER_REQUIRED'; end if;
  select * into row_value from public.atlas_media_sync_protocols where idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('protocol',to_jsonb(row_value),'idempotent',true); end if;
  if p_provider<>'youtube' or p_account_key<>'personal' or nullif(btrim(p_playlist_id),'') is null or nullif(btrim(p_protocol_hash),'') is null or jsonb_typeof(p_constraints)<>'object' then raise exception using errcode='22023',message='ATLAS_MEDIA_SYNC_PROTOCOL_INVALID'; end if;
  insert into public.atlas_media_sync_protocols(provider,account_key,playlist_id,playlist_title,protocol_hash,constraints_json,status,approved_by,approved_at,idempotency_key)
  values(p_provider,p_account_key,p_playlist_id,p_playlist_title,p_protocol_hash,p_constraints,'active',p_actor,timezone('utc',now()),p_idempotency_key) returning * into row_value;
  return jsonb_build_object('protocol',to_jsonb(row_value),'idempotent',false);
end
$function$;

create or replace function public.record_atlas_media_sync_apply(p_week_start date,p_dry_run_id uuid,p_manifest_hash text,p_protocol_hash text,p_result jsonb,p_actor text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare dry_run public.atlas_media_external_sync_runs%rowtype; protocol public.atlas_media_sync_protocols%rowtype; run_row public.atlas_media_external_sync_runs%rowtype; entry jsonb;
begin
  perform public.atlas_media_assert_actor(p_actor);
  select * into run_row from public.atlas_media_external_sync_runs where idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('run',to_jsonb(run_row),'idempotent',true); end if;
  select * into dry_run from public.atlas_media_external_sync_runs where id=p_dry_run_id and mode='dry_run';
  if not found or dry_run.week_start<>p_week_start or dry_run.source_fingerprint<>p_manifest_hash then raise exception using errcode='23514',message='ATLAS_MEDIA_SYNC_DRY_RUN_MISMATCH'; end if;
  select * into protocol from public.atlas_media_sync_protocols where protocol_hash=p_protocol_hash and status='active' and provider=dry_run.provider and account_key=dry_run.account_key;
  if not found then raise exception using errcode='42501',message='ATLAS_MEDIA_SYNC_PROTOCOL_REQUIRED'; end if;
  if jsonb_typeof(p_result)<>'object' then raise exception using errcode='22023',message='ATLAS_MEDIA_SYNC_RESULT_INVALID'; end if;
  insert into public.atlas_media_external_sync_runs(week_start,provider,account_key,playlist_title,source_fingerprint,mode,status,manifest,approval_hash,actor,idempotency_key)
  values(p_week_start,dry_run.provider,dry_run.account_key,dry_run.playlist_title,p_manifest_hash,'apply','applied',p_result,p_protocol_hash,p_actor,p_idempotency_key) returning * into run_row;
  for entry in select * from jsonb_array_elements(coalesce(p_result->'applied'->'additions','[]'::jsonb)) loop
    insert into public.atlas_media_external_sync_items(sync_run_id,media_item_id,operation,video_id,playlist_item_id,status,details) values(run_row.id,nullif(entry->>'media_item_id','')::uuid,'add',entry->>'video_id',entry->>'playlist_item_id','applied',entry);
  end loop;
  for entry in select * from jsonb_array_elements(coalesce(p_result->'applied'->'removals','[]'::jsonb)) loop
    insert into public.atlas_media_external_sync_items(sync_run_id,media_item_id,operation,video_id,playlist_item_id,status,details) values(run_row.id,nullif(entry->>'media_item_id','')::uuid,'remove',entry->>'video_id',entry->>'playlist_item_id','applied',entry);
  end loop;
  return jsonb_build_object('run',to_jsonb(run_row),'idempotent',false);
end
$function$;

create or replace function public.record_atlas_media_input_review(p_week_start date,p_source_status text,p_coverage jsonb,p_summary text,p_metrics jsonb,p_themes jsonb,p_drift jsonb,p_recommendations jsonb,p_actor text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare row_value public.atlas_media_input_reviews%rowtype;
begin
  perform public.atlas_media_assert_actor(p_actor);
  select * into row_value from public.atlas_media_input_reviews where idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('review',to_jsonb(row_value),'idempotent',true); end if;
  if p_source_status not in('complete','partial','unavailable') or jsonb_typeof(p_coverage)<>'object' or nullif(btrim(p_summary),'') is null or jsonb_typeof(p_metrics)<>'object' or jsonb_typeof(p_themes)<>'array' or jsonb_typeof(p_drift)<>'array' or jsonb_typeof(p_recommendations)<>'array' then raise exception using errcode='22023',message='ATLAS_MEDIA_INPUT_REVIEW_INVALID'; end if;
  insert into public.atlas_media_input_reviews(week_start,source_status,coverage,summary,metrics,themes,drift,recommendations,actor,idempotency_key)
  values(p_week_start,p_source_status,p_coverage,p_summary,p_metrics,p_themes,p_drift,p_recommendations,p_actor,p_idempotency_key) returning * into row_value;
  return jsonb_build_object('review',to_jsonb(row_value),'idempotent',false);
end
$function$;

alter table public.atlas_media_sync_protocols enable row level security;
alter table public.atlas_media_input_reviews enable row level security;
revoke all on table public.atlas_media_sync_protocols,public.atlas_media_input_reviews from public;
revoke all on function public.activate_atlas_media_sync_protocol(text,text,text,text,text,jsonb,text,text) from public;
revoke all on function public.record_atlas_media_sync_apply(date,uuid,text,text,jsonb,text,text) from public;
revoke all on function public.record_atlas_media_input_review(date,text,jsonb,text,jsonb,jsonb,jsonb,jsonb,text,text) from public;
do $block$ begin if exists(select 1 from pg_roles where rolname='service_role') then
  grant select,insert,update on public.atlas_media_sync_protocols to service_role;
  grant select,insert on public.atlas_media_input_reviews to service_role;
  revoke delete,truncate on public.atlas_media_sync_protocols,public.atlas_media_input_reviews from service_role;
  revoke update on public.atlas_media_input_reviews from service_role;
  grant execute on function public.activate_atlas_media_sync_protocol(text,text,text,text,text,jsonb,text,text) to service_role;
  grant execute on function public.record_atlas_media_sync_apply(date,uuid,text,text,jsonb,text,text) to service_role;
  grant execute on function public.record_atlas_media_input_review(date,text,jsonb,text,jsonb,jsonb,jsonb,jsonb,text,text) to service_role;
end if;end $block$;
