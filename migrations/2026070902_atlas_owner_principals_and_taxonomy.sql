-- ATLAS trust overhaul (2/3): owner-only principals, active-owner integrity,
-- canonical business lanes, evidence quality, and honest proposal timestamps.

alter table public.atlas_members
  add column if not exists principal_type text;

update public.atlas_members
set principal_type = case id
  when 'ransomed' then 'owner'
  when 'codex' then 'agent'
  when 'claude' then 'agent'
  else 'historical'
end,
is_active = id in ('ransomed', 'codex', 'claude');

insert into public.atlas_members (
  id, name, full_name, email, businesses, role, aliases, is_active, principal_type
)
values
  ('ransomed', 'Ransomed', 'Ransomed Adebayo', null, '[]'::jsonb, 'Owner', '[]'::jsonb, true, 'owner'),
  ('codex', 'Codex', 'Codex', null, '[]'::jsonb, 'Agent', '[]'::jsonb, true, 'agent'),
  ('claude', 'Claude', 'Claude', null, '[]'::jsonb, 'Agent', '[]'::jsonb, true, 'agent')
on conflict (id) do update
set is_active = excluded.is_active,
    principal_type = excluded.principal_type;

alter table public.atlas_members
  alter column principal_type set default 'historical',
  alter column principal_type set not null,
  drop constraint if exists atlas_members_principal_type_check,
  add constraint atlas_members_principal_type_check
    check (principal_type in ('owner', 'agent', 'historical'));

create or replace function public.atlas_validate_principal_roster()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.id = 'ransomed' then
    if new.is_active is not true or new.principal_type <> 'owner' then
      raise exception using errcode = '23514', message = 'ATLAS_OWNER_PRINCIPAL_REQUIRED';
    end if;
  elsif new.id in ('codex', 'claude') then
    if new.is_active is not true or new.principal_type <> 'agent' then
      raise exception using errcode = '23514', message = 'ATLAS_AGENT_PRINCIPAL_REQUIRED';
    end if;
  elsif new.is_active is true or new.principal_type <> 'historical' then
    raise exception using errcode = '23514', message = 'ATLAS_HISTORICAL_PRINCIPAL_REQUIRED';
  end if;

  return new;
end
$function$;

revoke all on function public.atlas_validate_principal_roster() from public;

drop trigger if exists atlas_members_validate_principal_roster on public.atlas_members;
create trigger atlas_members_validate_principal_roster
before insert or update of id, is_active, principal_type on public.atlas_members
for each row execute function public.atlas_validate_principal_roster();

-- Remove any legacy trigger whose name, trigger definition, or trigger-function
-- body adds Nicole to an action. The function is left in place as inert history.
do $migration$
declare
  trigger_record record;
begin
  for trigger_record in
    select trigger.oid,
           trigger.tgname,
           trigger.tgfoid,
           pg_get_triggerdef(trigger.oid) as trigger_definition,
           pg_get_functiondef(trigger.tgfoid) as function_definition
    from pg_trigger trigger
    where trigger.tgrelid = 'public.atlas_actions'::regclass
      and not trigger.tgisinternal
  loop
    if lower(trigger_record.tgname) like '%nicole%'
       or lower(trigger_record.trigger_definition) like '%nicole%'
       or lower(trigger_record.function_definition) like '%nicole%'
    then
      execute format('drop trigger %I on public.atlas_actions', trigger_record.tgname);
    end if;
  end loop;
end
$migration$;

alter table public.atlas_actions
  alter column owners set default '[]'::jsonb;

create temporary table atlas_active_owner_repairs on commit drop as
select action_id, old_owners, new_owners
from (
  select action.id as action_id,
         action.owners as old_owners,
         coalesce(
           (
             select jsonb_agg(owner_id order by first_ordinal)
             from (
               select lower(btrim(owner.value)) as owner_id,
                      min(owner.ordinality) as first_ordinal
               from jsonb_array_elements_text(
                 case
                   when jsonb_typeof(action.owners) = 'array' then action.owners
                   else '[]'::jsonb
                 end
               ) with ordinality as owner(value, ordinality)
               where lower(btrim(owner.value)) in ('ransomed', 'codex', 'claude')
               group by lower(btrim(owner.value))
             ) allowed_owners
           ),
           '["ransomed"]'::jsonb
         ) as new_owners
  from public.atlas_actions action
  where lower(coalesce(action.status, '')) not in ('done', 'completed', 'closed', 'cancelled', 'canceled', 'archived')
) repairs
where old_owners is distinct from new_owners;

insert into public.atlas_activity_log (action_id, event, old_value, new_value, actor)
select action_id,
       'integrity_repair',
       old_owners::text,
       jsonb_build_object(
         'migration', '20260709_atlas_owner_principals_and_taxonomy',
         'field', 'owners',
         'value', new_owners
       )::text,
       'system'
from atlas_active_owner_repairs;

update public.atlas_actions action
set owners = repair.new_owners,
    updated_at = timezone('utc', now())
from atlas_active_owner_repairs repair
where action.id = repair.action_id;

create or replace function public.atlas_validate_active_action_owners()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  owner_count integer;
  distinct_owner_count integer;
  active_owner_count integer;
begin
  if lower(coalesce(new.status, '')) in ('done', 'completed', 'closed', 'cancelled', 'canceled', 'archived') then
    return new;
  end if;

  if new.owners is null
     or jsonb_typeof(new.owners) <> 'array'
     or jsonb_array_length(new.owners) = 0
  then
    raise exception using errcode = '23514', message = 'ATLAS_ACTIVE_OWNERS_REQUIRED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(new.owners) owner(value)
    where owner.value not in ('ransomed', 'codex', 'claude')
  ) then
    raise exception using errcode = '23514', message = 'ATLAS_ACTIVE_OWNER_NOT_ALLOWED';
  end if;

  select count(*), count(distinct owner.value)
  into owner_count, distinct_owner_count
  from jsonb_array_elements_text(new.owners) owner(value);

  if owner_count <> distinct_owner_count then
    raise exception using errcode = '23514', message = 'ATLAS_DUPLICATE_ACTIVE_OWNER';
  end if;

  select count(*)
  into active_owner_count
  from public.atlas_members member
  where member.id in (select jsonb_array_elements_text(new.owners))
    and member.is_active
    and member.principal_type in ('owner', 'agent');

  if active_owner_count <> owner_count then
    raise exception using errcode = '23514', message = 'ATLAS_ACTIVE_OWNER_REFERENCE_INVALID';
  end if;

  return new;
end
$function$;

revoke all on function public.atlas_validate_active_action_owners() from public;

drop trigger if exists atlas_actions_validate_active_owners on public.atlas_actions;
create trigger atlas_actions_validate_active_owners
before insert or update of status, owners on public.atlas_actions
for each row execute function public.atlas_validate_active_action_owners();

create table if not exists public.atlas_taxonomy_migration_audit (
  id bigint generated by default as identity primary key,
  migration_key text not null,
  source_table text not null,
  source_id text not null,
  field_name text not null,
  old_value jsonb,
  new_value jsonb,
  changed_at timestamptz not null default timezone('utc', now()),
  unique (migration_key, source_table, source_id, field_name)
);

alter table public.atlas_taxonomy_migration_audit enable row level security;
revoke all on table public.atlas_taxonomy_migration_audit from public;
do $migration$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on table public.atlas_taxonomy_migration_audit from %I', role_name);
    end if;
  end loop;
end
$migration$;

create or replace function public.atlas_canonical_business_id(business_id text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select case lower(btrim(business_id))
    when 'real-estate' then 'real_estate'
    when 'real estate' then 'real_estate'
    when 'real_estate' then 'real_estate'
    when 'riddim-exchange' then 'riddim_exchange'
    when 'riddim exchange' then 'riddim_exchange'
    when 'riddim_exchange' then 'riddim_exchange'
    when 'wealth' then 'wealth-os'
    when 'wealth_os' then 'wealth-os'
    when 'wealth-os' then 'wealth-os'
    when 'investments' then 'wealth-os'
    when 'wealth & investments' then 'wealth-os'
    when 'wealth and investments' then 'wealth-os'
    else business_id
  end
$function$;

create or replace function public.atlas_normalize_business_array(business_ids jsonb)
returns jsonb
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select case
    when jsonb_typeof(business_ids) <> 'array' then business_ids
    else coalesce(
      (
        select jsonb_agg(canonical_id order by first_ordinal)
        from (
          select public.atlas_canonical_business_id(item.value) as canonical_id,
                 min(item.ordinality) as first_ordinal
          from jsonb_array_elements_text(business_ids) with ordinality item(value, ordinality)
          group by public.atlas_canonical_business_id(item.value)
        ) normalized
      ),
      '[]'::jsonb
    )
  end
$function$;

create or replace function public.atlas_normalize_business_config(config_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  item jsonb;
  normalized_item jsonb;
  canonical_id text;
  seen_ids text[] := array[]::text[];
  result jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(config_value) <> 'array' then
    return config_value;
  end if;

  for item in select value from jsonb_array_elements(config_value)
  loop
    if jsonb_typeof(item) = 'object' and item ? 'id' then
      canonical_id := public.atlas_canonical_business_id(item ->> 'id');
      normalized_item := jsonb_set(item, '{id}', to_jsonb(canonical_id), true);
      if canonical_id = 'wealth-os' then
        normalized_item := jsonb_set(normalized_item, '{label}', '"Wealth OS"'::jsonb, true);
      end if;
    elsif jsonb_typeof(item) = 'string' then
      canonical_id := public.atlas_canonical_business_id(item #>> '{}');
      normalized_item := to_jsonb(canonical_id);
    else
      canonical_id := null;
      normalized_item := item;
    end if;

    if canonical_id is null or not (canonical_id = any(seen_ids)) then
      result := result || jsonb_build_array(normalized_item);
      if canonical_id is not null then
        seen_ids := array_append(seen_ids, canonical_id);
      end if;
    end if;
  end loop;

  return result;
end
$function$;

-- Audit and normalize action lanes.
insert into public.atlas_taxonomy_migration_audit (
  migration_key, source_table, source_id, field_name, old_value, new_value
)
select '20260709_atlas_owner_principals_and_taxonomy',
       'atlas_actions',
       action.id,
       'business',
       to_jsonb(action.business),
       to_jsonb(public.atlas_canonical_business_id(action.business))
from public.atlas_actions action
where action.business is distinct from public.atlas_canonical_business_id(action.business)
on conflict (migration_key, source_table, source_id, field_name) do nothing;

insert into public.atlas_activity_log (action_id, event, old_value, new_value, actor)
select action.id,
       'taxonomy_normalized',
       action.business,
       public.atlas_canonical_business_id(action.business),
       'system'
from public.atlas_actions action
where action.business is distinct from public.atlas_canonical_business_id(action.business);

update public.atlas_actions action
set business = public.atlas_canonical_business_id(action.business),
    updated_at = timezone('utc', now())
where action.business is distinct from public.atlas_canonical_business_id(action.business);

-- Normalize transcript lanes when the transcript table is present.
do $migration$
begin
  if to_regclass('public.atlas_transcripts') is not null then
    insert into public.atlas_taxonomy_migration_audit (
      migration_key, source_table, source_id, field_name, old_value, new_value
    )
    select '20260709_atlas_owner_principals_and_taxonomy',
           'atlas_transcripts',
           transcript.id,
           'business',
           to_jsonb(transcript.business),
           to_jsonb(public.atlas_canonical_business_id(transcript.business))
    from public.atlas_transcripts transcript
    where transcript.business is distinct from public.atlas_canonical_business_id(transcript.business)
    on conflict (migration_key, source_table, source_id, field_name) do nothing;

    update public.atlas_transcripts transcript
    set business = public.atlas_canonical_business_id(transcript.business)
    where transcript.business is distinct from public.atlas_canonical_business_id(transcript.business);
  end if;
end
$migration$;

insert into public.atlas_taxonomy_migration_audit (
  migration_key, source_table, source_id, field_name, old_value, new_value
)
select '20260709_atlas_owner_principals_and_taxonomy',
       'atlas_members',
       member.id,
       'businesses',
       member.businesses,
       public.atlas_normalize_business_array(member.businesses)
from public.atlas_members member
where member.businesses is distinct from public.atlas_normalize_business_array(member.businesses)
on conflict (migration_key, source_table, source_id, field_name) do nothing;

update public.atlas_members member
set businesses = public.atlas_normalize_business_array(member.businesses)
where member.businesses is distinct from public.atlas_normalize_business_array(member.businesses);

do $migration$
begin
  if to_regclass('public.atlas_config') is not null then
    insert into public.atlas_taxonomy_migration_audit (
      migration_key, source_table, source_id, field_name, old_value, new_value
    )
    select '20260709_atlas_owner_principals_and_taxonomy',
           'atlas_config',
           config.key,
           'value',
           config.value,
           public.atlas_normalize_business_config(config.value)
    from public.atlas_config config
    where config.key = 'businesses'
      and config.value is distinct from public.atlas_normalize_business_config(config.value)
    on conflict (migration_key, source_table, source_id, field_name) do nothing;

    update public.atlas_config config
    set value = public.atlas_normalize_business_config(config.value)
    where config.key = 'businesses'
      and config.value is distinct from public.atlas_normalize_business_config(config.value);
  end if;
end
$migration$;

alter table public.atlas_actions
  add column if not exists evidence_json jsonb not null default '{}'::jsonb;

create or replace function public.atlas_derive_evidence_quality(evidence jsonb)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select case
    when evidence is null or evidence = '{}'::jsonb then 'legacy_unverified'
    when evidence ->> 'kind' = 'verified_execution' then 'verified_execution'
    when evidence ->> 'kind' = 'manual_attestation' then 'manual_attestation'
    when evidence ? 'manual_completion' or evidence ? 'completion_note' then 'manual_attestation'
    else 'legacy_unclassified'
  end
$function$;

alter table public.atlas_actions
  add column if not exists evidence_quality text
    generated always as (public.atlas_derive_evidence_quality(evidence_json)) stored;

comment on column public.atlas_actions.evidence_quality is
  'Derived evidence class: legacy_unverified, legacy_unclassified, manual_attestation, or verified_execution.';

-- Generic proposals: decision timestamps are distinct from verified application.
alter table if exists public.ai_proposals
  add column if not exists decided_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists deferred_at timestamptz,
  add column if not exists closed_at timestamptz;

update public.ai_proposals
set decided_at = coalesce(decided_at, applied_at, proposed_at, timezone('utc', now())),
    approved_at = coalesce(approved_at, applied_at, proposed_at, timezone('utc', now())),
    applied_at = null
where status = 'approved';

update public.ai_proposals
set decided_at = coalesce(decided_at, applied_at, proposed_at, timezone('utc', now())),
    rejected_at = coalesce(rejected_at, applied_at, proposed_at, timezone('utc', now())),
    closed_at = coalesce(closed_at, applied_at, proposed_at, timezone('utc', now())),
    applied_at = null
where status = 'rejected';

update public.ai_proposals
set decided_at = coalesce(decided_at, applied_at, proposed_at, timezone('utc', now())),
    deferred_at = coalesce(deferred_at, applied_at, proposed_at, timezone('utc', now())),
    applied_at = null
where status = 'deferred';

update public.ai_proposals
set decided_at = coalesce(decided_at, applied_at, proposed_at, timezone('utc', now())),
    closed_at = coalesce(closed_at, applied_at, proposed_at, timezone('utc', now()))
where status = 'applied';

alter table if exists public.atlas_today_rule_proposals
  add column if not exists decided_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists deferred_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists applied_at timestamptz;

alter table if exists public.atlas_today_rule_proposals
  drop constraint if exists atlas_today_rule_proposals_status_check;
alter table if exists public.atlas_today_rule_proposals
  add constraint atlas_today_rule_proposals_status_check
    check (status in ('pending', 'approved', 'rejected', 'deferred', 'activated'));

update public.atlas_today_rule_proposals
set decided_at = coalesce(decided_at, updated_at, proposed_at),
    approved_at = coalesce(approved_at, updated_at, proposed_at)
where status = 'approved';

update public.atlas_today_rule_proposals
set decided_at = coalesce(decided_at, updated_at, proposed_at),
    rejected_at = coalesce(rejected_at, updated_at, proposed_at),
    closed_at = coalesce(closed_at, updated_at, proposed_at)
where status = 'rejected';

update public.atlas_today_rule_proposals
set decided_at = coalesce(decided_at, updated_at, proposed_at),
    deferred_at = coalesce(deferred_at, updated_at, proposed_at)
where status = 'deferred';

update public.atlas_today_rule_proposals
set decided_at = coalesce(decided_at, updated_at, proposed_at),
    closed_at = coalesce(closed_at, updated_at, proposed_at),
    applied_at = coalesce(applied_at, updated_at, proposed_at)
where status = 'activated';

create or replace function public.atlas_stamp_proposal_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  decision_time timestamptz := timezone('utc', now());
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'approved' then
    new.decided_at := coalesce(new.decided_at, decision_time);
    new.approved_at := coalesce(new.approved_at, decision_time);
    new.applied_at := null;
  elsif new.status = 'rejected' then
    new.decided_at := coalesce(new.decided_at, decision_time);
    new.rejected_at := coalesce(new.rejected_at, decision_time);
    new.closed_at := coalesce(new.closed_at, decision_time);
    new.applied_at := null;
  elsif new.status = 'deferred' then
    new.decided_at := coalesce(new.decided_at, decision_time);
    new.deferred_at := coalesce(new.deferred_at, decision_time);
    new.applied_at := null;
  elsif new.status in ('applied', 'activated') then
    new.decided_at := coalesce(new.decided_at, decision_time);
    new.closed_at := coalesce(new.closed_at, decision_time);
    new.applied_at := coalesce(new.applied_at, decision_time);
  end if;

  return new;
end
$function$;

revoke all on function public.atlas_stamp_proposal_lifecycle() from public;

drop trigger if exists ai_proposals_stamp_lifecycle on public.ai_proposals;
create trigger ai_proposals_stamp_lifecycle
before update of status on public.ai_proposals
for each row execute function public.atlas_stamp_proposal_lifecycle();

drop trigger if exists atlas_today_rule_proposals_stamp_lifecycle on public.atlas_today_rule_proposals;
create trigger atlas_today_rule_proposals_stamp_lifecycle
before update of status on public.atlas_today_rule_proposals
for each row execute function public.atlas_stamp_proposal_lifecycle();
