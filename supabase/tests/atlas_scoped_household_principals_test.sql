begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(40);

select has_function('public','atlas_principal_is_active',array['text'],'fixed-principal helper exists');
select ok(has_function_privilege('service_role','public.atlas_principal_is_active(text)','execute'),'service role can execute the fixed-principal helper used by invoker triggers');
select is((select count(*) from public.atlas_members where id in ('ransomed','nicole','codex','claude','nicole-codex') and is_active),5::bigint,'all five fixed principals are active');
select is((select count(*) from public.atlas_members where id in ('ransomed','codex','claude') and is_active),3::bigint,'the original three principals remain active');
select is((select principal_type from public.atlas_members where id='nicole'),'human','Nicole is a distinct human principal');
select is((select principal_type from public.atlas_members where id='nicole-codex'),'agent','Nicole Codex is a distinct agent principal');
select is((select delivery_mode from public.atlas_notification_preferences where principal_id='nicole' and channel='inbox' and category='all'),'immediate','Nicole Inbox starts enabled');
select is((select count(*) from public.atlas_notification_preferences where principal_id='nicole' and channel<>'inbox' and delivery_mode='disabled'),4::bigint,'Nicole external notification channels start disabled');
select is((select delivery_mode from public.atlas_notification_preferences where principal_id='nicole-codex' and channel='inbox' and category='all'),'immediate','Nicole Codex Inbox starts enabled');
select is((select count(*) from public.atlas_notification_preferences where principal_id='nicole-codex' and channel<>'inbox' and delivery_mode='disabled'),4::bigint,'Nicole Codex external notification channels start disabled');

select lives_ok($$insert into public.atlas_actions(id,title,description,status,business,priority,owners,tags,evidence_json,created_at,updated_at) values('__atlas_nicole_action__','Nicole action','','not_started','personal','p2','["nicole"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now()))$$,'Nicole can own an action');
select lives_ok($$insert into public.atlas_actions(id,title,description,status,business,priority,owners,tags,evidence_json,created_at,updated_at) values('__atlas_nicole_codex_action__','Nicole Codex action','','not_started','personal','p2','["nicole-codex"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now()))$$,'Nicole Codex can own an action');
select throws_ok($$insert into public.atlas_actions(id,title,description,status,business,priority,owners,tags,evidence_json,created_at,updated_at) values('__atlas_unknown_action__','Unknown action','','not_started','personal','p2','["unknown"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now()))$$,'23514','ATLAS_ACTIVE_OWNER_NOT_ALLOWED','unknown principals remain rejected');
select lives_ok($$select public.complete_atlas_action('__atlas_nicole_action__','{"kind":"manual_attestation","summary":"Nicole confirmed completion"}'::jsonb,'nicole',0)$$,'Nicole can complete her action through the existing lifecycle RPC');
select is((select actor from public.atlas_activity_log where action_id='__atlas_nicole_action__' and event='completed' order by id desc limit 1),'nicole','Nicole lifecycle attribution is preserved');

select lives_ok($$insert into public.atlas_projects(id,name,status,health,lead_id,members,created_by,updated_by) values('__atlas_nicole_project__','Nicole project','planned','no_update','nicole','["nicole","nicole-codex"]'::jsonb,'nicole','nicole')$$,'existing project architecture accepts Nicole principals');
select is((select lead_id from public.atlas_projects where id='__atlas_nicole_project__'),'nicole','Nicole remains the project lead');
select throws_ok($$insert into public.atlas_projects(id,name,status,health,lead_id,members,created_by,updated_by) values('__atlas_bad_project__','Bad project','planned','no_update','unknown','["unknown"]'::jsonb,'nicole','nicole')$$,'23514','ATLAS_PROJECT_LEAD_NOT_ALLOWED','unknown project lead remains rejected');

select lives_ok($$insert into public.atlas_initiatives(id,name,status,health,owner_id,labels,created_by,updated_by) values('__atlas_nicole_initiative__','Nicole initiative','active','no_update','nicole','[]'::jsonb,'nicole','nicole')$$,'existing initiative architecture accepts Nicole ownership');
select is((select owner_id from public.atlas_initiatives where id='__atlas_nicole_initiative__'),'nicole','Nicole remains the initiative owner');
select throws_ok($$select public.transition_atlas_initiative('__atlas_nicole_initiative__',false,'nicole',0)$$,'22023','ATLAS_ACTOR_NOT_ALLOWED','initiative archive remains owner-only');

create temporary table atlas_nicole_comments(kind text primary key,result jsonb);
select lives_ok($$insert into atlas_nicole_comments values('root',public.create_atlas_comment('project','__atlas_nicole_project__',null,'Nicole asks @nicole-codex','["nicole-codex"]'::jsonb,'[]'::jsonb,null,'nicole'))$$,'Nicole can create a comment with a Nicole Codex mention');
select is((select mentions from public.atlas_comments where id=(select result->>'id' from atlas_nicole_comments where kind='root')),'["nicole-codex"]'::jsonb,'Nicole Codex mention persists');
select lives_ok($$insert into atlas_nicole_comments values('reply',public.create_atlas_comment('project','__atlas_nicole_project__',(select result->>'id' from atlas_nicole_comments where kind='root'),'Agent reply','[]'::jsonb,'[]'::jsonb,null,'nicole-codex'))$$,'Nicole Codex can reply distinctly');
select throws_ok($$select public.update_atlas_comment((select result->>'id' from atlas_nicole_comments where kind='root'),'Agent overwrite','[]'::jsonb,'[]'::jsonb,'nicole-codex',0)$$,'42501','ATLAS_COMMENT_AUTHOR_REQUIRED','Nicole Codex cannot edit Nicole''s comment');
select lives_ok($$select public.update_atlas_comment((select result->>'id' from atlas_nicole_comments where kind='reply'),'Agent edit','[]'::jsonb,'[]'::jsonb,'nicole-codex',0)$$,'Nicole Codex can edit its own comment');
select lives_ok($$select public.toggle_atlas_reaction('project','__atlas_nicole_project__','👍','nicole')$$,'Nicole can react through the existing RPC');
select lives_ok($$select public.set_atlas_discussion_subscription('project','__atlas_nicole_project__','active','nicole-codex')$$,'Nicole Codex can follow a discussion');

insert into public.atlas_documents(id,title,content,context_type,status,revision,created_by,updated_by)
values('__atlas_nicole_document__','Household plan','Draft','workspace','active',0,'nicole','nicole');
select lives_ok($$select public.apply_atlas_document_realtime_edit('__atlas_nicole_document__','nicole-browser','op-1',0,0,'Household plan','Draft updated',encode(extensions.digest(convert_to('Draft','UTF8'),'sha256'),'hex'),encode(extensions.digest(convert_to('Draft updated','UTF8'),'sha256'),'hex'),'direct','{}'::jsonb,null,'nicole')$$,'Nicole can edit a realtime document');
select is((select last_realtime_actor from public.atlas_documents where id='__atlas_nicole_document__'),'nicole','realtime document attribution preserves Nicole');
select lives_ok($$select public.record_atlas_document_conflict('__atlas_nicole_document__','nicole-codex-client','conflict-1',0,1,repeat('a',64),repeat('b',64),repeat('c',64),'overlapping_change',null,'nicole-codex')$$,'Nicole Codex can record its document conflict');
select is((select actor from public.atlas_document_conflicts where document_id='__atlas_nicole_document__' and operation_id='conflict-1'),'nicole-codex','document conflict attribution preserves Nicole Codex');

select lives_ok($$select public.emit_atlas_notification_event('__atlas_nicole_event__','test','nicole-1','project_updates','project','__atlas_nicole_project__','updated','nicole','Household project updated','normal','/projects/__atlas_nicole_project__','{}'::jsonb)$$,'existing event fan-out creates principal Inbox rows');
select is((select count(*) from public.atlas_notifications notification join public.atlas_notification_events event on event.id=notification.event_id where event.event_key='__atlas_nicole_event__' and notification.principal_id='nicole'),1::bigint,'Nicole receives her Inbox event');
select is((select count(*) from public.atlas_notifications notification join public.atlas_notification_events event on event.id=notification.event_id where event.event_key='__atlas_nicole_event__' and notification.principal_id='nicole-codex'),1::bigint,'Nicole Codex receives its Inbox event');
select lives_ok($$select public.transition_atlas_notification((select notification.id from public.atlas_notifications notification join public.atlas_notification_events event on event.id=notification.event_id where event.event_key='__atlas_nicole_event__' and notification.principal_id='nicole'),'read','nicole',0)$$,'Nicole can read her own notification');
select throws_ok($$select public.transition_atlas_notification((select notification.id from public.atlas_notifications notification join public.atlas_notification_events event on event.id=notification.event_id where event.event_key='__atlas_nicole_event__' and notification.principal_id='nicole'),'archived','nicole-codex',1)$$,'P0002','ATLAS_NOTIFICATION_NOT_FOUND','Nicole Codex cannot transition Nicole''s notification');
select lives_ok($$select public.upsert_atlas_notification_preference('nicole','inbox','all','digest',60,'nicole',0)$$,'Nicole can update her own notification preference');
select throws_ok($$select public.upsert_atlas_notification_preference('nicole','inbox','all','disabled',null,'nicole-codex',1)$$,'42501','ATLAS_NOTIFICATION_PRINCIPAL_REQUIRED','Nicole Codex cannot update Nicole''s preference');
select throws_ok($$select public.record_atlas_connection_verification('00000000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64),'secret','nicole',null)$$,'42501','ATLAS_INTEGRATION_OWNER_REQUIRED','integration verification remains owner-only');

select * from finish();
rollback;
