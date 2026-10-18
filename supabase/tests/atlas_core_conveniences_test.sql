begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

select has_column('public','atlas_actions','display_number','actions have a stable sequence number');
select has_column('public','atlas_actions','identifier','actions have a human-readable identifier');
select has_table('public','atlas_text_references','text references are durable');
select has_table('public','atlas_text_reference_events','text reference history is append-only');
select has_table('public','atlas_action_project_conversions','conversion receipts are durable');
select has_trigger('public','atlas_actions','atlas_actions_assign_identifier','action identifiers are assigned at the database boundary');
select has_trigger('public','atlas_actions','atlas_actions_sync_text_references','action text references synchronize automatically');
select has_function('public','convert_atlas_action_to_project',array['text','text','text','text','bigint'],'parent conversion RPC exists');
select ok(
  not has_function_privilege('anon','public.convert_atlas_action_to_project(text,text,text,text,bigint)','execute')
  and not has_function_privilege('authenticated','public.convert_atlas_action_to_project(text,text,text,text,bigint)','execute'),
  'public application roles cannot invoke owner lifecycle RPCs'
);
select ok(
  has_function_privilege('service_role','public.convert_atlas_action_to_project(text,text,text,text,bigint)','execute')
  and has_function_privilege('service_role','public.convert_atlas_action_to_project(text,text,text,text,bigint)','execute'),
  'service role can invoke owner lifecycle RPCs'
);

insert into public.atlas_actions(id,title,description,status,business,priority,owners,tags,evidence_json,work_mode,approval_state,created_at,updated_at)
values
  ('__core_reference_target__','Reference target','','not_started','personal','p2','["ransomed"]','[]','{}','autonomous','not_required',timezone('utc',now()),timezone('utc',now())),
  ('__core_reference_source__','Reference source','','not_started','personal','p2','["ransomed"]','[]','{}','autonomous','not_required',timezone('utc',now()),timezone('utc',now()));

select matches((select identifier from public.atlas_actions where id='__core_reference_target__'),'^ATLAS-[0-9]+$','new actions receive readable identifiers');
select isnt(
  (select identifier from public.atlas_actions where id='__core_reference_target__'),
  (select identifier from public.atlas_actions where id='__core_reference_source__'),
  'action identifiers are unique'
);
select throws_ok(
  $$update public.atlas_actions set identifier='ATLAS-999999999' where id='__core_reference_target__'$$,
  '55000','ATLAS_ACTION_IDENTIFIER_IMMUTABLE','action identifiers cannot be rewritten'
);

update public.atlas_actions
set description='See '||(select identifier from public.atlas_actions where id='__core_reference_target__')
where id='__core_reference_source__';
select is((select count(*) from public.atlas_text_references where source_id='__core_reference_source__' and target_action_id='__core_reference_target__' and status='active'),1::bigint,'pasted identifiers create an active reference');
select is((select count(*) from public.atlas_action_relations where note='auto:text_reference' and status='active' and '__core_reference_source__' in(source_action_id,target_action_id)),1::bigint,'action references create an automatic related edge');
update public.atlas_actions set description='' where id='__core_reference_source__';
select is((select status from public.atlas_text_references where source_id='__core_reference_source__' and target_action_id='__core_reference_target__'),'stale','removed references retain stale evidence');
select is((select status from public.atlas_action_relations where note='auto:text_reference' and '__core_reference_source__' in(source_action_id,target_action_id)),'archived','orphaned automatic related edges are archived');

insert into public.atlas_actions(id,title,description,status,business,priority,owners,tags,evidence_json,work_mode,approval_state,created_at,updated_at)
values
  ('__core_convert_parent__','Conversion outcome','Ship the outcome','in_progress','personal','p1','["ransomed"]','[]','{}','autonomous','not_required',timezone('utc',now()),timezone('utc',now())),
  ('__core_convert_child__','Conversion child','','not_started','personal','p2','["ransomed"]','[]','{}','autonomous','not_required',timezone('utc',now()),timezone('utc',now()));
update public.atlas_actions set parent_action_id='__core_convert_parent__' where id='__core_convert_child__';
select lives_ok($$select public.convert_atlas_action_to_project('__core_convert_parent__','__core_converted_project__',null,'ransomed',(select revision from public.atlas_actions where id='__core_convert_parent__'))$$,'a parent action converts transactionally');
select is((select count(*) from public.atlas_projects where id='__core_converted_project__'),1::bigint,'conversion creates one project');
select ok((select project_id='__core_converted_project__' and parent_action_id is null from public.atlas_actions where id='__core_convert_child__'),'children become standalone project actions');
select is((select count(*) from public.atlas_action_project_conversions where source_action_id='__core_convert_parent__'),1::bigint,'conversion retains one immutable receipt');

select hasnt_trigger('public','atlas_actions','atlas_actions_apply_hierarchy_completion_policy','parent completion requires an explicit action transition');

select * from finish();
rollback;
