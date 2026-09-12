begin;

create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(83);

select has_table('public','atlas_comments','comments table exists');
select has_table('public','atlas_reactions','reactions table exists');
select has_table('public','atlas_discussion_subscriptions','discussion subscriptions exist');
select has_table('public','atlas_collaboration_activity_log','collaboration activity exists');
select has_column('public','atlas_comments','thread_root_id','comments retain thread root');
select has_column('public','atlas_comments','resolution_comment_id','threads retain selected resolution');
select has_column('public','atlas_comments','attachments','comments retain attachments');
select has_column('public','atlas_comments','anchor','comments retain inline anchor');
select has_column('public','atlas_comments','mentions','comments retain mentions');
select has_trigger('public','atlas_comments','atlas_comments_validate_row','comment targets and evidence are validated');
select has_trigger('public','atlas_comments','atlas_comments_audit_row','comment changes are audited');
select has_trigger('public','atlas_comments','atlas_comments_reject_delete','comments reject physical deletion');
select has_trigger('public','atlas_reactions','atlas_reactions_validate_row','reaction targets are validated');
select has_trigger('public','atlas_discussion_subscriptions','atlas_subscriptions_validate_row','subscriptions are validated');
select has_trigger('public','atlas_collaboration_activity_log','atlas_collaboration_activity_reject_mutation','collaboration history is immutable');
select has_function('public','create_atlas_comment',array['text','text','text','text','jsonb','jsonb','jsonb','text'],'comment creation RPC exists');
select has_function('public','update_atlas_comment',array['text','text','jsonb','jsonb','text','bigint'],'comment update RPC exists');
select has_function('public','transition_atlas_comment',array['text','boolean','text','bigint'],'comment lifecycle RPC exists');
select has_function('public','resolve_atlas_comment_thread',array['text','text','boolean','text','bigint'],'thread resolution RPC exists');
select has_function('public','toggle_atlas_reaction',array['text','text','text','text'],'reaction toggle RPC exists');
select has_function('public','set_atlas_discussion_subscription',array['text','text','text','text'],'subscription RPC exists');
select ok(not has_function_privilege('anon','public.create_atlas_comment(text,text,text,text,jsonb,jsonb,jsonb,text)','execute') and not has_function_privilege('authenticated','public.toggle_atlas_reaction(text,text,text,text)','execute'),'public roles cannot execute collaboration RPCs');
select ok(has_function_privilege('service_role','public.create_atlas_comment(text,text,text,text,jsonb,jsonb,jsonb,text)','execute') and has_function_privilege('service_role','public.toggle_atlas_reaction(text,text,text,text)','execute'),'service role can execute collaboration RPCs');
select ok(not has_table_privilege('service_role','public.atlas_comments','delete') and not has_table_privilege('service_role','public.atlas_reactions','delete') and not has_table_privilege('service_role','public.atlas_collaboration_activity_log','update'),'service role cannot delete discussions or rewrite collaboration history');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.atlas_comments'::regclass,'public.atlas_reactions'::regclass,'public.atlas_discussion_subscriptions'::regclass,'public.atlas_collaboration_activity_log'::regclass)),'all collaboration tables enforce RLS');

insert into public.atlas_actions(id,title,description,status,business,priority,owners,tags,evidence_json,created_at,updated_at)
values('__atlas_comment_action__','Comment action','','not_started','personal','p2','["ransomed"]'::jsonb,'[]'::jsonb,'{}'::jsonb,timezone('utc',now()),timezone('utc',now()));
insert into public.atlas_projects(id,name,status,health,created_by,updated_by) values('__atlas_comment_project__','Comment project','planned','on_track','ransomed','ransomed');
insert into public.atlas_initiatives(id,name,status,health,owner_id,labels,created_by,updated_by) values('__atlas_comment_initiative__','Comment initiative','active','on_track','ransomed','[]'::jsonb,'ransomed','ransomed');
insert into public.atlas_documents(id,title,content,context_type,status,revision,created_by,updated_by) values('__atlas_comment_document__','Comment document','Selected text for discussion','workspace','active',0,'ransomed','ransomed');
insert into public.atlas_project_updates(id,project_id,health,body,created_by) values('__atlas_comment_project_update__','__atlas_comment_project__','on_track','Project update','ransomed');
insert into public.atlas_initiative_updates(id,initiative_id,health,body,context_snapshot,created_by) values('__atlas_comment_initiative_update__','__atlas_comment_initiative__','on_track','Initiative update','{}'::jsonb,'ransomed');

create temporary table atlas_comment_results(kind text,result jsonb);
select lives_ok($$insert into atlas_comment_results values('root',public.create_atlas_comment('action','__atlas_comment_action__',null,'Question for @codex','["codex"]'::jsonb,'[{"title":"Design","url":"https://example.com/design","mime_type":"text/html","size_bytes":42}]'::jsonb,'{"field":"description","quote":"Selected text","start":0,"end":13,"source_revision":1}'::jsonb,'ransomed'))$$,'root action comment can be created');
select is((select body from public.atlas_comments where id=(select result->>'id' from atlas_comment_results where kind='root')),'Question for @codex','comment body persists');
select is((select mentions from public.atlas_comments where id=(select result->>'id' from atlas_comment_results where kind='root')),'["codex"]'::jsonb,'canonical mentions persist');
select is((select attachments->0->>'url' from public.atlas_comments where id=(select result->>'id' from atlas_comment_results where kind='root')),'https://example.com/design','HTTPS attachment metadata persists');
select is((select anchor->>'quote' from public.atlas_comments where id=(select result->>'id' from atlas_comment_results where kind='root')),'Selected text','inline anchor quote persists');
select is((select count(*) from public.atlas_discussion_subscriptions where target_type='action' and target_id='__atlas_comment_action__' and status='active'),2::bigint,'author and mention auto-subscribe');

select lives_ok($$insert into atlas_comment_results values('reply1',public.create_atlas_comment('action','__atlas_comment_action__',(select result->>'id' from atlas_comment_results where kind='root'),'First reply','[]'::jsonb,'[]'::jsonb,null,'codex'))$$,'root can receive a reply');
select lives_ok($$insert into atlas_comment_results values('reply2',public.create_atlas_comment('action','__atlas_comment_action__',(select result->>'id' from atlas_comment_results where kind='reply1'),'Nested reply input','[]'::jsonb,'[]'::jsonb,null,'ransomed'))$$,'replying to a reply normalizes to the root');
select is((select thread_root_id from public.atlas_comments where id=(select result->>'id' from atlas_comment_results where kind='reply2')),(select result->>'id' from atlas_comment_results where kind='root'),'normalized reply retains root id');
select is((select parent_comment_id from public.atlas_comments where id=(select result->>'id' from atlas_comment_results where kind='reply2')),(select result->>'id' from atlas_comment_results where kind='root'),'normalized reply stays one level deep');
select is((select count(*) from public.atlas_comments where thread_root_id=(select result->>'id' from atlas_comment_results where kind='root')),2::bigint,'thread has two ordered replies');
select throws_ok($$select public.create_atlas_comment('project','__atlas_comment_project__',(select result->>'id' from atlas_comment_results where kind='root'),'Cross target','[]'::jsonb,'[]'::jsonb,null,'ransomed')$$,'23514','ATLAS_COMMENT_PARENT_TARGET_MISMATCH','reply cannot cross targets');

select lives_ok($$select public.resolve_atlas_comment_thread((select result->>'id' from atlas_comment_results where kind='root'),(select result->>'id' from atlas_comment_results where kind='reply2'),true,'ransomed',0)$$,'thread can resolve to a selected reply');
select is((select resolution_comment_id from public.atlas_comments where id=(select result->>'id' from atlas_comment_results where kind='root')),(select result->>'id' from atlas_comment_results where kind='reply2'),'selected reply is stored as resolution');
select is((select resolved_by from public.atlas_comments where id=(select result->>'id' from atlas_comment_results where kind='root')),'ransomed','thread resolver persists');
select ok((select resolved_at is not null from public.atlas_comments where id=(select result->>'id' from atlas_comment_results where kind='root')),'thread resolution timestamp persists');
select throws_ok($$select public.transition_atlas_comment((select result->>'id' from atlas_comment_results where kind='reply2'),false,'ransomed',0)$$,'55000','ATLAS_COMMENT_IS_THREAD_RESOLUTION','selected resolution cannot archive while the thread is resolved');
select lives_ok($$select public.resolve_atlas_comment_thread((select result->>'id' from atlas_comment_results where kind='root'),null,false,'codex',1)$$,'scoped participant can reopen a thread');
select is((select resolved_at from public.atlas_comments where id=(select result->>'id' from atlas_comment_results where kind='root')),null::timestamptz,'reopening clears resolution state');
select throws_ok($$select public.resolve_atlas_comment_thread((select result->>'id' from atlas_comment_results where kind='root'),'missing',true,'ransomed',2)$$,'23514','ATLAS_COMMENT_RESOLUTION_INVALID','resolution must belong to the thread');

select throws_ok($$select public.update_atlas_comment((select result->>'id' from atlas_comment_results where kind='root'),'Agent rewrite','[]'::jsonb,'[]'::jsonb,'codex',2)$$,'42501','ATLAS_COMMENT_AUTHOR_REQUIRED','non-owner agent cannot edit another author comment');
select lives_ok($$select public.update_atlas_comment((select result->>'id' from atlas_comment_results where kind='root'),'Owner edit','[]'::jsonb,'[]'::jsonb,'ransomed',2)$$,'comment author can edit by revision');
select is((select body from public.atlas_comments where id=(select result->>'id' from atlas_comment_results where kind='root')),'Owner edit','comment edit persists');
select is((select revision from public.atlas_comments where id=(select result->>'id' from atlas_comment_results where kind='root')),3::bigint,'resolve reopen and edit increment revision');
select throws_ok($$select public.update_atlas_comment((select result->>'id' from atlas_comment_results where kind='root'),'Stale edit','[]'::jsonb,'[]'::jsonb,'ransomed',2)$$,'40001','ATLAS_COMMENT_REVISION_CONFLICT','stale comment edit is rejected');
select throws_ok($$select public.transition_atlas_comment((select result->>'id' from atlas_comment_results where kind='reply1'),false,'claude',0)$$,'42501','ATLAS_COMMENT_AUTHOR_REQUIRED','non-author agent cannot archive a comment');
select lives_ok($$select public.transition_atlas_comment((select result->>'id' from atlas_comment_results where kind='reply1'),false,'ransomed',0)$$,'owner can archive any comment');
select is((select status from public.atlas_comments where id=(select result->>'id' from atlas_comment_results where kind='reply1')),'archived','comment archive persists');
select lives_ok($$select public.transition_atlas_comment((select result->>'id' from atlas_comment_results where kind='reply1'),true,'ransomed',1)$$,'owner can restore comment');
select is((select status from public.atlas_comments where id=(select result->>'id' from atlas_comment_results where kind='reply1')),'active','comment restore persists');

select throws_ok($$insert into public.atlas_comments(id,target_type,target_id,body,mentions,attachments,status,created_by,updated_by) values('__bad_attachment__','action','__atlas_comment_action__','Bad','[]'::jsonb,'[{"title":"Local","url":"file:///tmp/secret"}]'::jsonb,'active','ransomed','ransomed')$$,'23514','ATLAS_COMMENT_ATTACHMENT_INVALID','local attachment paths are rejected');
select throws_ok($$insert into public.atlas_comments(id,target_type,target_id,body,mentions,attachments,anchor,status,created_by,updated_by) values('__bad_anchor__','action','__atlas_comment_action__','Bad','[]'::jsonb,'[]'::jsonb,'{"field":"description","quote":"x","start":5,"end":2}'::jsonb,'active','ransomed','ransomed')$$,'23514','ATLAS_COMMENT_ANCHOR_INVALID','invalid anchor offsets are rejected');
select throws_ok($$insert into public.atlas_comments(id,target_type,target_id,body,mentions,attachments,status,created_by,updated_by) values('__bad_mention__','action','__atlas_comment_action__','Bad','["unknown"]'::jsonb,'[]'::jsonb,'active','ransomed','ransomed')$$,'23514','ATLAS_COMMENT_MENTION_INVALID','unknown mentions are rejected');
select throws_ok($$insert into public.atlas_comments(id,target_type,target_id,body,mentions,attachments,status,created_by,updated_by) values('__bad_target__','project','missing','Bad','[]'::jsonb,'[]'::jsonb,'active','ransomed','ransomed')$$,'23503','ATLAS_COMMENT_TARGET_NOT_FOUND','missing discussion targets are rejected');

select lives_ok($$select public.toggle_atlas_reaction('action','__atlas_comment_action__','👍','ransomed')$$,'reaction can be added to an action');
select is((select status from public.atlas_reactions where target_type='action' and target_id='__atlas_comment_action__' and emoji='👍' and actor='ransomed'),'active','first toggle activates reaction');
select lives_ok($$select public.toggle_atlas_reaction('action','__atlas_comment_action__','👍','ransomed')$$,'reaction can be removed');
select is((select status from public.atlas_reactions where target_type='action' and target_id='__atlas_comment_action__' and emoji='👍' and actor='ransomed'),'removed','second toggle removes reaction');
select lives_ok($$select public.toggle_atlas_reaction('action','__atlas_comment_action__','👍','ransomed')$$,'removed reaction can be restored');
select is((select count(*) from public.atlas_reactions where target_type='action' and target_id='__atlas_comment_action__' and emoji='👍' and actor='ransomed'),1::bigint,'reaction toggle remains idempotent in one row');
select is((select status from public.atlas_reactions where target_type='action' and target_id='__atlas_comment_action__' and emoji='👍' and actor='ransomed'),'active','third toggle restores reaction');
select lives_ok($$select public.toggle_atlas_reaction('comment',(select result->>'id' from atlas_comment_results where kind='root'),'✅','codex')$$,'comment can receive a reaction');
select is((select count(*) from public.atlas_reactions where target_type='comment' and target_id=(select result->>'id' from atlas_comment_results where kind='root') and status='active'),1::bigint,'comment reaction persists');
select throws_ok($$select public.toggle_atlas_reaction('action','missing','👍','ransomed')$$,'23503','ATLAS_REACTION_TARGET_NOT_FOUND','reaction target must exist');

select lives_ok($$select public.set_atlas_discussion_subscription('action','__atlas_comment_action__','muted','ransomed')$$,'discussion can be muted');
select is((select status from public.atlas_discussion_subscriptions where target_type='action' and target_id='__atlas_comment_action__' and principal_id='ransomed'),'muted','mute state persists');
select lives_ok($$select public.set_atlas_discussion_subscription('action','__atlas_comment_action__','active','ransomed')$$,'discussion can be followed again');
select is((select count(*) from public.atlas_discussion_subscriptions where target_type='action' and target_id='__atlas_comment_action__' and principal_id='ransomed'),1::bigint,'subscription transition remains one row');

select lives_ok($$select public.create_atlas_comment('project','__atlas_comment_project__',null,'Project comment','[]'::jsonb,'[]'::jsonb,null,'ransomed')$$,'projects accept comments');
select lives_ok($$select public.create_atlas_comment('initiative','__atlas_comment_initiative__',null,'Initiative comment','[]'::jsonb,'[]'::jsonb,null,'ransomed')$$,'initiatives accept comments');
select lives_ok($$select public.create_atlas_comment('document','__atlas_comment_document__',null,'Document comment','[]'::jsonb,'[]'::jsonb,null,'ransomed')$$,'documents accept comments');
select lives_ok($$select public.create_atlas_comment('project_update','__atlas_comment_project_update__',null,'Project update comment','[]'::jsonb,'[]'::jsonb,null,'ransomed')$$,'project updates accept comments');
select lives_ok($$select public.create_atlas_comment('initiative_update','__atlas_comment_initiative_update__',null,'Initiative update comment','[]'::jsonb,'[]'::jsonb,null,'ransomed')$$,'initiative updates accept comments');

select throws_ok($$delete from public.atlas_comments where id=(select result->>'id' from atlas_comment_results where kind='root')$$,'55000','ATLAS_IMMUTABLE_HISTORY','comments cannot be physically deleted');
select throws_ok($$delete from public.atlas_reactions where target_type='action' and target_id='__atlas_comment_action__'$$,'55000','ATLAS_IMMUTABLE_HISTORY','reactions cannot be physically deleted');
select throws_ok($$delete from public.atlas_discussion_subscriptions where target_type='action' and target_id='__atlas_comment_action__'$$,'55000','ATLAS_IMMUTABLE_HISTORY','subscriptions cannot be physically deleted');
select throws_ok($$update public.atlas_collaboration_activity_log set actor='claude' where entity_type='comment'$$,'55000','ATLAS_PROJECT_HISTORY_IMMUTABLE','collaboration history cannot be rewritten');
select ok((select count(*)>=20 from public.atlas_collaboration_activity_log),'collaboration mutations append audit evidence');

select * from finish();
rollback;
