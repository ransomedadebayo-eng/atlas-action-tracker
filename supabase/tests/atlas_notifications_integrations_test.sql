begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(120);

select has_table('public','atlas_notification_events','canonical notification events exist');
select has_table('public','atlas_notification_preferences','notification preferences exist');
select has_table('public','atlas_notification_subscriptions','notification subscriptions exist');
select has_table('public','atlas_notifications','Inbox notifications exist');
select has_table('public','atlas_integration_connections','integration connections exist');
select has_table('public','atlas_integration_subscriptions','integration filters exist');
select has_table('public','atlas_external_references','external identity graph exists');
select has_table('public','atlas_outbox_deliveries','outbox deliveries exist');
select has_table('public','atlas_delivery_attempts','immutable delivery attempts exist');
select has_table('public','atlas_inbound_events','inbound staging exists');
select has_table('public','atlas_integration_activity_log','integration audit history exists');
select has_column('public','atlas_notification_events','event_key','events have idempotency key');
select has_column('public','atlas_notification_events','target_url','events retain Atlas destination');
select has_column('public','atlas_notification_preferences','delivery_mode','preferences store channel timing');
select has_column('public','atlas_notifications','read_at','Inbox stores read time');
select has_column('public','atlas_integration_connections','endpoint_sha256','connections bind endpoint identity');
select has_column('public','atlas_integration_connections','secret_ref','connections store secret reference only');
select has_column('public','atlas_integration_connections','verification_expires_at','verification is time bounded');
select has_column('public','atlas_integration_subscriptions','resource_types','subscriptions filter resource types');
select has_column('public','atlas_outbox_deliveries','delivery_key','deliveries have stable key');
select has_column('public','atlas_outbox_deliveries','attempt_count','delivery retry count persists');
select has_column('public','atlas_delivery_attempts','request_sha256','attempts store request hash');
select has_column('public','atlas_inbound_events','content_sha256','inbound receipts store content hash');
select has_trigger('public','atlas_actions','atlas_actions_sync_notification_subscriptions','assignments auto-subscribe');
select has_trigger('public','atlas_discussion_subscriptions','atlas_discussion_sync_notification_subscription','discussion subscriptions synchronize');
select has_trigger('public','atlas_activity_log','atlas_activity_log_notify','action activity emits notifications');
select has_trigger('public','atlas_project_activity_log','atlas_project_activity_log_notify','project activity emits notifications');
select has_trigger('public','atlas_initiative_activity_log','atlas_initiative_activity_log_notify','initiative activity emits notifications');
select has_trigger('public','atlas_collaboration_activity_log','atlas_collaboration_activity_log_notify','collaboration activity emits notifications');
select has_trigger('public','atlas_delivery_attempts','atlas_delivery_attempts_immutable','delivery attempts are immutable');
select has_index('public','atlas_outbox_deliveries','atlas_outbox_deliveries_subscription_idx','outbox subscription FK is indexed');
select has_function('public','emit_atlas_notification_event',array['text','text','text','text','text','text','text','text','text','text','text','jsonb'],'event fan-out RPC exists');
select has_function('public','transition_atlas_notification',array['uuid','text','text','bigint'],'Inbox lifecycle RPC exists');
select has_function('public','transition_all_atlas_notifications',array['text','text'],'bulk Inbox RPC exists');
select has_function('public','upsert_atlas_notification_preference',array['text','text','text','text','integer','text','bigint'],'preference RPC exists');
select has_function('public','record_atlas_connection_verification',array['uuid','text','text','text','text','bigint'],'connection verification RPC exists');
select has_function('public','transition_atlas_integration_connection',array['uuid','text','text','bigint'],'connection lifecycle RPC exists');
select has_function('public','claim_atlas_delivery',array['uuid','text','text'],'delivery claim RPC exists');
select has_function('public','complete_atlas_delivery_attempt',array['uuid','text','boolean','integer','text','text','integer','text','text'],'delivery result RPC exists');
select has_function('public','record_atlas_inbound_event',array['uuid','text','text','timestamp with time zone','text','jsonb','text'],'inbound receipt RPC exists');
select has_function('public','transition_atlas_inbound_event',array['uuid','text','text','bigint'],'inbound review RPC exists');
select ok(not has_function_privilege('anon','public.emit_atlas_notification_event(text,text,text,text,text,text,text,text,text,text,text,jsonb)','execute') and not has_function_privilege('authenticated','public.claim_atlas_delivery(uuid,text,text)','execute'),'public roles cannot execute notification or delivery RPCs');
select ok(has_function_privilege('service_role','public.emit_atlas_notification_event(text,text,text,text,text,text,text,text,text,text,text,jsonb)','execute') and has_function_privilege('service_role','public.claim_atlas_delivery(uuid,text,text)','execute'),'service role can execute notification and delivery RPCs');
select ok(not has_table_privilege('service_role','public.atlas_notification_events','update') and not has_table_privilege('service_role','public.atlas_delivery_attempts','update') and not has_table_privilege('service_role','public.atlas_integration_activity_log','delete'),'service role cannot rewrite event or delivery history');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.atlas_notification_events'::regclass,'public.atlas_notification_preferences'::regclass,'public.atlas_notification_subscriptions'::regclass,'public.atlas_notifications'::regclass,'public.atlas_integration_connections'::regclass,'public.atlas_integration_subscriptions'::regclass,'public.atlas_external_references'::regclass,'public.atlas_outbox_deliveries'::regclass,'public.atlas_delivery_attempts'::regclass,'public.atlas_inbound_events'::regclass,'public.atlas_integration_activity_log'::regclass)),'all notification and integration tables enforce RLS');

select is((select delivery_mode from public.atlas_notification_preferences where principal_id='ransomed' and channel='inbox' and category='all'),'immediate','owner Inbox starts enabled');
select is((select count(*) from public.atlas_notification_preferences where principal_id='ransomed' and channel<>'inbox' and delivery_mode='disabled'),4::bigint,'all four external channels start disabled');
select throws_ok($$select public.upsert_atlas_notification_preference('ransomed','email','all','immediate',null,'codex',0)$$,'42501','ATLAS_NOTIFICATION_OWNER_REQUIRED','only owner changes notification preferences');
select lives_ok($$select public.upsert_atlas_notification_preference('ransomed','email','all','digest',60,'ransomed',0)$$,'owner can enable digest preference');
select is((select digest_window_minutes from public.atlas_notification_preferences where principal_id='ransomed' and channel='email' and category='all'),60,'digest window persists');
select lives_ok($$select public.upsert_atlas_notification_preference('ransomed','email','all','disabled',null,'ransomed',1)$$,'owner can disable email preference');

insert into public.atlas_actions(id,title,description,status,business,priority,owners,tags,evidence_json,created_at,updated_at)
values('__atlas_notify_action__','Notification action','','not_started','personal','p1','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now()));
select is((select count(*) from public.atlas_notification_subscriptions where principal_id='ransomed' and target_type='action' and target_id='__atlas_notify_action__' and status='active'),1::bigint,'assignment creates one active notification subscription');
select is((select source from public.atlas_notification_subscriptions where principal_id='ransomed' and target_type='action' and target_id='__atlas_notify_action__'),'assignment','assignment subscription source persists');

insert into public.atlas_activity_log(action_id,event,old_value,new_value,actor)
values('__atlas_notify_action__','status_changed','not_started','in_progress','ransomed');
select is((select count(*) from public.atlas_notification_events where resource_type='action' and resource_id='__atlas_notify_action__'),1::bigint,'future action activity creates one event');
select is((select category from public.atlas_notification_events where resource_type='action' and resource_id='__atlas_notify_action__'),'status_changes','action event category is normalized');
select is((select event_action from public.atlas_notification_events where resource_type='action' and resource_id='__atlas_notify_action__'),'updated','action event action is normalized');
select is((select target_url from public.atlas_notification_events where resource_type='action' and resource_id='__atlas_notify_action__'),'/actions/__atlas_notify_action__','action event has Atlas target URL');
select is((select count(*) from public.atlas_notifications where principal_id='ransomed' and event_id=(select id from public.atlas_notification_events where resource_type='action' and resource_id='__atlas_notify_action__')),1::bigint,'event fans out once to owner Inbox');
select is((select status from public.atlas_notifications where principal_id='ransomed' order by created_at desc limit 1),'unread','new Inbox notification starts unread');
select lives_ok($$select public.emit_atlas_notification_event((select event_key from public.atlas_notification_events where resource_type='action' and resource_id='__atlas_notify_action__'),'atlas_activity_log','1','status_changes','action','__atlas_notify_action__','updated','ransomed','Replay','normal','/actions/__atlas_notify_action__','{}'::jsonb)$$,'event replay returns without duplicate fan-out');
select is((select count(*) from public.atlas_notifications where principal_id='ransomed' and event_id=(select id from public.atlas_notification_events where resource_type='action' and resource_id='__atlas_notify_action__')),1::bigint,'event replay preserves one Inbox row');

update public.atlas_notification_subscriptions set status='muted',revision=revision+1 where principal_id='ransomed' and target_type='action' and target_id='__atlas_notify_action__';
insert into public.atlas_activity_log(action_id,event,old_value,new_value,actor)
values('__atlas_notify_action__','priority_changed','p1','p0','ransomed');
select is((select count(*) from public.atlas_notifications notification join public.atlas_notification_events event on event.id=notification.event_id where event.source_table='atlas_activity_log' and event.source_event_id=(select max(id)::text from public.atlas_activity_log where action_id='__atlas_notify_action__')),0::bigint,'muted target suppresses Inbox fan-out');
update public.atlas_notification_subscriptions set status='active',revision=revision+1 where principal_id='ransomed' and target_type='action' and target_id='__atlas_notify_action__';
insert into public.atlas_activity_log(action_id,event,old_value,new_value,actor)
values('__atlas_notify_action__','completed','in_progress','done','ransomed');
select is((select count(*) from public.atlas_notifications notification join public.atlas_notification_events event on event.id=notification.event_id where event.source_table='atlas_activity_log' and event.source_event_id=(select max(id)::text from public.atlas_activity_log where action_id='__atlas_notify_action__')),1::bigint,'active target resumes Inbox fan-out');

create temporary table atlas_notification_ids as select id,revision from public.atlas_notifications where principal_id='ransomed' and status='unread' order by created_at desc limit 1;
select lives_ok($$select public.transition_atlas_notification((select id from atlas_notification_ids),'read','ransomed',(select revision from atlas_notification_ids))$$,'owner can mark notification read');
select ok((select status='read' and read_at is not null from public.atlas_notifications where id=(select id from atlas_notification_ids)),'read state records timestamp');
select throws_ok($$select public.transition_atlas_notification((select id from atlas_notification_ids),'unread','codex',1)$$,'42501','ATLAS_NOTIFICATION_OWNER_REQUIRED','machine cannot alter owner Inbox');
select throws_ok($$select public.transition_atlas_notification((select id from atlas_notification_ids),'unread','ransomed',0)$$,'40001','ATLAS_REVISION_CONFLICT','stale Inbox transition is rejected');
select lives_ok($$select public.transition_atlas_notification((select id from atlas_notification_ids),'unread','ransomed',1)$$,'owner can mark notification unread');
select is((select read_at from public.atlas_notifications where id=(select id from atlas_notification_ids)),null::timestamptz,'unread clears read timestamp');
select lives_ok($$select public.transition_all_atlas_notifications('read','ransomed')$$,'owner can mark all open notifications read');
select is((select count(*) from public.atlas_notifications where principal_id='ransomed' and status='unread'),0::bigint,'bulk read clears unread count');

insert into public.atlas_notification_events(event_key,source_table,source_event_id,category,resource_type,resource_id,event_action,actor,summary,urgency,target_url,payload,created_at)
select '__overflow_event_'||value,'test',value::text,'system','system',value::text,'updated','system','Overflow event','low','/notifications','{}'::jsonb,timezone('utc',now())+value*interval '1 millisecond'
from generate_series(1,2001) value;
insert into public.atlas_notifications(event_id,principal_id,delivery_reason,status,created_at,updated_at)
select id,'ransomed','preference','unread',created_at,created_at from public.atlas_notification_events where event_key like '__overflow_event_%';
select lives_ok($$select public.emit_atlas_notification_event('__overflow_trigger__','test','overflow-trigger','system','system','overflow','updated','system','Retention trigger','low','/notifications','{}'::jsonb)$$,'new event applies Inbox retention');
select is((select count(*) from public.atlas_notifications where principal_id='ransomed' and status in('unread','read')),2000::bigint,'Inbox retains at most 2000 open notifications');
select ok((select count(*)>=2 from public.atlas_notifications where principal_id='ransomed' and status='archived'),'oldest overflow notifications archive without deletion');

insert into public.atlas_integration_connections(id,name,provider,direction,business,endpoint_url,endpoint_host,endpoint_sha256,secret_ref,config,status,created_by,updated_by)
values('20000000-0000-4000-8000-000000000001','Test webhook','webhook','bidirectional','personal','https://hooks.example.com/atlas','hooks.example.com',repeat('a',64),'ATLAS_INTEGRATION_SECRET_TEST','{}'::jsonb,'draft','ransomed','ransomed');
select is((select status from public.atlas_integration_connections where id='20000000-0000-4000-8000-000000000001'),'draft','new connection starts draft');
select throws_ok($$select public.transition_atlas_integration_connection('20000000-0000-4000-8000-000000000001','activate','ransomed',0)$$,'55000','ATLAS_CONNECTION_VERIFICATION_REQUIRED','unverified connection cannot activate');
select throws_ok($$select public.record_atlas_connection_verification('20000000-0000-4000-8000-000000000001',repeat('b',64),repeat('c',64),'abcdef123456','ransomed',0)$$,'23514','ATLAS_CONNECTION_ENDPOINT_CHANGED','verification binds exact endpoint hash');
select lives_ok($$select public.record_atlas_connection_verification('20000000-0000-4000-8000-000000000001',repeat('a',64),repeat('c',64),'abcdef123456','ransomed',0)$$,'signed challenge verification can record');
select ok((select status='pending_verification' and verified_at is not null and verification_expires_at>verified_at from public.atlas_integration_connections where id='20000000-0000-4000-8000-000000000001'),'verification evidence and expiry persist');
select throws_ok($$select public.transition_atlas_integration_connection('20000000-0000-4000-8000-000000000001','activate','codex',1)$$,'42501','ATLAS_INTEGRATION_OWNER_REQUIRED','only owner activates destination');
select lives_ok($$select public.transition_atlas_integration_connection('20000000-0000-4000-8000-000000000001','activate','ransomed',1)$$,'owner activates verified destination');
select is((select status from public.atlas_integration_connections where id='20000000-0000-4000-8000-000000000001'),'active','connection activation persists');

insert into public.atlas_integration_subscriptions(id,connection_id,name,categories,resource_types,event_actions,business,delivery_mode,status,created_by,updated_by)
values('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','All personal activity','["all"]'::jsonb,'["all"]'::jsonb,'["all"]'::jsonb,'personal','immediate','active','ransomed','ransomed');
select lives_ok($$select public.emit_atlas_notification_event('__delivery_event_1__','test','delivery-1','status_changes','action','__atlas_notify_action__','completed','ransomed','Ready to deliver','high','/actions/__atlas_notify_action__','{"business":"personal"}'::jsonb)$$,'matching active subscription creates event');
select is((select count(*) from public.atlas_outbox_deliveries where event_id=(select id from public.atlas_notification_events where event_key='__delivery_event_1__')),1::bigint,'one event creates one delivery per subscription');
select is((select status from public.atlas_outbox_deliveries where event_id=(select id from public.atlas_notification_events where event_key='__delivery_event_1__')),'pending','new delivery starts pending');
create temporary table atlas_delivery_ids as select id from public.atlas_outbox_deliveries where event_id=(select id from public.atlas_notification_events where event_key='__delivery_event_1__');
select lives_ok($$select public.claim_atlas_delivery((select id from atlas_delivery_ids),'claim-token-0000000000000001','delivery_worker')$$,'delivery worker can claim ready delivery');
select is((select attempt_count from public.atlas_outbox_deliveries where id=(select id from atlas_delivery_ids)),1,'first claim increments attempt count');
select throws_ok($$select public.complete_atlas_delivery_attempt((select id from atlas_delivery_ids),'wrong-claim-token-000000000',false,500,repeat('d',64),repeat('a',64),50,'http_500','delivery_worker')$$,'55000','ATLAS_DELIVERY_CLAIM_MISMATCH','wrong claim token cannot record attempt');
select lives_ok($$select public.complete_atlas_delivery_attempt((select id from atlas_delivery_ids),'claim-token-0000000000000001',false,500,repeat('d',64),repeat('a',64),50,'http_500','delivery_worker')$$,'first failure records retry');
select is((select status from public.atlas_outbox_deliveries where id=(select id from atlas_delivery_ids)),'retry_wait','first failure enters retry wait');
select ok((select next_attempt_at between timezone('utc',now())+interval '50 seconds' and timezone('utc',now())+interval '70 seconds' from public.atlas_outbox_deliveries where id=(select id from atlas_delivery_ids)),'first retry waits about one minute');
update public.atlas_outbox_deliveries set next_attempt_at=timezone('utc',now()) where id=(select id from atlas_delivery_ids);
select lives_ok($$select public.claim_atlas_delivery((select id from atlas_delivery_ids),'claim-token-0000000000000002','delivery_worker');select public.complete_atlas_delivery_attempt((select id from atlas_delivery_ids),'claim-token-0000000000000002',false,500,repeat('d',64),repeat('a',64),50,'http_500','delivery_worker')$$,'second failure records retry');
select ok((select next_attempt_at between timezone('utc',now())+interval '59 minutes' and timezone('utc',now())+interval '61 minutes' from public.atlas_outbox_deliveries where id=(select id from atlas_delivery_ids)),'second retry waits about one hour');
update public.atlas_outbox_deliveries set next_attempt_at=timezone('utc',now()) where id=(select id from atlas_delivery_ids);
select lives_ok($$select public.claim_atlas_delivery((select id from atlas_delivery_ids),'claim-token-0000000000000003','delivery_worker');select public.complete_atlas_delivery_attempt((select id from atlas_delivery_ids),'claim-token-0000000000000003',false,500,repeat('d',64),repeat('a',64),50,'http_500','delivery_worker')$$,'third failure records final retry');
select ok((select next_attempt_at between timezone('utc',now())+interval '5 hours 59 minutes' and timezone('utc',now())+interval '6 hours 1 minute' from public.atlas_outbox_deliveries where id=(select id from atlas_delivery_ids)),'third retry waits about six hours');
update public.atlas_outbox_deliveries set next_attempt_at=timezone('utc',now()) where id=(select id from atlas_delivery_ids);
select lives_ok($$select public.claim_atlas_delivery((select id from atlas_delivery_ids),'claim-token-0000000000000004','delivery_worker');select public.complete_atlas_delivery_attempt((select id from atlas_delivery_ids),'claim-token-0000000000000004',false,500,repeat('d',64),repeat('a',64),50,'http_500','delivery_worker')$$,'fourth failure dead-letters');
select is((select status from public.atlas_outbox_deliveries where id=(select id from atlas_delivery_ids)),'dead_letter','initial plus three retries end dead-letter');
select is((select count(*) from public.atlas_delivery_attempts where delivery_id=(select id from atlas_delivery_ids)),4::bigint,'four immutable attempt receipts persist');
select is((select status from public.atlas_integration_connections where id='20000000-0000-4000-8000-000000000001'),'paused','dead-letter pauses destination');

select lives_ok($$select public.transition_atlas_integration_connection('20000000-0000-4000-8000-000000000001','resume','ransomed',6)$$,'owner can resume still-verified destination');
select lives_ok($$select public.emit_atlas_notification_event('__delivery_event_2__','test','delivery-2','project_updates','project','project-1','updated','ransomed','Successful delivery','normal','/projects/project-1','{"business":"personal"}'::jsonb)$$,'new event queues after resume');
create temporary table atlas_delivery_success as select id from public.atlas_outbox_deliveries where event_id=(select id from public.atlas_notification_events where event_key='__delivery_event_2__');
select lives_ok($$select public.claim_atlas_delivery((select id from atlas_delivery_success),'claim-token-success-00000001','delivery_worker');select public.complete_atlas_delivery_attempt((select id from atlas_delivery_success),'claim-token-success-00000001',true,200,repeat('e',64),repeat('a',64),25,'','delivery_worker')$$,'HTTP 200 delivery succeeds');
select is((select status from public.atlas_outbox_deliveries where id=(select id from atlas_delivery_success)),'delivered','successful delivery persists');
select ok((select delivered_at is not null from public.atlas_outbox_deliveries where id=(select id from atlas_delivery_success)),'success records delivery time');
select is((select consecutive_failures from public.atlas_integration_connections where id='20000000-0000-4000-8000-000000000001'),0,'success clears consecutive failures');

select throws_ok($$select public.record_atlas_inbound_event('20000000-0000-4000-8000-000000000001','inbound-1','action.created',timezone('utc',now()),repeat('f',64),'{"title":"External"}'::jsonb,'codex')$$,'42501','ATLAS_INBOUND_HOOK_REQUIRED','only verified hook actor records inbound payload');
select lives_ok($$select public.record_atlas_inbound_event('20000000-0000-4000-8000-000000000001','inbound-1','action.created',timezone('utc',now()),repeat('f',64),'{"title":"External"}'::jsonb,'integration_hook')$$,'verified inbound payload can stage');
select is((select status from public.atlas_inbound_events where delivery_id='inbound-1'),'staged','inbound payload starts staged');
select lives_ok($$select public.record_atlas_inbound_event('20000000-0000-4000-8000-000000000001','inbound-1','action.created',timezone('utc',now()),repeat('f',64),'{"title":"External"}'::jsonb,'integration_hook')$$,'inbound delivery replay is idempotent');
select is((select count(*) from public.atlas_inbound_events where connection_id='20000000-0000-4000-8000-000000000001' and delivery_id='inbound-1'),1::bigint,'inbound replay preserves one receipt');
select is((select count(*) from public.atlas_actions where title='External' and business='personal'),0::bigint,'staged inbound payload cannot mutate actions');
select lives_ok($$select public.transition_atlas_inbound_event((select id from public.atlas_inbound_events where delivery_id='inbound-1'),'reviewed','ransomed',0)$$,'owner can review staged payload');
select ok((select status='reviewed' and reviewed_at is not null from public.atlas_inbound_events where delivery_id='inbound-1'),'inbound review evidence persists');

insert into public.atlas_external_references(connection_id,provider_ref,resource_type,resource_id,sync_mode,external_url,metadata,status,created_by,updated_by)
values('20000000-0000-4000-8000-000000000001','thread-123','action','__atlas_notify_action__','thread','https://chat.example.com/thread/123','{}'::jsonb,'active','ransomed','ransomed');
select is((select sync_mode from public.atlas_external_references where provider_ref='thread-123'),'thread','external thread identity persists');

select throws_ok($$delete from public.atlas_integration_connections where id='20000000-0000-4000-8000-000000000001'$$,'55000','ATLAS_INTEGRATION_DELETE_FORBIDDEN','connection cannot be physically deleted');
select throws_ok($$delete from public.atlas_notifications where principal_id='ransomed'$$,'55000','ATLAS_INTEGRATION_DELETE_FORBIDDEN','Inbox history cannot be physically deleted');
select throws_ok($$update public.atlas_notification_events set actor='codex' where event_key='__delivery_event_1__'$$,'55000','ATLAS_INTEGRATION_HISTORY_IMMUTABLE','canonical events cannot be rewritten');
select throws_ok($$update public.atlas_delivery_attempts set error_code='changed' where delivery_id=(select id from atlas_delivery_ids)$$,'55000','ATLAS_INTEGRATION_HISTORY_IMMUTABLE','delivery attempts cannot be rewritten');
select throws_ok($$update public.atlas_integration_activity_log set actor='claude' where connection_id='20000000-0000-4000-8000-000000000001'$$,'55000','ATLAS_INTEGRATION_HISTORY_IMMUTABLE','integration audit cannot be rewritten');
select ok((select count(*)>=8 from public.atlas_integration_activity_log where connection_id='20000000-0000-4000-8000-000000000001'),'integration lifecycle appends audit evidence');

select * from finish();
rollback;
