begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(101);

select has_table('public','atlas_workflows','workflows exist');
select has_table('public','atlas_workflow_statuses','workflow statuses exist');
select has_table('public','atlas_triage_settings','Triage settings exist');
select has_table('public','atlas_triage_entries','Triage entries exist');
select has_table('public','atlas_triage_events','Triage history exists');
select has_table('public','atlas_workflow_rules','workflow rules exist');
select has_table('public','atlas_workflow_rule_runs','rule receipts exist');
select has_table('public','atlas_inactivity_policy_runs','inactivity receipts exist');
select has_table('public','atlas_workflow_activity_log','workflow audit history exists');
select has_column('public','atlas_actions','workflow_status_id','actions reference configured status');
select has_column('public','atlas_workflow_statuses','category','statuses retain fixed category');
select has_column('public','atlas_workflow_statuses','legacy_status','statuses retain compatibility lifecycle');
select has_column('public','atlas_workflow_statuses','is_default','workflow has default status');
select has_column('public','atlas_workflow_statuses','is_system','reserved statuses are marked');
select has_column('public','atlas_triage_entries','snoozed_until','Triage stores snooze boundary');
select has_column('public','atlas_triage_entries','canonical_action_id','Triage duplicate stores canonical action');
select has_column('public','atlas_workflow_rules','conditions','rules store typed conditions');
select has_column('public','atlas_workflow_rules','effects','rules store safe effects');
select has_column('public','atlas_workflow_rule_runs','conflicts','rule receipts retain conflicts');
select has_column('public','atlas_inactivity_policy_runs','run_key','inactivity runs are idempotent');
select has_trigger('public','atlas_actions','atlas_actions_sync_workflow_status','actions synchronize workflow status');
select has_trigger('public','atlas_actions','atlas_actions_unsnooze_triage','new action activity unsnoozes Triage');
select has_trigger('public','atlas_workflow_statuses','atlas_workflow_statuses_validate','status definitions are validated');
select has_trigger('public','atlas_triage_events','atlas_triage_events_immutable','Triage events are immutable');
select has_trigger('public','atlas_workflow_rule_runs','atlas_workflow_rule_runs_immutable','rule receipts are immutable');
select has_index('public','atlas_triage_entries','atlas_triage_entries_canonical_action_idx','canonical duplicate action FK is indexed');
select has_index('public','atlas_triage_events','atlas_triage_events_action_idx','Triage event action FK is indexed');
select has_index('public','atlas_triage_settings','atlas_triage_settings_accept_status_idx','default accepted status FK is indexed');
select has_function('public','configure_atlas_workflow_status',array['uuid','uuid','text','text','text','text','text','text','integer','boolean','text','bigint'],'status configuration RPC exists');
select has_function('public','archive_atlas_workflow_status',array['uuid','uuid','text','bigint'],'status archive RPC exists');
select has_function('public','reorder_atlas_workflow_statuses',array['uuid','uuid[]','text'],'status reorder RPC exists');
select has_function('public','enter_atlas_triage_action',array['text','text','text','text'],'Triage entry RPC exists');
select has_function('public','transition_atlas_triage_action',array['text','text','text','uuid','text','timestamp with time zone','text','bigint'],'Triage decision RPC exists');
select has_function('public','record_atlas_workflow_rule_run',array['uuid','text','text','text','jsonb','jsonb','jsonb','text','boolean'],'rule receipt RPC exists');
select has_function('public','apply_atlas_inactivity_action',array['uuid','text','text','timestamp with time zone','text','text'],'inactivity action RPC exists');
select ok(not has_function_privilege('anon','public.enter_atlas_triage_action(text,text,text,text)','execute') and not has_function_privilege('authenticated','public.record_atlas_workflow_rule_run(uuid,text,text,text,jsonb,jsonb,jsonb,text,boolean)','execute'),'public roles cannot execute workflow mutation RPCs');
select ok(has_function_privilege('service_role','public.enter_atlas_triage_action(text,text,text,text)','execute') and has_function_privilege('service_role','public.record_atlas_workflow_rule_run(uuid,text,text,text,jsonb,jsonb,jsonb,text,boolean)','execute'),'service role can execute guarded workflow RPCs');
select ok(not has_table_privilege('service_role','public.atlas_workflows','delete') and not has_table_privilege('service_role','public.atlas_workflow_rule_runs','update') and not has_table_privilege('service_role','public.atlas_triage_events','delete'),'service role cannot delete configuration or rewrite history');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.atlas_workflows'::regclass,'public.atlas_workflow_statuses'::regclass,'public.atlas_triage_settings'::regclass,'public.atlas_triage_entries'::regclass,'public.atlas_triage_events'::regclass,'public.atlas_workflow_rules'::regclass,'public.atlas_workflow_rule_runs'::regclass,'public.atlas_inactivity_policy_runs'::regclass,'public.atlas_workflow_activity_log'::regclass)),'all workflow tables enforce RLS');

insert into public.atlas_workflows(id,business,name,description,created_by,updated_by)
values('00000000-0000-4000-8000-000000000001','__workflow_test__','Test workflow','Transactional test workflow','ransomed','ransomed');
select lives_ok($$select public.configure_atlas_workflow_status('00000000-0000-4000-8000-000000000001',null,'triage','Triage','','#f59e0b','triage','open',0,false,'ransomed',null)$$,'Triage status can be created');
select lives_ok($$select public.configure_atlas_workflow_status('00000000-0000-4000-8000-000000000001',null,'todo','Ready','','#a1a1aa','unstarted','not_started',1,true,'ransomed',null)$$,'default status can be created');
select lives_ok($$select public.configure_atlas_workflow_status('00000000-0000-4000-8000-000000000001',null,'in_progress','Building','','#3b82f6','started','in_progress',2,false,'ransomed',null)$$,'started status can be created');
select lives_ok($$select public.configure_atlas_workflow_status('00000000-0000-4000-8000-000000000001',null,'review','In Review','','#8b5cf6','started','in_progress',3,false,'ransomed',null)$$,'second started status can be created');
select lives_ok($$select public.configure_atlas_workflow_status('00000000-0000-4000-8000-000000000001',null,'done','Done','','#22c55e','completed','done',4,false,'ransomed',null)$$,'completed status can be created');
select lives_ok($$select public.configure_atlas_workflow_status('00000000-0000-4000-8000-000000000001',null,'canceled','Canceled','','#737373','canceled','canceled',5,false,'ransomed',null)$$,'canceled status can be created');
insert into public.atlas_workflow_statuses(id,workflow_id,status_key,name,color,category,legacy_status,position,is_system,created_by,updated_by)
values('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000001','duplicate','Duplicate','#52525b','duplicate','done',6,true,'ransomed','ransomed');
select is((select count(*) from public.atlas_workflow_statuses where workflow_id='00000000-0000-4000-8000-000000000001' and archived_at is null),7::bigint,'workflow has all seeded categories plus review');
select is((select name from public.atlas_workflow_statuses where workflow_id='00000000-0000-4000-8000-000000000001' and is_default),'Ready','one default status persists');
select throws_ok($$update public.atlas_workflow_statuses set name='Copy' where id='00000000-0000-4000-8000-000000000099'$$,'23514','ATLAS_SYSTEM_STATUS_IMMUTABLE','reserved Duplicate status is immutable');

insert into public.atlas_triage_settings(workflow_id,enabled,require_priority,responsible_member_ids,default_accept_status_id,auto_close_days,auto_archive_days,auto_close_categories,updated_by)
select '00000000-0000-4000-8000-000000000001',true,true,'["ransomed"]'::jsonb,id,30,60,'["unstarted"]'::jsonb,'ransomed'
from public.atlas_workflow_statuses where workflow_id='00000000-0000-4000-8000-000000000001' and status_key='todo';
select is((select default_accept_status_id is not null from public.atlas_triage_settings where workflow_id='00000000-0000-4000-8000-000000000001'),true,'Triage default accepted status persists');
select throws_ok($$update public.atlas_triage_settings set responsible_member_ids='["unknown"]'::jsonb where workflow_id='00000000-0000-4000-8000-000000000001'$$,'23503','ATLAS_TRIAGE_RESPONSIBILITY_INVALID','unknown Triage responsibility is rejected');

insert into public.atlas_actions(id,title,description,status,business,priority,owners,tags,evidence_json,created_at,updated_at)
values('__atlas_workflow_action__','Workflow action','','not_started','__workflow_test__','p2','["ransomed"]'::jsonb,'["initial"]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now()));
select is((select status_key from public.atlas_workflow_statuses where id=(select workflow_status_id from public.atlas_actions where id='__atlas_workflow_action__')),'todo','new action maps to workflow default');
select is((select status from public.atlas_actions where id='__atlas_workflow_action__'),'not_started','backfill compatibility lifecycle remains unchanged');
select lives_ok($$update public.atlas_actions set workflow_status_id=(select id from public.atlas_workflow_statuses where workflow_id='00000000-0000-4000-8000-000000000001' and status_key='review') where id='__atlas_workflow_action__'$$,'action can select a custom workflow status');
select is((select status from public.atlas_actions where id='__atlas_workflow_action__'),'in_progress','custom started status synchronizes compatibility lifecycle');
select throws_ok($$update public.atlas_actions set workflow_status_id=(select id from public.atlas_workflow_statuses where workflow_id<>(select workflow_id from public.atlas_workflow_statuses where id=(select workflow_status_id from public.atlas_actions where id='__atlas_workflow_action__')) and archived_at is null limit 1) where id='__atlas_workflow_action__'$$,'23503','ATLAS_ACTION_WORKFLOW_STATUS_INVALID','cross-workflow status is rejected');

select lives_ok($$select public.reorder_atlas_workflow_statuses('00000000-0000-4000-8000-000000000001',array(select id from public.atlas_workflow_statuses where workflow_id='00000000-0000-4000-8000-000000000001' and archived_at is null order by position desc),'ransomed')$$,'status order can be changed transactionally');
select is((select min(position) from public.atlas_workflow_statuses where workflow_id='00000000-0000-4000-8000-000000000001'),0,'reorder normalizes first position');
select lives_ok($$select public.archive_atlas_workflow_status((select id from public.atlas_workflow_statuses where workflow_id='00000000-0000-4000-8000-000000000001' and status_key='review'),(select id from public.atlas_workflow_statuses where workflow_id='00000000-0000-4000-8000-000000000001' and status_key='in_progress'),'ransomed',1)$$,'custom status archives with same-category replacement');
select ok((select archived_at is not null from public.atlas_workflow_statuses where workflow_id='00000000-0000-4000-8000-000000000001' and status_key='review'),'custom status archive persists');
select is((select status_key from public.atlas_workflow_statuses where id=(select workflow_status_id from public.atlas_actions where id='__atlas_workflow_action__')),'in_progress','archived status actions move to replacement');
select throws_ok($$select public.archive_atlas_workflow_status((select id from public.atlas_workflow_statuses where workflow_id='00000000-0000-4000-8000-000000000001' and status_key='todo'),(select id from public.atlas_workflow_statuses where workflow_id='00000000-0000-4000-8000-000000000001' and status_key='in_progress'),'ransomed',1)$$,'23514','ATLAS_WORKFLOW_STATUS_ARCHIVE_FORBIDDEN','default status cannot archive');

select lives_ok($$select public.enter_atlas_triage_action('__atlas_workflow_action__','email','message-1','ransomed')$$,'action can enter Triage');
select is((select state from public.atlas_triage_entries where action_id='__atlas_workflow_action__'),'pending','Triage entry starts pending');
select is((select status from public.atlas_actions where id='__atlas_workflow_action__'),'open','Triage entry synchronizes compatibility status');
select is((select status_key from public.atlas_workflow_statuses where id=(select workflow_status_id from public.atlas_actions where id='__atlas_workflow_action__')),'triage','Triage presentation status persists');
select lives_ok($$select public.transition_atlas_triage_action('__atlas_workflow_action__','snooze','ransomed',null,'Waiting',timezone('utc',now())+interval '1 day',null,0)$$,'Triage action can snooze');
select is((select state from public.atlas_triage_entries where action_id='__atlas_workflow_action__'),'snoozed','snooze hides entry');
select lives_ok($$update public.atlas_actions set description='New activity',updated_at=timezone('utc',now()) where id='__atlas_workflow_action__'$$,'new action activity can arrive');
select is((select state from public.atlas_triage_entries where action_id='__atlas_workflow_action__'),'pending','new action activity unsnoozes entry');
select lives_ok($$select public.transition_atlas_triage_action('__atlas_workflow_action__','accept','ransomed',null,'Accepted',null,null,(select revision from public.atlas_triage_entries where action_id='__atlas_workflow_action__'))$$,'Triage action can be accepted');
select is((select state from public.atlas_triage_entries where action_id='__atlas_workflow_action__'),'accepted','accepted state persists');
select is((select status_key from public.atlas_workflow_statuses where id=(select workflow_status_id from public.atlas_actions where id='__atlas_workflow_action__')),'todo','accept uses configured default status');

insert into public.atlas_actions(id,title,description,status,business,priority,owners,tags,evidence_json,created_at,updated_at)
values('__atlas_triage_decline__','Decline me','','not_started','__workflow_test__','p3','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now())),
('__atlas_triage_duplicate__','Duplicate me','','not_started','__workflow_test__','p3','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now())),
('__atlas_triage_canonical__','Canonical','','not_started','__workflow_test__','p2','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now()));
select lives_ok($$select public.enter_atlas_triage_action('__atlas_triage_decline__','manual',null,'ransomed'); select public.transition_atlas_triage_action('__atlas_triage_decline__','decline','ransomed',null,'Not actionable',null,null,null)$$,'Triage action can be declined');
select is((select resolution from public.atlas_actions where id='__atlas_triage_decline__'),'canceled','decline records canceled resolution');
select is((select evidence_json->>'kind' from public.atlas_actions where id='__atlas_triage_decline__'),'triage_decline','decline records typed evidence');
select lives_ok($$select public.enter_atlas_triage_action('__atlas_triage_duplicate__','manual',null,'ransomed'); select public.transition_atlas_triage_action('__atlas_triage_duplicate__','duplicate','ransomed',null,'Already tracked',null,'__atlas_triage_canonical__',null)$$,'Triage action can resolve duplicate');
select is((select duplicate_of_id from public.atlas_actions where id='__atlas_triage_duplicate__'),'__atlas_triage_canonical__','duplicate stores canonical action');
select is((select state from public.atlas_triage_entries where action_id='__atlas_triage_duplicate__'),'duplicate','Triage duplicate decision persists');
select throws_ok($$select public.transition_atlas_triage_action('__atlas_triage_canonical__','snooze','ransomed',null,'',timezone('utc',now())-interval '1 day',null,null)$$,'P0002','ATLAS_TRIAGE_ENTRY_NOT_FOUND','unknown Triage entry cannot snooze');

insert into public.atlas_workflow_rules(id,workflow_id,name,trigger_type,conditions,effects,position,enabled,created_by,updated_by,activated_by,activated_at)
values('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Escalate intake','manual','{"mode":"all","items":[]}'::jsonb,'{"priority":"p0","tags":["initial","routed"]}'::jsonb,0,true,'ransomed','ransomed','ransomed',timezone('utc',now()));
select lives_ok($$select public.record_atlas_workflow_rule_run('00000000-0000-4000-8000-000000000001','__atlas_workflow_action__','preview-1','manual','["10000000-0000-4000-8000-000000000001"]'::jsonb,'{"priority":"p0"}'::jsonb,'[]'::jsonb,'ransomed',true)$$,'rule effects can be previewed');
select is((select status from public.atlas_workflow_rule_runs where event_key='preview-1'),'previewed','preview receipt is labeled');
select is((select priority from public.atlas_actions where id='__atlas_workflow_action__'),'p2','preview does not mutate action');
select lives_ok($$select public.record_atlas_workflow_rule_run('00000000-0000-4000-8000-000000000001','__atlas_workflow_action__','apply-1','manual','["10000000-0000-4000-8000-000000000001"]'::jsonb,'{"priority":"p0","tags":["initial","routed"]}'::jsonb,'[]'::jsonb,'ransomed',false)$$,'safe rule effects can apply');
select is((select priority from public.atlas_actions where id='__atlas_workflow_action__'),'p0','rule priority effect persists');
select is((select tags from public.atlas_actions where id='__atlas_workflow_action__'),'["initial","routed"]'::jsonb,'rule label effect persists');
select lives_ok($$select public.record_atlas_workflow_rule_run('00000000-0000-4000-8000-000000000001','__atlas_workflow_action__','apply-1','manual','["10000000-0000-4000-8000-000000000001"]'::jsonb,'{"priority":"p0"}'::jsonb,'[]'::jsonb,'ransomed',false)$$,'applied event replay is idempotent');
select is((select count(*) from public.atlas_workflow_rule_runs where event_key='apply-1'),1::bigint,'idempotent event has one receipt');
select throws_ok($$select public.record_atlas_workflow_rule_run('00000000-0000-4000-8000-000000000001','__atlas_workflow_action__','unsafe-1','manual','["10000000-0000-4000-8000-000000000001"]'::jsonb,'{"complete":true}'::jsonb,'[]'::jsonb,'ransomed',false)$$,'22023','ATLAS_WORKFLOW_EFFECT_FORBIDDEN','terminal effect is forbidden');
select throws_ok($$select public.record_atlas_workflow_rule_run('00000000-0000-4000-8000-000000000001','__atlas_workflow_action__','unsafe-2','manual','[]'::jsonb,'{}'::jsonb,'[]'::jsonb,'system',false)$$,'22023','ATLAS_ACTOR_NOT_ALLOWED','unknown rule actor is rejected');

insert into public.atlas_actions(id,title,description,status,business,priority,owners,tags,evidence_json,work_mode,approval_state,created_at,updated_at)
values('__atlas_inactive_close__','Stale active','','not_started','__workflow_test__','p2','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,'autonomous','not_required',timezone('utc',now())-interval '50 days',timezone('utc',now())-interval '50 days'),
('__atlas_inactive_protected__','Protected stale','','not_started','__workflow_test__','p2','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,'user_only','needs_review',timezone('utc',now())-interval '50 days',timezone('utc',now())-interval '50 days'),
('__atlas_inactive_archive__','Old completed','','done','__workflow_test__','p2','["ransomed"]'::jsonb,'[]'::jsonb,'{"kind":"manual_attestation","summary":"Done"}'::jsonb,'autonomous','not_required',timezone('utc',now())-interval '100 days',timezone('utc',now())-interval '100 days');
select lives_ok($$select public.apply_atlas_inactivity_action('00000000-0000-4000-8000-000000000001','__atlas_inactive_close__','close',timezone('utc',now()),'inactive-run-1','ransomed')$$,'eligible stale action can close');
select is((select resolution from public.atlas_actions where id='__atlas_inactive_close__'),'canceled','inactivity close records canceled resolution');
select is((select evidence_json->>'kind' from public.atlas_actions where id='__atlas_inactive_close__'),'inactivity_policy','inactivity close records evidence');
select lives_ok($$select public.apply_atlas_inactivity_action('00000000-0000-4000-8000-000000000001','__atlas_inactive_close__','close',timezone('utc',now()),'inactive-run-1','ransomed')$$,'inactivity action replay is idempotent');
select throws_ok($$select public.apply_atlas_inactivity_action('00000000-0000-4000-8000-000000000001','__atlas_inactive_protected__','close',timezone('utc',now()),'inactive-run-2','ransomed')$$,'55000','ATLAS_INACTIVITY_ACTION_NOT_ELIGIBLE','owner obligation is protected from inactivity close');
select lives_ok($$select public.apply_atlas_inactivity_action('00000000-0000-4000-8000-000000000001','__atlas_inactive_archive__','archive',timezone('utc',now()),'inactive-run-3','ransomed')$$,'old terminal action can archive');
select is((select status from public.atlas_actions where id='__atlas_inactive_archive__'),'archived','inactivity archive uses action archive lifecycle');

select throws_ok($$delete from public.atlas_workflows where id='00000000-0000-4000-8000-000000000001'$$,'55000','ATLAS_WORKFLOW_DELETE_FORBIDDEN','workflow cannot be physically deleted');
select throws_ok($$delete from public.atlas_workflow_statuses where workflow_id='00000000-0000-4000-8000-000000000001'$$,'55000','ATLAS_WORKFLOW_DELETE_FORBIDDEN','workflow status cannot be physically deleted');
select throws_ok($$update public.atlas_triage_events set actor='codex' where action_id='__atlas_workflow_action__'$$,'55000','ATLAS_WORKFLOW_HISTORY_IMMUTABLE','Triage history cannot be rewritten');
select throws_ok($$update public.atlas_workflow_rule_runs set actor='codex' where event_key='apply-1'$$,'55000','ATLAS_WORKFLOW_HISTORY_IMMUTABLE','rule receipt cannot be rewritten');
select ok((select count(*)>=5 from public.atlas_workflow_activity_log),'workflow lifecycle appends audit evidence');

select * from finish();
rollback;
