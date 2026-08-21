begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(76);

select has_table('public','atlas_document_operations','realtime document operations exist');
select has_table('public','atlas_document_conflicts','document conflict receipts exist');
select has_column('public','atlas_documents','last_realtime_edit_at','documents store last realtime edit time');
select has_column('public','atlas_documents','last_realtime_actor','documents store last realtime actor');
select has_column('public','atlas_documents','last_realtime_client_id','documents store last realtime client');
select has_column('public','atlas_document_operations','operation_id','operations have client idempotency key');
select has_column('public','atlas_document_operations','base_revision','operations bind base revision');
select has_column('public','atlas_document_operations','applied_revision','operations bind applied revision');
select has_column('public','atlas_document_operations','base_content_sha256','operations bind base content hash');
select has_column('public','atlas_document_operations','result_content_sha256','operations bind result content hash');
select has_column('public','atlas_document_operations','merge_strategy','operations record merge strategy');
select has_column('public','atlas_document_operations','selection','operations record cursor selection');
select has_column('public','atlas_document_conflicts','proposed_content_sha256','conflicts retain proposed hash');
select has_column('public','atlas_document_conflicts','reason','conflicts retain bounded reason');
select has_trigger('public','atlas_document_operations','atlas_document_operations_immutable','operations are immutable');
select has_trigger('public','atlas_document_conflicts','atlas_document_conflicts_immutable','conflicts are immutable');
select has_function('public','apply_atlas_document_realtime_edit',array['text','text','text','bigint','bigint','text','text','text','text','text','jsonb','jsonb','text'],'realtime edit RPC exists');
select has_function('public','record_atlas_document_conflict',array['text','text','text','bigint','bigint','text','text','text','text','jsonb','text'],'conflict receipt RPC exists');
select has_function('public','revert_atlas_document_version',array['text','bigint','text','text','bigint'],'version revert RPC exists');
select ok(not has_function_privilege('anon','public.apply_atlas_document_realtime_edit(text,text,text,bigint,bigint,text,text,text,text,text,jsonb,jsonb,text)','execute') and not has_function_privilege('authenticated','public.revert_atlas_document_version(text,bigint,text,text,bigint)','execute'),'public roles cannot execute realtime document RPCs');
select ok(has_function_privilege('service_role','public.apply_atlas_document_realtime_edit(text,text,text,bigint,bigint,text,text,text,text,text,jsonb,jsonb,text)','execute') and has_function_privilege('service_role','public.revert_atlas_document_version(text,bigint,text,text,bigint)','execute'),'service role can execute realtime document RPCs');
select ok(not has_table_privilege('service_role','public.atlas_document_operations','update') and not has_table_privilege('service_role','public.atlas_document_conflicts','delete'),'service role cannot rewrite realtime history');
select ok((select bool_and(relrowsecurity) from pg_class where oid in('public.atlas_document_operations'::regclass,'public.atlas_document_conflicts'::regclass)),'realtime document tables enforce RLS');

insert into public.atlas_documents(id,title,content,context_type,status,revision,created_by,updated_by)
values('__atlas_realtime_document__','Realtime plan',E'alpha\nbeta\ngamma','workspace','active',0,'ransomed','ransomed');
select is((select count(*) from public.atlas_document_versions where document_id='__atlas_realtime_document__'),1::bigint,'document creation has revision zero version');
select is((select content from public.atlas_document_versions where document_id='__atlas_realtime_document__' and revision=0),E'alpha\nbeta\ngamma','base version content persists');

select lives_ok($$select public.apply_atlas_document_realtime_edit(
  '__atlas_realtime_document__','browser:one','operation-1',0,0,'Realtime plan v2',E'alpha\nBETA\ngamma',
  encode(extensions.digest(convert_to(E'alpha\nbeta\ngamma','UTF8'),'sha256'),'hex'),
  encode(extensions.digest(convert_to(E'alpha\nBETA\ngamma','UTF8'),'sha256'),'hex'),
  'direct','{"start":6,"delete_count":4,"insert_count":4}'::jsonb,'{"start":10,"end":10}'::jsonb,'ransomed')$$,'direct realtime edit applies');
select is((select revision from public.atlas_documents where id='__atlas_realtime_document__'),1::bigint,'direct edit advances revision');
select is((select title from public.atlas_documents where id='__atlas_realtime_document__'),'Realtime plan v2','direct edit updates title');
select is((select content from public.atlas_documents where id='__atlas_realtime_document__'),E'alpha\nBETA\ngamma','direct edit updates content');
select ok((select last_realtime_edit_at is not null and last_realtime_actor='ransomed' and last_realtime_client_id='browser:one' from public.atlas_documents where id='__atlas_realtime_document__'),'document records realtime attribution');
select is((select count(*) from public.atlas_document_versions where document_id='__atlas_realtime_document__'),2::bigint,'accepted edit creates one new version');
select is((select applied_revision from public.atlas_document_operations where document_id='__atlas_realtime_document__' and operation_id='operation-1'),1::bigint,'operation binds applied revision');
select is((select merge_strategy from public.atlas_document_operations where operation_id='operation-1'),'direct','direct merge strategy persists');
select is((select selection from public.atlas_document_operations where operation_id='operation-1'),'{"start":10,"end":10}'::jsonb,'selection persists');
select ok((select base_content_sha256<>result_content_sha256 from public.atlas_document_operations where operation_id='operation-1'),'operation hashes distinguish change');
select is((select count(*) from public.atlas_notification_events event where event.resource_type='document' and event.resource_id='__atlas_realtime_document__')>=2,true,'document create/edit activity reaches notification event stream');

select lives_ok($$select public.apply_atlas_document_realtime_edit(
  '__atlas_realtime_document__','browser:one','operation-1',0,0,'Ignored replay','ignored',repeat('a',64),repeat('b',64),'direct','{}'::jsonb,null,'ransomed')$$,'operation replay is idempotent before validation');
select is((select count(*) from public.atlas_document_operations where document_id='__atlas_realtime_document__' and operation_id='operation-1'),1::bigint,'operation replay preserves one operation');
select is((select revision from public.atlas_documents where id='__atlas_realtime_document__'),1::bigint,'operation replay does not advance revision');
select throws_ok($$select public.apply_atlas_document_realtime_edit('__atlas_realtime_document__','browser:two','stale',0,0,'Stale',E'alpha\nX\ngamma',encode(extensions.digest(convert_to(E'alpha\nbeta\ngamma','UTF8'),'sha256'),'hex'),encode(extensions.digest(convert_to(E'alpha\nX\ngamma','UTF8'),'sha256'),'hex'),'three_way','{}'::jsonb,null,'ransomed')$$,'40001','ATLAS_DOCUMENT_REVISION_CONFLICT','stale expected revision is rejected');
select throws_ok($$select public.apply_atlas_document_realtime_edit('__atlas_realtime_document__','browser:two','bad-actor',0,1,'Plan',E'alpha\nX\ngamma',repeat('a',64),repeat('b',64),'three_way','{}'::jsonb,null,'system')$$,'22023','ATLAS_ACTOR_NOT_ALLOWED','unknown edit actor is rejected');
select throws_ok($$select public.apply_atlas_document_realtime_edit('__atlas_realtime_document__','browser:two','bad-base-hash',0,1,'Plan',E'alpha\nX\ngamma',repeat('a',64),encode(extensions.digest(convert_to(E'alpha\nX\ngamma','UTF8'),'sha256'),'hex'),'three_way','{}'::jsonb,null,'ransomed')$$,'23514','ATLAS_DOCUMENT_BASE_HASH_MISMATCH','wrong base hash is rejected');
select throws_ok($$select public.apply_atlas_document_realtime_edit('__atlas_realtime_document__','browser:two','bad-result-hash',0,1,'Plan',E'alpha\nX\ngamma',encode(extensions.digest(convert_to(E'alpha\nbeta\ngamma','UTF8'),'sha256'),'hex'),repeat('b',64),'three_way','{}'::jsonb,null,'ransomed')$$,'23514','ATLAS_DOCUMENT_RESULT_HASH_MISMATCH','wrong result hash is rejected');
select throws_ok($$select public.apply_atlas_document_realtime_edit('__atlas_realtime_document__','browser:two','bad-selection',0,1,'Plan',E'alpha\nX\ngamma',encode(extensions.digest(convert_to(E'alpha\nbeta\ngamma','UTF8'),'sha256'),'hex'),encode(extensions.digest(convert_to(E'alpha\nX\ngamma','UTF8'),'sha256'),'hex'),'three_way','{}'::jsonb,'{"start":99,"end":100}'::jsonb,'ransomed')$$,'22023','ATLAS_DOCUMENT_SELECTION_INVALID','out-of-range selection is rejected');
select throws_ok($$select public.apply_atlas_document_realtime_edit('__atlas_realtime_document__','browser:two','too-large',0,1,'Plan',repeat('x',204801),encode(extensions.digest(convert_to(E'alpha\nbeta\ngamma','UTF8'),'sha256'),'hex'),encode(extensions.digest(convert_to(repeat('x',204801),'UTF8'),'sha256'),'hex'),'three_way','{}'::jsonb,null,'ransomed')$$,'22023','ATLAS_DOCUMENT_CONTENT_TOO_LARGE','oversized content is rejected');

select lives_ok($$select public.apply_atlas_document_realtime_edit(
  '__atlas_realtime_document__','browser:two','operation-2',0,1,'Realtime plan v2',E'ALPHA\nBETA\ngamma',
  encode(extensions.digest(convert_to(E'alpha\nbeta\ngamma','UTF8'),'sha256'),'hex'),
  encode(extensions.digest(convert_to(E'ALPHA\nBETA\ngamma','UTF8'),'sha256'),'hex'),
  'three_way','{"start":0,"delete_count":5,"insert_count":5}'::jsonb,'{"start":5,"end":5}'::jsonb,'codex')$$,'three-way merged result applies against stored base');
select is((select revision from public.atlas_documents where id='__atlas_realtime_document__'),2::bigint,'three-way edit advances revision');
select is((select content from public.atlas_documents where id='__atlas_realtime_document__'),E'ALPHA\nBETA\ngamma','merged canonical content persists');
select is((select merge_strategy from public.atlas_document_operations where operation_id='operation-2'),'three_way','three-way strategy persists');
select is((select base_revision from public.atlas_document_operations where operation_id='operation-2'),0::bigint,'merged operation retains stale base revision');

select lives_ok($$select public.record_atlas_document_conflict(
  '__atlas_realtime_document__','browser:three','conflict-1',0,2,
  encode(extensions.digest(convert_to(E'alpha\nbeta\ngamma','UTF8'),'sha256'),'hex'),
  encode(extensions.digest(convert_to(E'alpha\nPROPOSED\ngamma','UTF8'),'sha256'),'hex'),
  encode(extensions.digest(convert_to(E'ALPHA\nBETA\ngamma','UTF8'),'sha256'),'hex'),
  'overlapping_change','{"start":6,"end":14}'::jsonb,'claude')$$,'overlapping conflict records without content body');
select is((select count(*) from public.atlas_document_conflicts where document_id='__atlas_realtime_document__' and operation_id='conflict-1'),1::bigint,'one conflict receipt persists');
select is((select reason from public.atlas_document_conflicts where operation_id='conflict-1'),'overlapping_change','conflict reason persists');
select is((select current_revision from public.atlas_document_conflicts where operation_id='conflict-1'),2::bigint,'conflict binds current revision');
select is((select revision from public.atlas_documents where id='__atlas_realtime_document__'),2::bigint,'conflict does not mutate document');
select lives_ok($$select public.record_atlas_document_conflict('__atlas_realtime_document__','browser:three','conflict-1',0,2,repeat('a',64),repeat('b',64),repeat('c',64),'overlapping_change',null,'claude')$$,'conflict replay is idempotent');
select is((select count(*) from public.atlas_document_conflicts where operation_id='conflict-1'),1::bigint,'conflict replay preserves one receipt');
select throws_ok($$select public.record_atlas_document_conflict('__atlas_realtime_document__','browser:three','conflict-2',0,2,repeat('a',64),repeat('b',64),repeat('c',64),'unknown',null,'claude')$$,'23514','new row for relation "atlas_document_conflicts" violates check constraint "atlas_document_conflicts_reason_check"','unknown conflict reason is rejected');

select throws_ok($$select public.revert_atlas_document_version('__atlas_realtime_document__',0,'revert-machine','codex',2)$$,'42501','ATLAS_DOCUMENT_OWNER_REQUIRED','only owner can revert document');
select lives_ok($$select public.revert_atlas_document_version('__atlas_realtime_document__',0,'revert-1','ransomed',2)$$,'owner can revert to stored version');
select is((select revision from public.atlas_documents where id='__atlas_realtime_document__'),3::bigint,'revert creates new head revision');
select is((select content from public.atlas_documents where id='__atlas_realtime_document__'),E'alpha\nbeta\ngamma','revert restores target content');
select is((select merge_strategy from public.atlas_document_operations where operation_id='revert-1'),'revert','revert operation persists');
select is((select base_revision from public.atlas_document_operations where operation_id='revert-1'),2::bigint,'revert binds prior head revision');
select is((select count(*) from public.atlas_document_versions where document_id='__atlas_realtime_document__'),4::bigint,'revert appends version instead of rewriting history');
select throws_ok($$select public.revert_atlas_document_version('__atlas_realtime_document__',0,'revert-stale','ransomed',2)$$,'40001','ATLAS_DOCUMENT_REVISION_CONFLICT','stale revert is rejected');
select throws_ok($$select public.revert_atlas_document_version('__atlas_realtime_document__',99,'revert-missing','ransomed',3)$$,'P0002','ATLAS_DOCUMENT_VERSION_NOT_FOUND','missing target version is rejected');

select lives_ok($$select public.apply_atlas_document_realtime_edit(
  '__atlas_realtime_document__','legacy-rest','legacy-1',3,3,'Realtime plan',E'alpha\nbeta\ngamma\nREST',
  encode(extensions.digest(convert_to(E'alpha\nbeta\ngamma','UTF8'),'sha256'),'hex'),
  encode(extensions.digest(convert_to(E'alpha\nbeta\ngamma\nREST','UTF8'),'sha256'),'hex'),
  'legacy_rest','{"start":16,"delete_count":0,"insert_count":5}'::jsonb,null,'ransomed')$$,'legacy REST update participates in operation history');
select is((select revision from public.atlas_documents where id='__atlas_realtime_document__'),4::bigint,'legacy operation advances revision');
select is((select merge_strategy from public.atlas_document_operations where operation_id='legacy-1'),'legacy_rest','legacy strategy is explicit');

select lives_ok($$select public.transition_atlas_document('__atlas_realtime_document__',false,'ransomed',4)$$,'document can archive');
select throws_ok($$select public.apply_atlas_document_realtime_edit('__atlas_realtime_document__','browser:one','archived-edit',4,5,'Archived','no',encode(extensions.digest(convert_to(E'alpha\nbeta\ngamma\nREST','UTF8'),'sha256'),'hex'),encode(extensions.digest(convert_to('no','UTF8'),'sha256'),'hex'),'direct','{}'::jsonb,null,'ransomed')$$,'55000','ATLAS_DOCUMENT_ARCHIVED','archived document rejects realtime edit');
select throws_ok($$select public.revert_atlas_document_version('__atlas_realtime_document__',0,'archived-revert','ransomed',5)$$,'55000','ATLAS_DOCUMENT_ARCHIVED','archived document rejects revert');

select throws_ok($$delete from public.atlas_document_operations where document_id='__atlas_realtime_document__'$$,'55000','ATLAS_DOCUMENT_REALTIME_HISTORY_IMMUTABLE','operations cannot be deleted');
select throws_ok($$update public.atlas_document_conflicts set actor='codex' where operation_id='conflict-1'$$,'55000','ATLAS_DOCUMENT_REALTIME_HISTORY_IMMUTABLE','conflicts cannot be rewritten');
select ok((select count(*)>=4 from public.atlas_document_operations where document_id='__atlas_realtime_document__'),'accepted edits and revert retain operation evidence');

select * from finish();
rollback;
