begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(46);

select has_column('public', 'atlas_members', 'principal_type', 'members classify owner, agent, and historical principals');
select results_eq(
  $$select id from public.atlas_members where is_active order by id$$,
  $$values ('claude'::text), ('codex'::text), ('ransomed'::text)$$,
  'exactly Ransomed, Codex, and Claude are active'
);
select ok(
  not exists (
    select 1
    from public.atlas_actions action
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(action.owners) = 'array' then action.owners else '[]'::jsonb end
    ) owner(value)
    where lower(coalesce(action.status, '')) not in ('done', 'completed', 'closed', 'cancelled', 'canceled', 'archived')
      and owner.value not in ('ransomed', 'codex', 'claude')
  )
  and not exists (
    select 1
    from public.atlas_actions action
    where lower(coalesce(action.status, '')) not in ('done', 'completed', 'closed', 'cancelled', 'canceled', 'archived')
      and (jsonb_typeof(action.owners) <> 'array' or jsonb_array_length(action.owners) = 0)
  ),
  'active actions have a nonempty allowed owner array'
);
select has_trigger('public', 'atlas_actions', 'atlas_actions_validate_active_owners', 'active owner validation trigger exists');
select has_trigger('public', 'atlas_members', 'atlas_members_validate_principal_roster', 'principal roster validation trigger exists');
select ok(
  not exists (
    select 1
    from pg_trigger trigger
    where trigger.tgrelid = 'public.atlas_actions'::regclass
      and not trigger.tgisinternal
      and (
        lower(trigger.tgname) like '%nicole%'
        or lower(pg_get_triggerdef(trigger.oid)) like '%nicole%'
        or lower(pg_get_functiondef(trigger.tgfoid)) like '%nicole%'
      )
  ),
  'Nicole auto-owner behavior is not attached to atlas_actions'
);

select is(public.atlas_canonical_business_id('Real Estate'), 'real_estate', 'real estate aliases normalize');
select is(public.atlas_canonical_business_id('riddim-exchange'), 'riddim_exchange', 'Riddim aliases normalize');
select is(public.atlas_canonical_business_id('Wealth and Investments'), 'wealth-os', 'Wealth aliases normalize');
select has_table('public', 'atlas_taxonomy_migration_audit', 'taxonomy changes have a durable audit table');
select ok(
  not exists (
    select 1 from public.atlas_actions
    where lower(btrim(business)) in (
      'real-estate', 'real estate', 'riddim-exchange', 'riddim exchange',
      'wealth', 'wealth_os', 'investments', 'wealth & investments', 'wealth and investments'
    )
  ),
  'action business aliases were normalized'
);

select has_column('public', 'atlas_actions', 'evidence_quality', 'actions expose derived evidence quality');
select is(public.atlas_derive_evidence_quality('{}'::jsonb), 'legacy_unverified', 'empty legacy evidence remains unverified');
select is(public.atlas_derive_evidence_quality('{"proof":"old"}'::jsonb), 'legacy_unclassified', 'nonempty legacy evidence is not promoted to verified');
select is(public.atlas_derive_evidence_quality('{"manual_completion":{"note":"done"}}'::jsonb), 'manual_attestation', 'legacy manual evidence is attestation');
select is(public.atlas_derive_evidence_quality('{"kind":"verified_execution"}'::jsonb), 'verified_execution', 'typed verified evidence is recognized');

select has_column('public', 'ai_proposals', 'decided_at', 'generic proposals record a decision timestamp');
select has_column('public', 'ai_proposals', 'approved_at', 'generic proposals record approval separately');
select has_column('public', 'ai_proposals', 'closed_at', 'generic proposals record closure separately');
select has_column('public', 'atlas_today_rule_proposals', 'applied_at', 'Today proposals distinguish verified application');

select ok(
  not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any (array[
        'activate_atlas_today_rule_proposal', 'create_atlas_today_rule_version',
        'propose_atlas_today_rule_change', 'upsert_atlas_today_plan',
        'get_atlas_today_plan', 'run_atlas_today_retriage_dry_run'
      ])
      and has_function_privilege('anon', procedure.oid, 'execute')
  ),
  'anonymous callers cannot execute privileged Today functions'
);
select ok(
  not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any (array[
        'activate_atlas_today_rule_proposal', 'create_atlas_today_rule_version',
        'propose_atlas_today_rule_change', 'upsert_atlas_today_plan',
        'get_atlas_today_plan', 'run_atlas_today_retriage_dry_run'
      ])
      and has_function_privilege('authenticated', procedure.oid, 'execute')
  ),
  'general authenticated callers cannot execute privileged Today functions'
);
select ok(
  not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any (array[
        'activate_atlas_today_rule_proposal', 'create_atlas_today_rule_version',
        'propose_atlas_today_rule_change', 'upsert_atlas_today_plan',
        'get_atlas_today_plan', 'run_atlas_today_retriage_dry_run'
      ])
      and not has_function_privilege('service_role', procedure.oid, 'execute')
  ),
  'service_role retains execution on existing privileged Today functions'
);

select has_function('public', 'complete_atlas_action', array['text', 'jsonb', 'text', 'bigint'], 'completion RPC exists');
select has_function('public', 'archive_atlas_action', array['text', 'text', 'bigint'], 'archive RPC exists');
select has_function('public', 'restore_atlas_action', array['text', 'text', 'bigint'], 'restore RPC exists');
select ok(
  not has_function_privilege('anon', 'public.complete_atlas_action(text,jsonb,text,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.complete_atlas_action(text,jsonb,text,bigint)', 'execute')
  and not has_function_privilege('anon', 'public.archive_atlas_action(text,text,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.archive_atlas_action(text,text,bigint)', 'execute')
  and not has_function_privilege('anon', 'public.restore_atlas_action(text,text,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.restore_atlas_action(text,text,bigint)', 'execute'),
  'action lifecycle RPCs reject public application roles'
);
select ok(
  has_function_privilege('service_role', 'public.complete_atlas_action(text,jsonb,text,bigint)', 'execute')
  and has_function_privilege('service_role', 'public.archive_atlas_action(text,text,bigint)', 'execute')
  and has_function_privilege('service_role', 'public.restore_atlas_action(text,text,bigint)', 'execute'),
  'service_role can execute action lifecycle RPCs'
);

select has_column('public', 'atlas_actions', 'revision', 'actions have an optimistic concurrency revision');
select has_column('public', 'atlas_actions', 'archived_at', 'actions record archive time');
select has_trigger('public', 'atlas_actions', 'atlas_actions_reject_delete', 'action deletion is trigger-blocked');
select has_trigger('public', 'atlas_activity_log', 'atlas_activity_log_reject_delete', 'activity deletion is trigger-blocked');
select ok(
  not has_table_privilege('anon', 'public.atlas_actions', 'delete')
  and not has_table_privilege('authenticated', 'public.atlas_actions', 'delete')
  and not has_table_privilege('service_role', 'public.atlas_actions', 'delete'),
  'ordinary application roles cannot delete actions'
);
select ok(
  not has_table_privilege('anon', 'public.atlas_activity_log', 'delete')
  and not has_table_privilege('authenticated', 'public.atlas_activity_log', 'delete')
  and not has_table_privilege('service_role', 'public.atlas_activity_log', 'delete'),
  'ordinary application roles cannot delete activity history'
);

-- Exercise the transactional lifecycle contract inside this rolled-back test.
insert into public.atlas_actions (
  id, title, description, status, business, priority, owners, evidence_json, created_at, updated_at
)
values (
  '__atlas_trust_overhaul_rpc_test__',
  'ATLAS trust overhaul RPC regression fixture',
  'Rolled back by the database test.',
  'not_started',
  'personal',
  'p3',
  '["ransomed"]'::jsonb,
  '{}'::jsonb,
  timezone('utc', now()),
  timezone('utc', now())
);

create temporary table atlas_rpc_test_results (
  phase text primary key,
  payload jsonb not null
) on commit drop;

create temporary table atlas_rpc_test_state (
  base_revision bigint not null
) on commit drop;

insert into atlas_rpc_test_state (base_revision)
select revision from public.atlas_actions where id = '__atlas_trust_overhaul_rpc_test__';

insert into atlas_rpc_test_results (phase, payload)
values (
  'complete',
  public.complete_atlas_action(
    '__atlas_trust_overhaul_rpc_test__',
    '{"kind":"manual_attestation","summary":"Test completion"}'::jsonb,
    'ransomed',
    (select base_revision from atlas_rpc_test_state)
  )
);

select is(
  (select status from public.atlas_actions where id = '__atlas_trust_overhaul_rpc_test__'),
  'done',
  'completion RPC transitions the action to done'
);
select is(
  (select revision from public.atlas_actions where id = '__atlas_trust_overhaul_rpc_test__'),
  (select base_revision + 1 from atlas_rpc_test_state),
  'completion RPC increments revision exactly once'
);
select is(
  (select evidence_quality from public.atlas_actions where id = '__atlas_trust_overhaul_rpc_test__'),
  'manual_attestation',
  'completion RPC stores typed evidence'
);
select throws_ok(
  format(
    $$select public.complete_atlas_action('__atlas_trust_overhaul_rpc_test__', '{"kind":"manual_attestation"}'::jsonb, 'ransomed', %s)$$,
    (select base_revision from atlas_rpc_test_state)
  ),
  '40001',
  'ATLAS_REVISION_CONFLICT',
  'stale completion revisions raise the concurrency error'
);
select is(
  (select revision from public.atlas_actions where id = '__atlas_trust_overhaul_rpc_test__'),
  (select base_revision + 1 from atlas_rpc_test_state),
  'a rejected stale completion leaves revision unchanged'
);

insert into atlas_rpc_test_results (phase, payload)
values (
  'archive',
  public.archive_atlas_action(
    '__atlas_trust_overhaul_rpc_test__',
    'ransomed',
    (select base_revision + 1 from atlas_rpc_test_state)
  )
);

select ok(
  (select status = 'archived' and revision = (select base_revision + 2 from atlas_rpc_test_state)
   from public.atlas_actions where id = '__atlas_trust_overhaul_rpc_test__'),
  'archive RPC transitions and increments atomically'
);
select ok(
  (select completed_at is null from public.atlas_actions where id = '__atlas_trust_overhaul_rpc_test__'),
  'archive clears the live completion timestamp'
);

insert into atlas_rpc_test_results (phase, payload)
values (
  'restore',
  public.restore_atlas_action(
    '__atlas_trust_overhaul_rpc_test__',
    'ransomed',
    (select base_revision + 2 from atlas_rpc_test_state)
  )
);

select ok(
  (select status = 'done' and revision = (select base_revision + 3 from atlas_rpc_test_state)
   from public.atlas_actions where id = '__atlas_trust_overhaul_rpc_test__'),
  'restore returns to the pre-archive status and increments atomically'
);
select ok(
  (select completed_at is not null from public.atlas_actions where id = '__atlas_trust_overhaul_rpc_test__'),
  'restoring a completed action restores its completion timestamp'
);
select throws_ok(
  format(
    $$select public.complete_atlas_action('__atlas_trust_overhaul_rpc_test__', '{}'::jsonb, 'ransomed', %s)$$,
    (select base_revision + 3 from atlas_rpc_test_state)
  ),
  '22023',
  'ATLAS_COMPLETION_EVIDENCE_REQUIRED',
  'empty completion evidence is rejected'
);
select is(
  (select revision from public.atlas_actions where id = '__atlas_trust_overhaul_rpc_test__'),
  (select base_revision + 3 from atlas_rpc_test_state),
  'invalid completion evidence cannot partially mutate the action'
);
select is(
  (select count(*) from public.atlas_activity_log where action_id = '__atlas_trust_overhaul_rpc_test__'),
  3::bigint,
  'completion, archive, and restore each append one activity event'
);

select * from finish();
rollback;
