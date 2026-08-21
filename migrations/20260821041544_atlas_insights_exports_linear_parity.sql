-- Linear parity slice 9: lifecycle timing, saved Insights, Dashboards,
-- immutable snapshots, and audited CSV export receipts.

alter table public.atlas_actions
  add column if not exists started_at timestamptz,
  add column if not exists triaged_at timestamptz,
  add column if not exists canceled_at timestamptz;

create or replace function public.atlas_manage_action_lifecycle_timestamps()
returns trigger language plpgsql set search_path='' as $function$
begin
  if tg_op='INSERT' then
    if new.status='open' then new.triaged_at:=coalesce(new.triaged_at,new.created_at,timezone('utc',now())); end if;
    if new.status='in_progress' then new.started_at:=coalesce(new.started_at,new.created_at,timezone('utc',now())); end if;
    if new.status in ('canceled','cancelled') then new.canceled_at:=coalesce(new.canceled_at,new.created_at,timezone('utc',now())); end if;
  else
    if new.status='open' and old.status is distinct from 'open' then new.triaged_at:=coalesce(new.triaged_at,timezone('utc',now())); end if;
    if new.status='in_progress' and old.status is distinct from 'in_progress' then new.started_at:=coalesce(new.started_at,timezone('utc',now())); end if;
    if new.status in ('canceled','cancelled') and old.status not in ('canceled','cancelled') then new.canceled_at:=coalesce(new.canceled_at,timezone('utc',now()));
    elsif old.status in ('canceled','cancelled') and new.status not in ('canceled','cancelled') then new.canceled_at:=null; end if;
  end if;
  return new;
end $function$;

revoke all on function public.atlas_manage_action_lifecycle_timestamps() from public;
drop trigger if exists atlas_actions_manage_lifecycle_timestamps on public.atlas_actions;
create trigger atlas_actions_manage_lifecycle_timestamps before insert or update of status on public.atlas_actions for each row execute function public.atlas_manage_action_lifecycle_timestamps();

create index if not exists atlas_actions_started_at_idx on public.atlas_actions(started_at) where started_at is not null;
create index if not exists atlas_actions_triaged_at_idx on public.atlas_actions(triaged_at) where triaged_at is not null;
create index if not exists atlas_actions_completed_started_idx on public.atlas_actions(completed_at,started_at) where completed_at is not null;

create table if not exists public.atlas_insights (
  id text primary key,
  name text not null,
  description text not null default '',
  measure text not null check(measure in ('issue_count','effort','cycle_time','lead_time','triage_time','issue_age')),
  slice_by text not null default 'status' check(slice_by in ('none','status','status_type','owner','business','priority','tag','estimate','template','project','initiative','cycle','release','pipeline','created_date','completed_date','started_date','due_date','burn_up')),
  segment_by text check(segment_by is null or segment_by in ('status','status_type','owner','business','priority','tag','estimate','template','project','initiative','cycle','release','pipeline')),
  chart_type text not null default 'bar' check(chart_type in ('bar','scatter','burn_up','metric','table')),
  filters jsonb not null default '{}'::jsonb check(jsonb_typeof(filters)='object'),
  time_grouping text not null default 'monthly' check(time_grouping in ('daily','weekly','monthly','quarterly','yearly')),
  include_archived boolean not null default false,
  exclude_no_priority boolean not null default false,
  saved_view_id text references public.atlas_saved_views(id) on delete restrict,
  scope text not null default 'workspace' check(scope in ('workspace','business','personal')),
  business text,
  owner_id text not null default 'ransomed',
  status text not null default 'active' check(status in ('active','archived')),
  revision bigint not null default 0 check(revision>=0),
  archived_at timestamptz,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  check((scope='business' and nullif(btrim(business),'') is not null) or (scope<>'business'))
);

create index if not exists atlas_insights_active_idx on public.atlas_insights(status,scope,business,name);
create index if not exists atlas_insights_saved_view_idx on public.atlas_insights(saved_view_id) where saved_view_id is not null;

create table if not exists public.atlas_dashboards (
  id text primary key,
  name text not null,
  description text not null default '',
  scope text not null default 'workspace' check(scope in ('workspace','business','personal')),
  business text,
  owner_id text not null default 'ransomed',
  filters jsonb not null default '{}'::jsonb check(jsonb_typeof(filters)='object'),
  status text not null default 'active' check(status in ('active','archived')),
  revision bigint not null default 0 check(revision>=0),
  archived_at timestamptz,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  check((scope='business' and nullif(btrim(business),'') is not null) or (scope<>'business'))
);

create index if not exists atlas_dashboards_active_idx on public.atlas_dashboards(status,scope,business,name);

create table if not exists public.atlas_dashboard_insights (
  id text primary key,
  dashboard_id text not null references public.atlas_dashboards(id) on delete restrict,
  insight_id text not null references public.atlas_insights(id) on delete restrict,
  display_type text not null default 'chart' check(display_type in ('chart','table','metric')),
  position integer not null default 0 check(position>=0),
  width integer not null default 1 check(width between 1 and 4),
  height integer not null default 1 check(height between 1 and 4),
  filters jsonb not null default '{}'::jsonb check(jsonb_typeof(filters)='object'),
  status text not null default 'active' check(status in ('active','archived')),
  revision bigint not null default 0 check(revision>=0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);

create unique index if not exists atlas_dashboard_insights_active_idx on public.atlas_dashboard_insights(dashboard_id,insight_id) where status='active';
create index if not exists atlas_dashboard_insights_order_idx on public.atlas_dashboard_insights(dashboard_id,status,position);
create index if not exists atlas_dashboard_insights_insight_idx on public.atlas_dashboard_insights(insight_id) where status='active';

create table if not exists public.atlas_insight_snapshots (
  id text primary key,
  insight_id text not null references public.atlas_insights(id) on delete restrict,
  insight_revision bigint not null,
  result jsonb not null check(jsonb_typeof(result)='object'),
  source_watermark timestamptz,
  actor text not null,
  created_at timestamptz not null default timezone('utc',now())
);

create index if not exists atlas_insight_snapshots_created_idx on public.atlas_insight_snapshots(insight_id,created_at desc);

create table if not exists public.atlas_export_receipts (
  id text primary key,
  export_type text not null check(export_type in ('actions','projects','initiatives','insight')),
  insight_id text references public.atlas_insights(id) on delete restrict,
  filters jsonb not null default '{}'::jsonb check(jsonb_typeof(filters)='object'),
  row_count integer not null check(row_count>=0),
  content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
  actor text not null,
  created_at timestamptz not null default timezone('utc',now())
);

create index if not exists atlas_export_receipts_created_idx on public.atlas_export_receipts(export_type,created_at desc);
create index if not exists atlas_export_receipts_insight_idx on public.atlas_export_receipts(insight_id,created_at desc) where insight_id is not null;

create table if not exists public.atlas_analytics_activity_log (
  id bigint generated by default as identity primary key,
  entity_type text not null,
  entity_id text not null,
  event text not null,
  old_value jsonb,
  new_value jsonb,
  actor text not null,
  created_at timestamptz not null default timezone('utc',now())
);

create index if not exists atlas_analytics_activity_entity_idx on public.atlas_analytics_activity_log(entity_type,entity_id,created_at desc);

create or replace function public.atlas_audit_analytics_row()
returns trigger language plpgsql set search_path='' as $function$
declare kind text; row_json jsonb:=to_jsonb(new); old_json jsonb:=case when tg_op='INSERT' then null else to_jsonb(old) end; actor_value text; event_name text;
begin
  kind:=case tg_table_name when 'atlas_insights' then 'insight' when 'atlas_dashboards' then 'dashboard' else 'dashboard_insight' end;
  actor_value:=case when tg_op='INSERT' then row_json->>'created_by' else row_json->>'updated_by' end;
  event_name:=case when tg_op='INSERT' then kind||'_created' when (row_json->>'status') is distinct from (old_json->>'status') then kind||'_'||(row_json->>'status') else kind||'_updated' end;
  insert into public.atlas_analytics_activity_log(entity_type,entity_id,event,old_value,new_value,actor)
  values(kind,row_json->>'id',event_name,old_json,row_json,actor_value);
  return new;
end $function$;

revoke all on function public.atlas_audit_analytics_row() from public;
create trigger atlas_insights_audit_row after insert or update on public.atlas_insights for each row execute function public.atlas_audit_analytics_row();
create trigger atlas_dashboards_audit_row after insert or update on public.atlas_dashboards for each row execute function public.atlas_audit_analytics_row();
create trigger atlas_dashboard_insights_audit_row after insert or update on public.atlas_dashboard_insights for each row execute function public.atlas_audit_analytics_row();

create or replace function public.record_atlas_insight_snapshot(p_snapshot_id text,p_insight_id text,p_insight_revision bigint,p_result jsonb,p_source_watermark timestamptz,p_actor text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare insight_row public.atlas_insights%rowtype; snapshot_row public.atlas_insight_snapshots%rowtype;
begin
  if p_actor not in ('ransomed','codex','claude') then raise exception using errcode='22023',message='ATLAS_ACTOR_NOT_ALLOWED'; end if;
  if jsonb_typeof(p_result)<>'object' then raise exception using errcode='22023',message='ATLAS_INSIGHT_RESULT_OBJECT_REQUIRED'; end if;
  select * into insight_row from public.atlas_insights where id=p_insight_id and status='active'; if not found then raise exception using errcode='P0002',message='ATLAS_INSIGHT_NOT_FOUND'; end if;
  if insight_row.revision<>p_insight_revision then raise exception using errcode='40001',message='ATLAS_INSIGHT_REVISION_CONFLICT'; end if;
  insert into public.atlas_insight_snapshots(id,insight_id,insight_revision,result,source_watermark,actor)
  values(p_snapshot_id,p_insight_id,p_insight_revision,p_result,p_source_watermark,p_actor) returning * into snapshot_row;
  return to_jsonb(snapshot_row);
end $function$;

create or replace function public.record_atlas_export_receipt(p_receipt_id text,p_export_type text,p_insight_id text,p_filters jsonb,p_row_count integer,p_content_sha256 text,p_actor text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare receipt_row public.atlas_export_receipts%rowtype;
begin
  if p_actor not in ('ransomed','codex','claude') then raise exception using errcode='22023',message='ATLAS_ACTOR_NOT_ALLOWED'; end if;
  if p_export_type not in ('actions','projects','initiatives','insight') or p_row_count<0 or p_content_sha256 !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='ATLAS_EXPORT_RECEIPT_INVALID'; end if;
  insert into public.atlas_export_receipts(id,export_type,insight_id,filters,row_count,content_sha256,actor)
  values(p_receipt_id,p_export_type,p_insight_id,coalesce(p_filters,'{}'::jsonb),p_row_count,p_content_sha256,p_actor) returning * into receipt_row;
  return to_jsonb(receipt_row);
end $function$;

create or replace function public.transition_atlas_analytics_entity(p_entity_type text,p_entity_id text,p_restore boolean,p_actor text,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare result jsonb;
begin
  if p_actor<>'ransomed' then raise exception using errcode='42501',message='ATLAS_ANALYTICS_OWNER_REQUIRED'; end if;
  if p_entity_type='insight' then
    update public.atlas_insights set status=case when p_restore then 'active' else 'archived' end,archived_at=case when p_restore then null else timezone('utc',now()) end,revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now()) where id=p_entity_id and revision=p_expected_revision returning to_jsonb(atlas_insights.*) into result;
  elsif p_entity_type='dashboard' then
    update public.atlas_dashboards set status=case when p_restore then 'active' else 'archived' end,archived_at=case when p_restore then null else timezone('utc',now()) end,revision=revision+1,updated_by=p_actor,updated_at=timezone('utc',now()) where id=p_entity_id and revision=p_expected_revision returning to_jsonb(atlas_dashboards.*) into result;
  else raise exception using errcode='22023',message='ATLAS_ANALYTICS_ENTITY_INVALID'; end if;
  if result is null then
    if not exists(select 1 from public.atlas_insights where id=p_entity_id) and not exists(select 1 from public.atlas_dashboards where id=p_entity_id) then raise exception using errcode='P0002',message='ATLAS_ANALYTICS_ENTITY_NOT_FOUND'; end if;
    raise exception using errcode='40001',message='ATLAS_ANALYTICS_REVISION_CONFLICT';
  end if;
  return result;
end $function$;

revoke all on function public.record_atlas_insight_snapshot(text,text,bigint,jsonb,timestamptz,text) from public;
revoke all on function public.record_atlas_export_receipt(text,text,text,jsonb,integer,text,text) from public;
revoke all on function public.transition_atlas_analytics_entity(text,text,boolean,text,bigint) from public;

drop trigger if exists atlas_insights_reject_delete on public.atlas_insights;
create trigger atlas_insights_reject_delete before delete on public.atlas_insights for each row execute function public.atlas_reject_immutable_delete();
drop trigger if exists atlas_dashboards_reject_delete on public.atlas_dashboards;
create trigger atlas_dashboards_reject_delete before delete on public.atlas_dashboards for each row execute function public.atlas_reject_immutable_delete();
drop trigger if exists atlas_dashboard_insights_reject_delete on public.atlas_dashboard_insights;
create trigger atlas_dashboard_insights_reject_delete before delete on public.atlas_dashboard_insights for each row execute function public.atlas_reject_immutable_delete();
drop trigger if exists atlas_insight_snapshots_reject_mutation on public.atlas_insight_snapshots;
create trigger atlas_insight_snapshots_reject_mutation before update or delete on public.atlas_insight_snapshots for each row execute function public.atlas_reject_project_history_mutation();
drop trigger if exists atlas_export_receipts_reject_mutation on public.atlas_export_receipts;
create trigger atlas_export_receipts_reject_mutation before update or delete on public.atlas_export_receipts for each row execute function public.atlas_reject_project_history_mutation();
drop trigger if exists atlas_analytics_activity_reject_mutation on public.atlas_analytics_activity_log;
create trigger atlas_analytics_activity_reject_mutation before update or delete on public.atlas_analytics_activity_log for each row execute function public.atlas_reject_project_history_mutation();

alter table public.atlas_insights enable row level security;
alter table public.atlas_dashboards enable row level security;
alter table public.atlas_dashboard_insights enable row level security;
alter table public.atlas_insight_snapshots enable row level security;
alter table public.atlas_export_receipts enable row level security;
alter table public.atlas_analytics_activity_log enable row level security;
revoke all on table public.atlas_insights,public.atlas_dashboards,public.atlas_dashboard_insights,public.atlas_insight_snapshots,public.atlas_export_receipts,public.atlas_analytics_activity_log from public;

do $migration$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then execute format('revoke all on table public.atlas_insights,public.atlas_dashboards,public.atlas_dashboard_insights,public.atlas_insight_snapshots,public.atlas_export_receipts,public.atlas_analytics_activity_log from %I',role_name); end if;
  end loop;
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant select,insert,update on public.atlas_insights,public.atlas_dashboards,public.atlas_dashboard_insights to service_role;
    grant select,insert on public.atlas_insight_snapshots,public.atlas_export_receipts,public.atlas_analytics_activity_log to service_role;
    grant usage,select on sequence public.atlas_analytics_activity_log_id_seq to service_role;
    revoke delete,truncate on public.atlas_insights,public.atlas_dashboards,public.atlas_dashboard_insights,public.atlas_insight_snapshots,public.atlas_export_receipts,public.atlas_analytics_activity_log from service_role;
    revoke update on public.atlas_insight_snapshots,public.atlas_export_receipts,public.atlas_analytics_activity_log from service_role;
    grant execute on function public.record_atlas_insight_snapshot(text,text,bigint,jsonb,timestamptz,text) to service_role;
    grant execute on function public.record_atlas_export_receipt(text,text,text,jsonb,integer,text,text) to service_role;
    grant execute on function public.transition_atlas_analytics_entity(text,text,boolean,text,bigint) to service_role;
  end if;
end $migration$;

comment on table public.atlas_insights is 'Saved real-time action analytics definitions with Linear-style measures, slices, segments, and filters.';
comment on table public.atlas_export_receipts is 'Immutable export metadata with row count and content SHA-256; CSV bodies are not persisted.';
