-- Linear parity slice 11: canonical realtime document operations, conflict
-- receipts, and version revert. Durable Objects coordinate only; Supabase
-- remains the durable source of document truth.

alter table public.atlas_documents
  add column if not exists last_realtime_edit_at timestamptz,
  add column if not exists last_realtime_actor text,
  add column if not exists last_realtime_client_id text;

create table if not exists public.atlas_document_operations (
  id uuid primary key default gen_random_uuid(),
  document_id text not null references public.atlas_documents(id) on delete restrict,
  client_id text not null,
  operation_id text not null,
  base_revision bigint not null check (base_revision >= 0),
  applied_revision bigint not null check (applied_revision > 0),
  base_content_sha256 text not null check (base_content_sha256 ~ '^[0-9a-f]{64}$'),
  result_content_sha256 text not null check (result_content_sha256 ~ '^[0-9a-f]{64}$'),
  merge_strategy text not null check (merge_strategy in ('direct','three_way','legacy_rest','revert')),
  change_summary jsonb not null default '{}'::jsonb,
  selection jsonb,
  actor text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (document_id, client_id, operation_id),
  unique (document_id, applied_revision),
  check (length(client_id) between 1 and 128),
  check (length(operation_id) between 1 and 128),
  check (jsonb_typeof(change_summary) = 'object'),
  check (octet_length(change_summary::text) <= 4096),
  check (selection is null or jsonb_typeof(selection) = 'object')
);

create index if not exists atlas_document_operations_document_idx
  on public.atlas_document_operations (document_id, applied_revision desc);
create index if not exists atlas_document_operations_actor_idx
  on public.atlas_document_operations (actor, created_at desc);

create table if not exists public.atlas_document_conflicts (
  id uuid primary key default gen_random_uuid(),
  document_id text not null references public.atlas_documents(id) on delete restrict,
  client_id text not null,
  operation_id text not null,
  base_revision bigint not null check (base_revision >= 0),
  current_revision bigint not null check (current_revision >= base_revision),
  base_content_sha256 text not null check (base_content_sha256 ~ '^[0-9a-f]{64}$'),
  proposed_content_sha256 text not null check (proposed_content_sha256 ~ '^[0-9a-f]{64}$'),
  current_content_sha256 text not null check (current_content_sha256 ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('overlapping_change','base_version_missing','base_hash_mismatch','title_conflict','retry_exhausted')),
  selection jsonb,
  actor text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (document_id, client_id, operation_id),
  check (length(client_id) between 1 and 128),
  check (length(operation_id) between 1 and 128),
  check (selection is null or jsonb_typeof(selection) = 'object')
);

create index if not exists atlas_document_conflicts_document_idx
  on public.atlas_document_conflicts (document_id, created_at desc);

create or replace function public.apply_atlas_document_realtime_edit(
  p_document_id text,
  p_client_id text,
  p_operation_id text,
  p_base_revision bigint,
  p_expected_revision bigint,
  p_title text,
  p_content text,
  p_base_content_sha256 text,
  p_result_content_sha256 text,
  p_merge_strategy text,
  p_change_summary jsonb,
  p_selection jsonb,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  document_row public.atlas_documents%rowtype;
  operation_row public.atlas_document_operations%rowtype;
  base_version public.atlas_document_versions%rowtype;
  calculated_base_hash text;
  calculated_result_hash text;
  selection_start integer;
  selection_end integer;
  server_timestamp timestamptz := timezone('utc', now());
begin
  if p_actor not in ('ransomed','codex','claude') then raise exception using errcode='22023',message='ATLAS_ACTOR_NOT_ALLOWED'; end if;
  if nullif(btrim(p_client_id),'') is null or length(p_client_id)>128 or nullif(btrim(p_operation_id),'') is null or length(p_operation_id)>128 then raise exception using errcode='22023',message='ATLAS_DOCUMENT_OPERATION_ID_INVALID'; end if;
  if p_base_revision<0 or p_expected_revision<0 or p_base_revision>p_expected_revision then raise exception using errcode='22023',message='ATLAS_DOCUMENT_OPERATION_REVISION_INVALID'; end if;
  if nullif(btrim(p_title),'') is null or length(p_title)>500 then raise exception using errcode='22023',message='ATLAS_DOCUMENT_TITLE_INVALID'; end if;
  if octet_length(p_content)>204800 then raise exception using errcode='22023',message='ATLAS_DOCUMENT_CONTENT_TOO_LARGE'; end if;
  if p_merge_strategy not in ('direct','three_way','legacy_rest') then raise exception using errcode='22023',message='ATLAS_DOCUMENT_MERGE_STRATEGY_INVALID'; end if;
  if jsonb_typeof(coalesce(p_change_summary,'{}'::jsonb))<>'object' or octet_length(coalesce(p_change_summary,'{}'::jsonb)::text)>4096 then raise exception using errcode='22023',message='ATLAS_DOCUMENT_CHANGE_SUMMARY_INVALID'; end if;
  if p_selection is not null then
    if jsonb_typeof(p_selection)<>'object' then raise exception using errcode='22023',message='ATLAS_DOCUMENT_SELECTION_INVALID'; end if;
    selection_start:=(p_selection->>'start')::integer; selection_end:=(p_selection->>'end')::integer;
    if selection_start<0 or selection_end<selection_start or selection_end>char_length(p_content) then raise exception using errcode='22023',message='ATLAS_DOCUMENT_SELECTION_INVALID'; end if;
  end if;

  select * into operation_row from public.atlas_document_operations
   where document_id=p_document_id and client_id=p_client_id and operation_id=p_operation_id;
  if found then
    select * into document_row from public.atlas_documents where id=p_document_id;
    return jsonb_build_object('document',to_jsonb(document_row),'operation',to_jsonb(operation_row),'replay',true);
  end if;

  select * into document_row from public.atlas_documents where id=p_document_id for update;
  if not found then raise exception using errcode='P0002',message='ATLAS_DOCUMENT_NOT_FOUND'; end if;
  if document_row.status='archived' then raise exception using errcode='55000',message='ATLAS_DOCUMENT_ARCHIVED'; end if;
  if document_row.revision<>p_expected_revision then raise exception using errcode='40001',message='ATLAS_DOCUMENT_REVISION_CONFLICT'; end if;
  select * into base_version from public.atlas_document_versions where document_id=p_document_id and revision=p_base_revision;
  if not found then raise exception using errcode='P0002',message='ATLAS_DOCUMENT_BASE_VERSION_NOT_FOUND'; end if;
  calculated_base_hash:=encode(extensions.digest(convert_to(base_version.content,'UTF8'),'sha256'),'hex');
  calculated_result_hash:=encode(extensions.digest(convert_to(p_content,'UTF8'),'sha256'),'hex');
  if calculated_base_hash<>p_base_content_sha256 then raise exception using errcode='23514',message='ATLAS_DOCUMENT_BASE_HASH_MISMATCH'; end if;
  if calculated_result_hash<>p_result_content_sha256 then raise exception using errcode='23514',message='ATLAS_DOCUMENT_RESULT_HASH_MISMATCH'; end if;

  update public.atlas_documents set title=p_title,content=p_content,revision=revision+1,
    updated_by=p_actor,updated_at=server_timestamp,last_realtime_edit_at=server_timestamp,
    last_realtime_actor=p_actor,last_realtime_client_id=p_client_id
  where id=p_document_id returning * into document_row;
  insert into public.atlas_document_operations(
    document_id,client_id,operation_id,base_revision,applied_revision,
    base_content_sha256,result_content_sha256,merge_strategy,change_summary,selection,actor,created_at
  ) values(
    p_document_id,p_client_id,p_operation_id,p_base_revision,document_row.revision,
    p_base_content_sha256,p_result_content_sha256,p_merge_strategy,coalesce(p_change_summary,'{}'::jsonb),p_selection,p_actor,server_timestamp
  ) returning * into operation_row;
  return jsonb_build_object('document',to_jsonb(document_row),'operation',to_jsonb(operation_row),'replay',false);
end
$function$;

create or replace function public.record_atlas_document_conflict(
  p_document_id text,
  p_client_id text,
  p_operation_id text,
  p_base_revision bigint,
  p_current_revision bigint,
  p_base_content_sha256 text,
  p_proposed_content_sha256 text,
  p_current_content_sha256 text,
  p_reason text,
  p_selection jsonb,
  p_actor text
)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare conflict_row public.atlas_document_conflicts%rowtype; replay boolean:=false;
begin
  if p_actor not in ('ransomed','codex','claude') then raise exception using errcode='22023',message='ATLAS_ACTOR_NOT_ALLOWED'; end if;
  if not exists(select 1 from public.atlas_documents where id=p_document_id) then raise exception using errcode='P0002',message='ATLAS_DOCUMENT_NOT_FOUND'; end if;
  insert into public.atlas_document_conflicts(document_id,client_id,operation_id,base_revision,current_revision,base_content_sha256,proposed_content_sha256,current_content_sha256,reason,selection,actor)
  values(p_document_id,p_client_id,p_operation_id,p_base_revision,p_current_revision,p_base_content_sha256,p_proposed_content_sha256,p_current_content_sha256,p_reason,p_selection,p_actor)
  on conflict(document_id,client_id,operation_id) do nothing returning * into conflict_row;
  if not found then select * into conflict_row from public.atlas_document_conflicts where document_id=p_document_id and client_id=p_client_id and operation_id=p_operation_id; replay:=true; end if;
  return jsonb_build_object('conflict',to_jsonb(conflict_row),'replay',replay);
end
$function$;

create or replace function public.revert_atlas_document_version(
  p_document_id text,
  p_target_revision bigint,
  p_operation_id text,
  p_actor text,
  p_expected_revision bigint
)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare document_row public.atlas_documents%rowtype; target_version public.atlas_document_versions%rowtype;
  operation_row public.atlas_document_operations%rowtype; base_hash text; result_hash text; server_timestamp timestamptz:=timezone('utc',now());
begin
  if p_actor<>'ransomed' then raise exception using errcode='42501',message='ATLAS_DOCUMENT_OWNER_REQUIRED'; end if;
  select * into document_row from public.atlas_documents where id=p_document_id for update;
  if not found then raise exception using errcode='P0002',message='ATLAS_DOCUMENT_NOT_FOUND'; end if;
  if document_row.status='archived' then raise exception using errcode='55000',message='ATLAS_DOCUMENT_ARCHIVED'; end if;
  if document_row.revision<>p_expected_revision then raise exception using errcode='40001',message='ATLAS_DOCUMENT_REVISION_CONFLICT'; end if;
  select * into target_version from public.atlas_document_versions where document_id=p_document_id and revision=p_target_revision;
  if not found then raise exception using errcode='P0002',message='ATLAS_DOCUMENT_VERSION_NOT_FOUND'; end if;
  base_hash:=encode(extensions.digest(convert_to(document_row.content,'UTF8'),'sha256'),'hex');
  result_hash:=encode(extensions.digest(convert_to(target_version.content,'UTF8'),'sha256'),'hex');
  update public.atlas_documents set title=target_version.title,content=target_version.content,revision=revision+1,
    updated_by=p_actor,updated_at=server_timestamp,last_realtime_edit_at=server_timestamp,last_realtime_actor=p_actor,
    last_realtime_client_id='version-revert'
  where id=p_document_id returning * into document_row;
  insert into public.atlas_document_operations(document_id,client_id,operation_id,base_revision,applied_revision,base_content_sha256,result_content_sha256,merge_strategy,change_summary,actor,created_at)
  values(p_document_id,'version-revert',p_operation_id,p_expected_revision,document_row.revision,base_hash,result_hash,'revert',jsonb_build_object('target_revision',p_target_revision),p_actor,server_timestamp)
  returning * into operation_row;
  return jsonb_build_object('document',to_jsonb(document_row),'operation',to_jsonb(operation_row));
end
$function$;

create or replace function public.atlas_reject_realtime_document_history_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin raise exception using errcode='55000',message='ATLAS_DOCUMENT_REALTIME_HISTORY_IMMUTABLE'; end
$function$;

drop trigger if exists atlas_document_operations_immutable on public.atlas_document_operations;
create trigger atlas_document_operations_immutable before update or delete on public.atlas_document_operations
for each row execute function public.atlas_reject_realtime_document_history_mutation();
drop trigger if exists atlas_document_conflicts_immutable on public.atlas_document_conflicts;
create trigger atlas_document_conflicts_immutable before update or delete on public.atlas_document_conflicts
for each row execute function public.atlas_reject_realtime_document_history_mutation();

alter table public.atlas_document_operations enable row level security;
alter table public.atlas_document_conflicts enable row level security;
revoke all on table public.atlas_document_operations,public.atlas_document_conflicts from public;

do $migration$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on table public.atlas_document_operations,public.atlas_document_conflicts from %I',role_name);
      execute format('revoke execute on function public.apply_atlas_document_realtime_edit(text,text,text,bigint,bigint,text,text,text,text,text,jsonb,jsonb,text) from %I',role_name);
      execute format('revoke execute on function public.record_atlas_document_conflict(text,text,text,bigint,bigint,text,text,text,text,jsonb,text) from %I',role_name);
      execute format('revoke execute on function public.revert_atlas_document_version(text,bigint,text,text,bigint) from %I',role_name);
    end if;
  end loop;
  if exists(select 1 from pg_roles where rolname='service_role') then
    revoke all on table public.atlas_document_operations,public.atlas_document_conflicts from service_role;
    grant select,insert on table public.atlas_document_operations,public.atlas_document_conflicts to service_role;
    grant execute on function public.apply_atlas_document_realtime_edit(text,text,text,bigint,bigint,text,text,text,text,text,jsonb,jsonb,text) to service_role;
    grant execute on function public.record_atlas_document_conflict(text,text,text,bigint,bigint,text,text,text,text,jsonb,text) to service_role;
    grant execute on function public.revert_atlas_document_version(text,bigint,text,text,bigint) to service_role;
  end if;
end
$migration$;

revoke all on function public.apply_atlas_document_realtime_edit(text,text,text,bigint,bigint,text,text,text,text,text,jsonb,jsonb,text) from public;
revoke all on function public.record_atlas_document_conflict(text,text,text,bigint,bigint,text,text,text,text,jsonb,text) from public;
revoke all on function public.revert_atlas_document_version(text,bigint,text,text,bigint) from public;
revoke all on function public.atlas_reject_realtime_document_history_mutation() from public;

comment on table public.atlas_document_operations is 'Immutable accepted realtime document operations bound to canonical revisions and content hashes.';
comment on table public.atlas_document_conflicts is 'Hash-only receipts for rejected overlapping realtime edits; local draft bodies remain client-side.';
