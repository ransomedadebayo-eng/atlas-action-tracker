begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(63);

select has_column('public','atlas_actions','started_at','actions record prospective start time');
select has_column('public','atlas_actions','triaged_at','actions record prospective triage time');
select has_column('public','atlas_actions','canceled_at','actions record cancellation time');
select has_trigger('public','atlas_actions','atlas_actions_manage_lifecycle_timestamps','action lifecycle timestamps are managed');
select has_table('public','atlas_insights','saved Insights exist');
select has_table('public','atlas_dashboards','dashboards exist');
select has_table('public','atlas_dashboard_insights','dashboard Insight bindings exist');
select has_table('public','atlas_insight_snapshots','Insight snapshots exist');
select has_table('public','atlas_export_receipts','export receipts exist');
select has_table('public','atlas_analytics_activity_log','analytics activity exists');
select has_column('public','atlas_insights','measure','Insights store measure');
select has_column('public','atlas_insights','slice_by','Insights store slice');
select has_column('public','atlas_insights','segment_by','Insights store segment');
select has_column('public','atlas_insights','filters','Insights store filters');
select has_column('public','atlas_dashboard_insights','display_type','dashboard cards store presentation');
select has_column('public','atlas_insight_snapshots','source_watermark','snapshots retain source watermark');
select has_column('public','atlas_export_receipts','content_sha256','exports retain content hash');
select has_trigger('public','atlas_insights','atlas_insights_audit_row','Insight changes are audited');
select has_trigger('public','atlas_dashboards','atlas_dashboards_audit_row','dashboard changes are audited');
select has_trigger('public','atlas_insight_snapshots','atlas_insight_snapshots_reject_mutation','snapshots are immutable');
select has_trigger('public','atlas_export_receipts','atlas_export_receipts_reject_mutation','export receipts are immutable');
select has_function('public','record_atlas_insight_snapshot',array['text','text','bigint','jsonb','timestamptz','text'],'snapshot RPC exists');
select has_function('public','record_atlas_export_receipt',array['text','text','text','jsonb','integer','text','text'],'export receipt RPC exists');
select has_function('public','transition_atlas_analytics_entity',array['text','text','boolean','text','bigint'],'analytics lifecycle RPC exists');
select ok(not has_function_privilege('anon','public.record_atlas_insight_snapshot(text,text,bigint,jsonb,timestamptz,text)','execute') and not has_function_privilege('authenticated','public.record_atlas_export_receipt(text,text,text,jsonb,integer,text,text)','execute'),'public roles cannot execute analytics evidence RPCs');
select ok(has_function_privilege('service_role','public.record_atlas_insight_snapshot(text,text,bigint,jsonb,timestamptz,text)','execute') and has_function_privilege('service_role','public.record_atlas_export_receipt(text,text,text,jsonb,integer,text,text)','execute'),'service role can record analytics evidence');
select ok(not has_table_privilege('service_role','public.atlas_insights','delete') and not has_table_privilege('service_role','public.atlas_insight_snapshots','update') and not has_table_privilege('service_role','public.atlas_export_receipts','delete'),'service role cannot delete analytics or rewrite evidence');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.atlas_insights'::regclass,'public.atlas_dashboards'::regclass,'public.atlas_dashboard_insights'::regclass,'public.atlas_insight_snapshots'::regclass,'public.atlas_export_receipts'::regclass,'public.atlas_analytics_activity_log'::regclass)),'all analytics tables enforce RLS');

insert into public.atlas_actions(id,title,description,status,business,priority,owners,tags,evidence_json,created_at,updated_at)
values('__atlas_insight_triage__','Triaged action','','open','personal','p1','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now())-interval '1 day',timezone('utc',now())-interval '1 day'),
('__atlas_insight_plain__','Plain action','','not_started','personal','p2','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now())-interval '2 days',timezone('utc',now())-interval '2 days');
select ok((select triaged_at is not null from public.atlas_actions where id='__atlas_insight_triage__'),'open insertion records triage time');
select is((select started_at from public.atlas_actions where id='__atlas_insight_plain__'),null::timestamptz,'unknown start history remains null');
select lives_ok($$update public.atlas_actions set status='in_progress' where id='__atlas_insight_triage__'$$,'triaged action can start');
select ok((select started_at is not null and started_at>=triaged_at from public.atlas_actions where id='__atlas_insight_triage__'),'start transition records cycle-time boundary');
select lives_ok($$update public.atlas_actions set status='canceled' where id='__atlas_insight_triage__'$$,'action can cancel');
select ok((select canceled_at is not null from public.atlas_actions where id='__atlas_insight_triage__'),'cancel transition records cancellation time');
select lives_ok($$update public.atlas_actions set status='not_started',resolution=null where id='__atlas_insight_triage__'$$,'canceled action can reopen prospectively with resolution cleared');
select is((select canceled_at from public.atlas_actions where id='__atlas_insight_triage__'),null::timestamptz,'reopening clears cancellation time');

insert into public.atlas_insights(id,name,description,measure,slice_by,segment_by,chart_type,filters,time_grouping,include_archived,exclude_no_priority,scope,owner_id,status,revision,created_by,updated_by)
values('__atlas_insight__','Effort by status','Test Insight','effort','status','priority','bar','{"business":"personal"}'::jsonb,'monthly',false,false,'workspace','ransomed','active',0,'ransomed','ransomed');
insert into public.atlas_dashboards(id,name,description,scope,owner_id,filters,status,revision,created_by,updated_by)
values('__atlas_dashboard__','Delivery dashboard','Test dashboard','workspace','ransomed','{"tag":"delivery"}'::jsonb,'active',0,'ransomed','ransomed');
insert into public.atlas_dashboard_insights(id,dashboard_id,insight_id,display_type,position,width,height,filters,status,revision,created_by,updated_by)
values('__atlas_dashboard_card__','__atlas_dashboard__','__atlas_insight__','chart',0,2,1,'{"priority":"p1"}'::jsonb,'active',0,'ransomed','ransomed');
select is((select count(*) from public.atlas_analytics_activity_log where event in('insight_created','dashboard_created','dashboard_insight_created')),3::bigint,'analytics configuration appends audit evidence');
select is((select filters from public.atlas_dashboard_insights where id='__atlas_dashboard_card__'),'{"priority":"p1"}'::jsonb,'dashboard card preserves local filters');
select is((select width from public.atlas_dashboard_insights where id='__atlas_dashboard_card__'),2,'dashboard card layout persists');

select lives_ok($$select public.record_atlas_insight_snapshot('__atlas_snapshot__','__atlas_insight__',0,'{"summary":{"sum":5},"action_ids":["a1"]}'::jsonb,timezone('utc',now()),'ransomed')$$,'current Insight revision can snapshot');
select is((select result->'summary'->>'sum' from public.atlas_insight_snapshots where id='__atlas_snapshot__'),'5','snapshot result persists');
select is((select insight_revision from public.atlas_insight_snapshots where id='__atlas_snapshot__'),0::bigint,'snapshot binds definition revision');
select throws_ok($$select public.record_atlas_insight_snapshot('__atlas_snapshot_stale__','__atlas_insight__',1,'{}'::jsonb,timezone('utc',now()),'ransomed')$$,'40001','ATLAS_INSIGHT_REVISION_CONFLICT','stale definition cannot snapshot');
select throws_ok($$update public.atlas_insight_snapshots set actor='codex' where id='__atlas_snapshot__'$$,'55000','ATLAS_PROJECT_HISTORY_IMMUTABLE','snapshot cannot be rewritten');

select lives_ok($$select public.record_atlas_export_receipt('__atlas_export__','insight','__atlas_insight__','{"business":"personal"}'::jsonb,2,repeat('a',64),'ransomed')$$,'valid export receipt can be recorded');
select is((select row_count from public.atlas_export_receipts where id='__atlas_export__'),2,'export row count persists');
select is((select content_sha256 from public.atlas_export_receipts where id='__atlas_export__'),repeat('a',64),'export content hash persists');
select throws_ok($$select public.record_atlas_export_receipt('__atlas_export_bad__','actions',null,'{}'::jsonb,1,'bad','ransomed')$$,'22023','ATLAS_EXPORT_RECEIPT_INVALID','invalid export hash is rejected');
select throws_ok($$delete from public.atlas_export_receipts where id='__atlas_export__'$$,'55000','ATLAS_PROJECT_HISTORY_IMMUTABLE','export receipt cannot be deleted');

select throws_ok($$select public.transition_atlas_analytics_entity('insight','__atlas_insight__',false,'codex',0)$$,'42501','ATLAS_ANALYTICS_OWNER_REQUIRED','only owner can archive Insight');
select lives_ok($$select public.transition_atlas_analytics_entity('insight','__atlas_insight__',false,'ransomed',0)$$,'Insight can archive');
select is((select status from public.atlas_insights where id='__atlas_insight__'),'archived','Insight archive persists');
select lives_ok($$select public.transition_atlas_analytics_entity('insight','__atlas_insight__',true,'ransomed',1)$$,'Insight can restore');
select is((select status from public.atlas_insights where id='__atlas_insight__'),'active','Insight restore persists');
select lives_ok($$select public.transition_atlas_analytics_entity('dashboard','__atlas_dashboard__',false,'ransomed',0)$$,'dashboard can archive');
select is((select status from public.atlas_dashboards where id='__atlas_dashboard__'),'archived','dashboard archive persists');
select lives_ok($$select public.transition_atlas_analytics_entity('dashboard','__atlas_dashboard__',true,'ransomed',1)$$,'dashboard can restore');
select is((select status from public.atlas_dashboards where id='__atlas_dashboard__'),'active','dashboard restore persists');

select throws_ok($$delete from public.atlas_insights where id='__atlas_insight__'$$,'55000','ATLAS_IMMUTABLE_HISTORY','Insights cannot be physically deleted');
select throws_ok($$delete from public.atlas_dashboards where id='__atlas_dashboard__'$$,'55000','ATLAS_IMMUTABLE_HISTORY','dashboards cannot be physically deleted');
select throws_ok($$delete from public.atlas_dashboard_insights where id='__atlas_dashboard_card__'$$,'55000','ATLAS_IMMUTABLE_HISTORY','dashboard cards cannot be physically deleted');
select throws_ok($$update public.atlas_analytics_activity_log set actor='claude' where entity_type='insight'$$,'55000','ATLAS_PROJECT_HISTORY_IMMUTABLE','analytics activity cannot be rewritten');
select ok((select count(*)>=7 from public.atlas_analytics_activity_log),'analytics lifecycle appends audit evidence');

select * from finish();
rollback;
