begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(91);

select has_table('public','atlas_release_pipelines','release pipelines exist');
select has_table('public','atlas_release_stages','release stage definitions exist');
select has_table('public','atlas_releases','releases exist');
select has_table('public','atlas_release_stage_runs','release stage runs exist');
select has_table('public','atlas_release_actions','release action attribution exists');
select has_table('public','atlas_release_events','immutable CI events exist');
select has_table('public','atlas_release_activity_log','release activity exists');
select has_column('public','atlas_release_pipelines','access_key_hash','pipeline stores access key hash');
select has_column('public','atlas_release_pipelines','path_filters','pipeline stores path filters');
select has_column('public','atlas_release_stages','freeze_on_start','stage can freeze membership');
select has_column('public','atlas_releases','commit_sha','release stores commit SHA');
select has_column('public','atlas_releases','notes_source','release tracks note source');
select has_column('public','atlas_release_stage_runs','frozen_at','stage run stores freeze evidence');
select has_column('public','atlas_release_events','processing_result','CI event stores processing result');
select has_trigger('public','atlas_release_pipelines','atlas_release_pipelines_audit_row','pipeline changes are audited');
select has_trigger('public','atlas_releases','atlas_releases_audit_row','release changes are audited');
select has_trigger('public','atlas_release_stage_runs','atlas_release_stage_runs_audit_row','stage run changes are audited');
select has_trigger('public','atlas_release_actions','atlas_release_actions_audit_row','release attribution is audited');
select has_trigger('public','atlas_release_events','atlas_release_events_reject_mutation','CI events are immutable');
select has_function('public','create_atlas_release',array['text','text','text','text','text','text','timestamptz','text'],'release creation RPC exists');
select has_function('public','set_atlas_release_action',array['text','text','text','boolean','text','text'],'release action RPC exists');
select has_function('public','transition_atlas_release_stage',array['text','text','text','text','text','bigint'],'stage transition RPC exists');
select has_function('public','generate_atlas_release_notes',array['text','text'],'release notes RPC exists');
select has_function('public','transition_atlas_release',array['text','text','text','text','bigint'],'release transition RPC exists');
select has_function('public','restore_atlas_release',array['text','text','bigint'],'release restore RPC exists');
select has_function('public','rotate_atlas_release_access_key',array['text','text','text','text','bigint'],'pipeline key rotation RPC exists');
select has_function('public','ingest_atlas_release_event',array['text','text','text','text','text','text','text','text','jsonb','timestamptz','jsonb','text'],'CI ingest RPC exists');
select ok(not has_function_privilege('anon','public.ingest_atlas_release_event(text,text,text,text,text,text,text,text,jsonb,timestamptz,jsonb,text)','execute') and not has_function_privilege('authenticated','public.transition_atlas_release(text,text,text,text,bigint)','execute'),'public roles cannot execute release RPCs');
select ok(has_function_privilege('service_role','public.ingest_atlas_release_event(text,text,text,text,text,text,text,text,jsonb,timestamptz,jsonb,text)','execute') and has_function_privilege('service_role','public.transition_atlas_release(text,text,text,text,bigint)','execute'),'service role can execute release RPCs');
select ok(not has_table_privilege('service_role','public.atlas_releases','delete') and not has_table_privilege('service_role','public.atlas_release_events','update') and not has_table_privilege('service_role','public.atlas_release_activity_log','delete'),'service role cannot delete releases or rewrite CI/history');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.atlas_release_pipelines'::regclass,'public.atlas_release_stages'::regclass,'public.atlas_releases'::regclass,'public.atlas_release_stage_runs'::regclass,'public.atlas_release_actions'::regclass,'public.atlas_release_events'::regclass,'public.atlas_release_activity_log'::regclass)),'all release tables enforce RLS');

insert into public.atlas_actions(id,title,description,status,business,priority,owners,tags,evidence_json,created_at,updated_at)
values
('__atlas_release_action_1__','First shipped action','','not_started','personal','p1','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now())),
('__atlas_release_action_2__','Second shipped action','','in_progress','personal','p2','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now())),
('__atlas_release_action_3__','Frozen late action','','not_started','personal','p3','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now())),
('__atlas_release_action_4__','CI action','','not_started','personal','p2','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now())),
('__atlas_release_action_5__','CI late action','','not_started','personal','p3','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now()));

insert into public.atlas_release_pipelines(id,name,pipeline_type,business,path_filters,notes_template,auto_generate_notes,complete_actions_on_release,status,created_by,updated_by)
values('__atlas_release_pipeline__','Scheduled production','scheduled','personal','["app/**"]'::jsonb,E'# {{release_name}} {{version}}\n\n{{issues}}',true,true,'active','ransomed','ransomed'),
('__atlas_release_ci_pipeline__','Continuous web','continuous','personal','["worker/**"]'::jsonb,E'# {{release_name}}\n\n{{issues}}',false,false,'active','ransomed','ransomed');
insert into public.atlas_release_stages(id,pipeline_id,stage_key,name,environment,position,freeze_on_start,created_by,updated_by)
values('__atlas_release_beta__','__atlas_release_pipeline__','beta','Beta','beta',0,false,'ransomed','ransomed'),
('__atlas_release_prod__','__atlas_release_pipeline__','production','Production','production',1,true,'ransomed','ransomed'),
('__atlas_release_ci_prod__','__atlas_release_ci_pipeline__','production','Production','production',0,true,'ransomed','ransomed');

create temporary table atlas_release_results(kind text,result jsonb);
select lives_ok($$insert into atlas_release_results values('manual',public.create_atlas_release('__atlas_release_pipeline__','__atlas_release_manual__',null,'August release','1.0.0','abc123',timezone('utc',now())+interval '7 days','ransomed'))$$,'scheduled release can be created');
select is((select count(*) from public.atlas_release_stage_runs where release_id='__atlas_release_manual__'),2::bigint,'release derives two active stage runs');
select is((select status from public.atlas_releases where id='__atlas_release_manual__'),'planned','new release starts planned');
select is((select count(*) from public.atlas_release_stage_runs run join public.atlas_release_stages stage on stage.id=run.stage_id where run.release_id='__atlas_release_manual__' and stage.position in(0,1)),2::bigint,'stage run ordering matches definitions');

create temporary table atlas_release_run_ids as select
(select run.id from public.atlas_release_stage_runs run join public.atlas_release_stages stage on stage.id=run.stage_id where run.release_id='__atlas_release_manual__' and stage.stage_key='beta') beta_id,
(select run.id from public.atlas_release_stage_runs run join public.atlas_release_stages stage on stage.id=run.stage_id where run.release_id='__atlas_release_manual__' and stage.stage_key='production') prod_id;

select lives_ok($$select public.set_atlas_release_action('__atlas_release_manual__','__atlas_release_action_1__',(select beta_id from atlas_release_run_ids),true,'manual','ransomed')$$,'action can attach to beta stage');
select lives_ok($$select public.set_atlas_release_action('__atlas_release_manual__','__atlas_release_action_2__',(select prod_id from atlas_release_run_ids),true,'manual','ransomed')$$,'action can attach before production freezes');
select is((select count(*) from public.atlas_release_actions where release_id='__atlas_release_manual__' and status='active'),2::bigint,'two release actions are active');
select lives_ok($$select public.transition_atlas_release_stage((select beta_id from atlas_release_run_ids),'started','abc123','https://example.com/beta','ransomed',0)$$,'beta stage can start');
select is((select status from public.atlas_releases where id='__atlas_release_manual__'),'in_progress','starting a stage starts release');
select lives_ok($$select public.transition_atlas_release_stage((select beta_id from atlas_release_run_ids),'completed','abc123','https://example.com/beta','ransomed',1)$$,'started beta stage can complete');
select is((select status from public.atlas_release_stage_runs where id=(select beta_id from atlas_release_run_ids)),'completed','beta completion persists');
select lives_ok($$select public.transition_atlas_release_stage((select prod_id from atlas_release_run_ids),'started','abc123','https://example.com/prod','ransomed',0)$$,'production stage can start');
select ok((select frozen_at is not null from public.atlas_release_stage_runs where id=(select prod_id from atlas_release_run_ids)),'production membership freezes on start');
select throws_ok($$select public.set_atlas_release_action('__atlas_release_manual__','__atlas_release_action_3__',(select prod_id from atlas_release_run_ids),true,'manual','ransomed')$$,'55000','ATLAS_RELEASE_STAGE_FROZEN','frozen stage rejects new action');
select lives_ok($$select public.set_atlas_release_action('__atlas_release_manual__','__atlas_release_action_2__',(select prod_id from atlas_release_run_ids),true,'manual','ransomed')$$,'existing action remains stable in frozen stage');
select lives_ok($$select public.transition_atlas_release_stage((select prod_id from atlas_release_run_ids),'completed','abc123','https://example.com/prod','ransomed',1)$$,'production stage can complete');
select throws_ok($$select public.transition_atlas_release_stage((select prod_id from atlas_release_run_ids),'started',null,null,'ransomed',2)$$,'55000','ATLAS_RELEASE_STAGE_TERMINAL','terminal stage cannot restart');

select lives_ok($$select public.generate_atlas_release_notes('__atlas_release_manual__','ransomed')$$,'deterministic release notes can be generated');
select ok((select notes like '# August release 1.0.0%' and notes like '%First shipped action%' and notes like '%Second shipped action%' from public.atlas_releases where id='__atlas_release_manual__'),'generated notes use template and associated actions');
select is((select notes_source from public.atlas_releases where id='__atlas_release_manual__'),'deterministic','release note source is recorded');
select lives_ok($$select public.transition_atlas_release('__atlas_release_manual__','completed',null,'ransomed',2)$$,'release can complete after generated notes');
select is((select status from public.atlas_releases where id='__atlas_release_manual__'),'completed','release completion persists');
select ok((select released_at is not null from public.atlas_releases where id='__atlas_release_manual__'),'release completion records availability time');
select is((select status from public.atlas_actions where id='__atlas_release_action_1__'),'done','completion automation completes first action');
select is((select status from public.atlas_actions where id='__atlas_release_action_2__'),'done','completion automation completes second action');
select is((select evidence_json->>'kind' from public.atlas_actions where id='__atlas_release_action_1__'),'release_delivery','completion automation uses release evidence');
select throws_ok($$select public.set_atlas_release_action('__atlas_release_manual__','__atlas_release_action_3__',null,true,'manual','ransomed')$$,'55000','ATLAS_RELEASE_TERMINAL','terminal release rejects attribution changes');

select throws_ok($$select public.rotate_atlas_release_access_key('__atlas_release_pipeline__',repeat('a',64),'abcdef123456','codex',0)$$,'42501','ATLAS_RELEASE_OWNER_REQUIRED','only owner can configure pipeline key');
select lives_ok($$select public.rotate_atlas_release_access_key('__atlas_release_pipeline__',repeat('a',64),'abcdef123456','ransomed',0)$$,'owner can configure hashed pipeline key');
select is((select access_key_hash from public.atlas_release_pipelines where id='__atlas_release_pipeline__'),repeat('a',64),'pipeline stores only supplied SHA-256 digest');
select is((select access_key_fingerprint from public.atlas_release_pipelines where id='__atlas_release_pipeline__'),'abcdef123456','pipeline stores short fingerprint');

select lives_ok($$insert into atlas_release_results values('ci-start',public.ingest_atlas_release_event('__atlas_release_ci_pipeline__','event-start','stage_started','deploy-abc','Deploy abc','abc','def456','production','["__atlas_release_action_4__","missing"]'::jsonb,timezone('utc',now()),'{"external_url":"https://example.com/deploy"}'::jsonb,'release_ci'))$$,'CI stage-start event can be ingested');
select is((select count(*) from public.atlas_release_events where pipeline_id='__atlas_release_ci_pipeline__' and event_key='event-start'),1::bigint,'CI event is stored once');
select is((select jsonb_array_length(result->'associated_action_ids') from atlas_release_results where kind='ci-start'),1,'CI event associates known action');
select is((select result->'unknown_action_ids'->>0 from atlas_release_results where kind='ci-start'),'missing','CI result reports unknown action');
select is((select count(*) from public.atlas_releases where pipeline_id='__atlas_release_ci_pipeline__' and external_id='deploy-abc'),1::bigint,'CI event creates one release');
select is((select count(*) from public.atlas_release_actions where action_id='__atlas_release_action_4__' and status='active'),1::bigint,'CI action attribution persists');
select ok((select frozen_at is not null from public.atlas_release_stage_runs where release_id=(select id from public.atlas_releases where pipeline_id='__atlas_release_ci_pipeline__' and external_id='deploy-abc')),'CI stage start freezes production membership');
select lives_ok($$insert into atlas_release_results values('ci-replay',public.ingest_atlas_release_event('__atlas_release_ci_pipeline__','event-start','stage_started','deploy-abc','Deploy abc','abc','def456','production','["__atlas_release_action_4__"]'::jsonb,timezone('utc',now()),'{}'::jsonb,'release_ci'))$$,'CI event replay returns without duplicate mutation');
select is((select result->>'replay' from atlas_release_results where kind='ci-replay'),'true','CI replay is labeled');
select is((select count(*) from public.atlas_release_events where pipeline_id='__atlas_release_ci_pipeline__' and event_key='event-start'),1::bigint,'CI replay preserves one event row');
select is((select count(*) from public.atlas_release_actions where action_id='__atlas_release_action_4__' and status='active'),1::bigint,'CI replay preserves one association');

select lives_ok($$insert into atlas_release_results values('ci-complete-stage',public.ingest_atlas_release_event('__atlas_release_ci_pipeline__','event-stage-complete','stage_completed','deploy-abc','Deploy abc','abc','def456','production','["__atlas_release_action_4__","__atlas_release_action_5__"]'::jsonb,timezone('utc',now()),'{"external_url":"https://example.com/deploy"}'::jsonb,'release_ci'))$$,'CI stage completion processes frozen membership');
select is((select result->'frozen_action_ids'->>0 from atlas_release_results where kind='ci-complete-stage'),'__atlas_release_action_5__','CI result reports action ignored after freeze');
select is((select count(*) from public.atlas_release_actions where action_id='__atlas_release_action_5__'),0::bigint,'frozen late action is not attributed');
select is((select status from public.atlas_release_stage_runs where release_id=(select id from public.atlas_releases where pipeline_id='__atlas_release_ci_pipeline__' and external_id='deploy-abc')),'completed','CI stage completion persists');
select lives_ok($$insert into atlas_release_results values('ci-release-complete',public.ingest_atlas_release_event('__atlas_release_ci_pipeline__','event-release-complete','release_completed','deploy-abc','Deploy abc','abc','def456',null,'["__atlas_release_action_4__"]'::jsonb,timezone('utc',now()),'{"notes":"CI delivered"}'::jsonb,'release_ci'))$$,'CI release completion can be ingested');
select is((select status from public.atlas_releases where pipeline_id='__atlas_release_ci_pipeline__' and external_id='deploy-abc'),'completed','CI release completion persists');
select is((select notes from public.atlas_releases where pipeline_id='__atlas_release_ci_pipeline__' and external_id='deploy-abc'),'CI delivered','CI release notes persist');

select lives_ok($$select public.create_atlas_release('__atlas_release_pipeline__','__atlas_release_archive__',null,'Archive candidate',null,null,null,'ransomed')$$,'archive candidate release can be created');
select lives_ok($$select public.transition_atlas_release('__atlas_release_archive__','archived',null,'ransomed',0)$$,'release can archive');
select is((select status from public.atlas_releases where id='__atlas_release_archive__'),'archived','release archive persists');
select lives_ok($$select public.restore_atlas_release('__atlas_release_archive__','ransomed',1)$$,'owner can restore release');
select is((select status from public.atlas_releases where id='__atlas_release_archive__'),'planned','release restores prior status');

select throws_ok($$delete from public.atlas_release_pipelines where id='__atlas_release_pipeline__'$$,'55000','ATLAS_IMMUTABLE_HISTORY','pipelines cannot be physically deleted');
select throws_ok($$delete from public.atlas_releases where id='__atlas_release_manual__'$$,'55000','ATLAS_IMMUTABLE_HISTORY','releases cannot be physically deleted');
select throws_ok($$delete from public.atlas_release_actions where release_id='__atlas_release_manual__'$$,'55000','ATLAS_IMMUTABLE_HISTORY','release attribution cannot be physically deleted');
select throws_ok($$update public.atlas_release_events set actor='codex' where pipeline_id='__atlas_release_ci_pipeline__'$$,'55000','ATLAS_PROJECT_HISTORY_IMMUTABLE','CI events cannot be rewritten');
select throws_ok($$update public.atlas_release_activity_log set actor='claude' where entity_type='release'$$,'55000','ATLAS_PROJECT_HISTORY_IMMUTABLE','release activity cannot be rewritten');
select ok((select count(*)>=20 from public.atlas_release_activity_log),'release lifecycle appends audit evidence');

select * from finish();
rollback;
