begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(36);

select has_column('public','atlas_actions','display_number','actions have a stable sequence number');
select has_column('public','atlas_actions','identifier','actions have a human-readable identifier');
select has_column('public','atlas_workflows','parent_auto_close','workflows configure parent auto-close');
select has_column('public','atlas_workflows','sub_action_auto_close','workflows configure sub-action auto-close');
select has_table('public','atlas_text_references','text references are durable');
select has_table('public','atlas_text_reference_events','text reference history is append-only');
select has_table('public','atlas_action_project_conversions','conversion receipts are durable');
select has_table('public','atlas_hierarchy_automation_events','hierarchy automation evidence is durable');
select has_trigger('public','atlas_actions','atlas_actions_assign_identifier','action identifiers are assigned at the database boundary');
select has_trigger('public','atlas_actions','atlas_actions_apply_hierarchy_completion_policy','hierarchy completion policy runs automatically');
select has_trigger('public','atlas_actions','atlas_actions_sync_text_references','action text references synchronize automatically');
select has_function('public','convert_atlas_action_to_project',array['text','text','text','text','bigint'],'parent conversion RPC exists');
select has_function('public','start_atlas_cycle_today',array['text','text','bigint'],'cycle start-today RPC exists');
select ok(
  not has_function_privilege('anon','public.convert_atlas_action_to_project(text,text,text,text,bigint)','execute')
  and not has_function_privilege('authenticated','public.start_atlas_cycle_today(text,text,bigint)','execute'),
  'public application roles cannot invoke owner lifecycle RPCs'
);
select ok(
  has_function_privilege('service_role','public.convert_atlas_action_to_project(text,text,text,text,bigint)','execute')
  and has_function_privilege('service_role','public.start_atlas_cycle_today(text,text,bigint)','execute'),
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

update public.atlas_workflows set parent_auto_close=true,sub_action_auto_close=false
where business='personal' and archived_at is null;
insert into public.atlas_actions(id,title,description,status,business,priority,owners,tags,evidence_json,work_mode,approval_state,created_at,updated_at)
values
  ('__core_parent_close__','Auto-close parent','','in_progress','personal','p2','["ransomed"]','[]','{}','autonomous','not_required',timezone('utc',now()),timezone('utc',now())),
  ('__core_child_close__','Completing child','','in_progress','personal','p2','["ransomed"]','[]','{}','autonomous','not_required',timezone('utc',now()),timezone('utc',now()));
update public.atlas_actions set parent_action_id='__core_parent_close__' where id='__core_child_close__';
select lives_ok($$select public.complete_atlas_action('__core_child_close__','{"kind":"manual_attestation","summary":"done"}'::jsonb,'ransomed',(select revision from public.atlas_actions where id='__core_child_close__'))$$,'child completion applies the parent policy');
select is((select status from public.atlas_actions where id='__core_parent_close__'),'done','all resolved children close an eligible parent');
select is((select count(*) from public.atlas_hierarchy_automation_events where affected_action_id='__core_parent_close__' and event='parent_auto_closed'),1::bigint,'parent auto-close retains evidence');

update public.atlas_workflows set parent_auto_close=false,sub_action_auto_close=true
where business='personal' and archived_at is null;
insert into public.atlas_actions(id,title,description,status,business,priority,owners,tags,evidence_json,work_mode,approval_state,created_at,updated_at)
values
  ('__core_parent_children__','Close children parent','','in_progress','personal','p2','["ransomed"]','[]','{}','autonomous','not_required',timezone('utc',now()),timezone('utc',now())),
  ('__core_child_eligible__','Eligible child','','in_progress','personal','p2','["ransomed"]','[]','{}','autonomous','not_required',timezone('utc',now()),timezone('utc',now())),
  ('__core_child_protected__','Protected child','','in_progress','personal','p2','["ransomed"]','[]','{}','user_only','needs_review',timezone('utc',now()),timezone('utc',now()));
update public.atlas_actions set parent_action_id='__core_parent_children__' where id in('__core_child_eligible__','__core_child_protected__');
select lives_ok($$select public.complete_atlas_action('__core_parent_children__','{"kind":"manual_attestation","summary":"done"}'::jsonb,'ransomed',(select revision from public.atlas_actions where id='__core_parent_children__'))$$,'parent completion applies the child policy');
select is((select status from public.atlas_actions where id='__core_child_eligible__'),'done','eligible children close with the parent');
select is((select status from public.atlas_actions where id='__core_child_protected__'),'in_progress','owner-gated children remain open');

insert into public.atlas_actions(id,title,description,status,business,priority,owners,tags,evidence_json,work_mode,approval_state,created_at,updated_at)
values
  ('__core_convert_parent__','Conversion outcome','Ship the outcome','in_progress','personal','p1','["ransomed"]','[]','{}','autonomous','not_required',timezone('utc',now()),timezone('utc',now())),
  ('__core_convert_child__','Conversion child','','not_started','personal','p2','["ransomed"]','[]','{}','autonomous','not_required',timezone('utc',now()),timezone('utc',now()));
update public.atlas_actions set parent_action_id='__core_convert_parent__' where id='__core_convert_child__';
select lives_ok($$select public.convert_atlas_action_to_project('__core_convert_parent__','__core_converted_project__',null,'ransomed',(select revision from public.atlas_actions where id='__core_convert_parent__'))$$,'a parent action converts transactionally');
select is((select count(*) from public.atlas_projects where id='__core_converted_project__'),1::bigint,'conversion creates one project');
select ok((select project_id='__core_converted_project__' and parent_action_id is null from public.atlas_actions where id='__core_convert_child__'),'children become standalone project actions');
select is((select count(*) from public.atlas_action_project_conversions where source_action_id='__core_convert_parent__'),1::bigint,'conversion retains one immutable receipt');

select lives_ok($$select public.configure_atlas_cycle_schedule('__core_cycle_schedule__','personal',2,0,2,current_date+30,'America/Los_Angeles',true,false,'ransomed',null)$$,'a future cycle schedule can be configured');
select lives_ok($$select public.start_atlas_cycle_today((select id from public.atlas_cycles where schedule_id='__core_cycle_schedule__' and status='planned' order by start_date limit 1),'ransomed',0)$$,'the next planned cycle can start today');
select is((select count(*) from public.atlas_cycles where schedule_id='__core_cycle_schedule__' and status='active'),1::bigint,'start-today activates exactly one cycle');
select is((select start_date from public.atlas_cycles where schedule_id='__core_cycle_schedule__' and status='active'),current_date,'start-today realigns the cycle start date');

select * from finish();
rollback;
