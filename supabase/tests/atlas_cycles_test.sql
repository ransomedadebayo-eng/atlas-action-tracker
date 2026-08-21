begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(50);

select has_table('public', 'atlas_cycle_schedules', 'cycle schedules table exists');
select has_table('public', 'atlas_cycles', 'generated cycles table exists');
select has_table('public', 'atlas_cycle_scope_events', 'cycle graph events table exists');
select has_table('public', 'atlas_cycle_activity_log', 'cycle activity table exists');
select has_column('public', 'atlas_actions', 'cycle_id', 'actions expose live cycle membership');
select has_trigger('public', 'atlas_cycle_schedules', 'atlas_cycle_schedules_audit_row', 'schedule changes are audited');
select has_trigger('public', 'atlas_cycles', 'atlas_cycles_audit_row', 'cycle changes are audited');
select has_trigger('public', 'atlas_cycles', 'atlas_cycles_protect_snapshot', 'completed snapshots are protected');
select has_trigger('public', 'atlas_actions', 'atlas_actions_capture_cycle_scope', 'action changes append cycle graph points');
select has_trigger('public', 'atlas_actions', 'atlas_actions_auto_add_cycle', 'started actions can auto-join cycles');
select has_trigger('public', 'atlas_cycles', 'atlas_cycles_reject_delete', 'cycle deletion is blocked');
select has_trigger('public', 'atlas_cycle_scope_events', 'atlas_cycle_scope_events_reject_mutation', 'scope events are append-only');

select has_function('public', 'configure_atlas_cycle_schedule', array['text','text','integer','integer','integer','date','text','boolean','boolean','text','bigint'], 'schedule configuration RPC exists');
select has_function('public', 'assign_atlas_action_to_cycle', array['text','text','text'], 'cycle assignment RPC exists');
select has_function('public', 'remove_atlas_action_from_cycle', array['text','text','text'], 'cycle removal RPC exists');
select has_function('public', 'complete_atlas_cycle', array['text','text','bigint','boolean'], 'cycle completion RPC exists');
select has_function('public', 'disable_atlas_cycle_schedule', array['text','text','bigint'], 'cycle disable RPC exists');
select ok(
  not has_function_privilege('anon', 'public.configure_atlas_cycle_schedule(text,text,integer,integer,integer,date,text,boolean,boolean,text,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.assign_atlas_action_to_cycle(text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.complete_atlas_cycle(text,text,bigint,boolean)', 'execute'),
  'public application roles cannot execute cycle mutation RPCs'
);
select ok(
  has_function_privilege('service_role', 'public.configure_atlas_cycle_schedule(text,text,integer,integer,integer,date,text,boolean,boolean,text,bigint)', 'execute')
  and has_function_privilege('service_role', 'public.assign_atlas_action_to_cycle(text,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.complete_atlas_cycle(text,text,bigint,boolean)', 'execute'),
  'service role can execute cycle mutation RPCs'
);
select ok(
  not has_table_privilege('service_role', 'public.atlas_cycles', 'delete')
  and not has_table_privilege('service_role', 'public.atlas_cycle_scope_events', 'update')
  and not has_table_privilege('service_role', 'public.atlas_cycle_scope_events', 'delete'),
  'cycle and scope history cannot be destructively mutated'
);

select lives_ok(
  $$select public.configure_atlas_cycle_schedule('__atlas_cycle_schedule_test__', 'personal', 2, 0, 2, current_date, 'America/Los_Angeles', true, false, 'ransomed', null)$$,
  'a repeating schedule can be configured transactionally'
);
select is((select count(*) from public.atlas_cycle_schedules where id = '__atlas_cycle_schedule_test__'), 1::bigint, 'one schedule is created');
select is((select count(*) from public.atlas_cycles where schedule_id = '__atlas_cycle_schedule_test__' and status = 'active'), 1::bigint, 'the current interval is active');
select is((select count(*) from public.atlas_cycles where schedule_id = '__atlas_cycle_schedule_test__' and status = 'planned'), 2::bigint, 'the configured number of upcoming cycles is created');
select is((select end_date - start_date + 1 from public.atlas_cycles where schedule_id = '__atlas_cycle_schedule_test__' and status = 'active'), 14, 'two-week cycles span fourteen days');

create temporary table atlas_cycle_test_ids as
select
  (select id from public.atlas_cycles where schedule_id = '__atlas_cycle_schedule_test__' and status = 'active') as active_id,
  (select id from public.atlas_cycles where schedule_id = '__atlas_cycle_schedule_test__' and status = 'planned' order by start_date limit 1) as next_id;

insert into public.atlas_actions (id,title,description,status,business,priority,owners,tags,evidence_json,created_at,updated_at)
values
  ('__atlas_cycle_done__','Cycle done action','','in_progress','personal','p2','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now())),
  ('__atlas_cycle_open__','Cycle open action','','in_progress','personal','p2','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now()));

select lives_ok(format($$select public.assign_atlas_action_to_cycle('%s','__atlas_cycle_done__','ransomed')$$, (select active_id from atlas_cycle_test_ids)), 'the first action can join the active cycle');
select lives_ok(format($$select public.assign_atlas_action_to_cycle('%s','__atlas_cycle_open__','ransomed')$$, (select active_id from atlas_cycle_test_ids)), 'the second action can join the active cycle');
select is((select cycle_id from public.atlas_actions where id = '__atlas_cycle_done__'), (select active_id from atlas_cycle_test_ids), 'cycle membership is stored on the action');
select ok((select count(*) > 0 from public.atlas_cycle_scope_events where cycle_id = (select active_id from atlas_cycle_test_ids)), 'cycle membership appends scope graph events');
select lives_ok($$select public.complete_atlas_action('__atlas_cycle_done__','{"kind":"manual_attestation","summary":"Done in cycle"}'::jsonb,'ransomed',(select revision from public.atlas_actions where id='__atlas_cycle_done__'))$$, 'one scoped action can complete');
select lives_ok(format($$select public.complete_atlas_cycle('%s','ransomed',0,true)$$, (select active_id from atlas_cycle_test_ids)), 'the cycle completes and rolls over transactionally');
select is((select status from public.atlas_cycles where id = (select active_id from atlas_cycle_test_ids)), 'completed', 'the old cycle is completed');
select is((select scope_effort_snapshot from public.atlas_cycles where id = (select active_id from atlas_cycle_test_ids)), 2, 'scope effort is frozen');
select is((select completed_effort_snapshot from public.atlas_cycles where id = (select active_id from atlas_cycle_test_ids)), 1, 'completed effort is frozen');
select is((select success_percent_snapshot from public.atlas_cycles where id = (select active_id from atlas_cycle_test_ids)), 62.50::numeric, 'cycle success counts started work at twenty-five percent');
select is((select jsonb_array_length(action_snapshot) from public.atlas_cycles where id = (select active_id from atlas_cycle_test_ids)), 2, 'the completion snapshot preserves scoped action identities');
select is((select cycle_id from public.atlas_actions where id = '__atlas_cycle_open__'), (select next_id from atlas_cycle_test_ids), 'unfinished work rolls to the next cycle');
select is((select cycle_id from public.atlas_actions where id = '__atlas_cycle_done__'), (select active_id from atlas_cycle_test_ids), 'completed work remains attributed to the completed cycle');
select is((select status from public.atlas_cycles where id = (select next_id from atlas_cycle_test_ids)), 'active', 'start-next-now activates the next cycle');
select throws_ok(format($$update public.atlas_cycles set completed_effort_snapshot = 99 where id = '%s'$$, (select active_id from atlas_cycle_test_ids)), '55000', 'ATLAS_CYCLE_SNAPSHOT_IMMUTABLE', 'completed snapshots cannot be rewritten');
select throws_ok(format($$delete from public.atlas_cycles where id = '%s'$$, (select active_id from atlas_cycle_test_ids)), '55000', 'ATLAS_IMMUTABLE_HISTORY', 'cycles cannot be physically deleted');
select throws_ok(format($$delete from public.atlas_cycle_scope_events where cycle_id = '%s'$$, (select active_id from atlas_cycle_test_ids)), '55000', 'ATLAS_PROJECT_HISTORY_IMMUTABLE', 'cycle graph points cannot be deleted');
select lives_ok($$update public.atlas_cycle_schedules set auto_add_started = true, revision = revision + 1, updated_by = 'ransomed' where id = '__atlas_cycle_schedule_test__'$$, 'auto-add can be enabled');
select lives_ok($$insert into public.atlas_actions (id,title,description,status,business,priority,owners,tags,evidence_json,created_at,updated_at) values ('__atlas_cycle_auto__','Auto-added cycle action','','in_progress','personal','p3','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now()))$$, 'a started action can be created under auto-add');
select is((select cycle_id from public.atlas_actions where id = '__atlas_cycle_auto__'), (select next_id from atlas_cycle_test_ids), 'auto-add assigns the active matching cycle');
insert into public.atlas_actions (id,title,description,status,business,priority,owners,tags,evidence_json,created_at,updated_at)
values ('__atlas_cycle_wrong_business__','Wrong business action','','not_started','riddim_exchange','p3','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now()));
select throws_ok(format($$select public.assign_atlas_action_to_cycle('%s','__atlas_cycle_wrong_business__','ransomed')$$, (select next_id from atlas_cycle_test_ids)), '23514', 'ATLAS_CYCLE_ACTION_BUSINESS_MISMATCH', 'business-scoped cycles reject actions from another lane');
select ok((select count(*) > 0 from public.atlas_cycle_activity_log where cycle_id = (select active_id from atlas_cycle_test_ids) and event = 'cycle_rollover_completed'), 'cycle rollover appends lifecycle evidence');
select lives_ok($$select public.disable_atlas_cycle_schedule('__atlas_cycle_schedule_test__','ransomed',1)$$, 'cycles can be disabled transactionally');
select is((select enabled from public.atlas_cycle_schedules where id = '__atlas_cycle_schedule_test__'), false, 'disabling cycles turns off the schedule');
select is((select count(*) from public.atlas_cycles where schedule_id = '__atlas_cycle_schedule_test__' and status = 'planned'), 0::bigint, 'disabling cycles archives upcoming cycles');

select * from finish();
rollback;
