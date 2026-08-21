begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(81);

select has_table('public','atlas_templates','templates table exists');
select has_table('public','atlas_template_instances','template instances exist');
select has_table('public','atlas_template_activity_log','template activity exists');
select has_table('public','atlas_documents','documents table exists');
select has_table('public','atlas_document_versions','document versions exist');
select has_table('public','atlas_document_activity_log','document activity exists');
select has_column('public','atlas_actions','template_id','actions retain template provenance');
select has_column('public','atlas_actions','template_instance_id','actions retain instance provenance');
select has_column('public','atlas_projects','template_id','projects retain template provenance');
select has_column('public','atlas_projects','template_instance_id','projects retain instance provenance');
select col_is_fk('public','atlas_actions','template_id','action template provenance is referentially constrained');
select col_is_fk('public','atlas_projects','template_instance_id','project instance provenance is referentially constrained');
select has_trigger('public','atlas_templates','atlas_templates_validate_row','template blueprints are validated');
select has_trigger('public','atlas_templates','atlas_templates_audit_row','template changes are audited');
select has_trigger('public','atlas_templates','atlas_templates_reject_delete','templates reject deletion');
select has_trigger('public','atlas_template_instances','atlas_template_instances_reject_mutation','instances are immutable');
select has_trigger('public','atlas_documents','atlas_documents_validate_context','document contexts are validated');
select has_trigger('public','atlas_documents','atlas_documents_audit_row','document changes create evidence and versions');
select has_trigger('public','atlas_documents','atlas_documents_reject_delete','documents reject deletion');
select has_trigger('public','atlas_document_versions','atlas_document_versions_reject_mutation','document versions are immutable');
select has_function('public','instantiate_atlas_template',array['text','text','text','text','text','jsonb','jsonb','text'],'template instantiation RPC exists');
select has_function('public','transition_atlas_template',array['text','boolean','text','bigint'],'template lifecycle RPC exists');
select has_function('public','duplicate_atlas_template',array['text','text','text','text'],'template duplication RPC exists');
select has_function('public','transition_atlas_document',array['text','boolean','text','bigint'],'document lifecycle RPC exists');
select ok(not has_function_privilege('anon','public.instantiate_atlas_template(text,text,text,text,text,jsonb,jsonb,text)','execute') and not has_function_privilege('authenticated','public.transition_atlas_document(text,boolean,text,bigint)','execute'),'public roles cannot execute template/document RPCs');
select ok(has_function_privilege('service_role','public.instantiate_atlas_template(text,text,text,text,text,jsonb,jsonb,text)','execute') and has_function_privilege('service_role','public.transition_atlas_document(text,boolean,text,bigint)','execute'),'service role can execute template/document RPCs');
select ok(not has_table_privilege('service_role','public.atlas_templates','delete') and not has_table_privilege('service_role','public.atlas_template_instances','update') and not has_table_privilege('service_role','public.atlas_document_versions','delete'),'service role cannot delete templates or rewrite provenance');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.atlas_templates'::regclass,'public.atlas_template_instances'::regclass,'public.atlas_template_activity_log'::regclass,'public.atlas_documents'::regclass,'public.atlas_document_versions'::regclass,'public.atlas_document_activity_log'::regclass)),'all template/document tables enforce RLS');

insert into public.atlas_initiatives (id,name,status,health,priority,owner_id,labels,created_by,updated_by)
values ('__atlas_template_initiative__','Template initiative','active','on_track','p1','ransomed','[]'::jsonb,'ransomed','ransomed');

insert into public.atlas_templates (id,name,description,template_type,mode,scope,business,default_audience,is_default,blueprint,form_schema,status,created_by,updated_by)
values
('__atlas_action_template__','Action blueprint','Nested action','action','standard','workspace',null,'owner',true,
 '{"title":"Default action","description":"Action body","status":"not_started","priority":"p1","owners":["ransomed"],"tags":["template"],"estimate_points":3,"sub_actions":[{"key":"repro","title":"Reproduce","estimate_points":1},{"key":"fix","parent_key":"repro","title":"Fix","estimate_points":2}]}'::jsonb,'[]'::jsonb,'active','ransomed','ransomed'),
('__atlas_form_template__','Form blueprint','Structured request','action','form','business','personal','intake',true,
 '{"description":"Request details","status":"not_started","priority":"p2","owners":["ransomed"],"sub_actions":[]}'::jsonb,
 '[{"key":"title","type":"title","label":"Title","required":true},{"key":"severity","type":"dropdown","label":"Severity","required":true,"options":["high","low"]},{"key":"platforms","type":"checkboxes","label":"Platforms","required":true,"options":["ios","web"]}]'::jsonb,'active','ransomed','ransomed'),
('__atlas_project_template__','Project blueprint','Full project plan','project','standard','workspace',null,'owner',false,
 jsonb_build_object('name','Launch project','summary','Launch safely','business','personal','status','planned','health','no_update','priority','p1','lead_id','ransomed','members',jsonb_build_array('ransomed'),'start_offset_days',0,'target_offset_days',30,'initiative_ids',jsonb_build_array('__atlas_template_initiative__'),'milestones',jsonb_build_array(jsonb_build_object('key','beta','name','Beta','target_offset_days',14,'sort_order',1),jsonb_build_object('key','ga','name','General availability','target_offset_days',30,'sort_order',2)),'actions',jsonb_build_array(jsonb_build_object('key','build','title','Build release','milestone_key','beta','estimate_points',3),jsonb_build_object('key','verify','parent_key','build','title','Verify release','milestone_key','ga','estimate_points',2))),
 '[]'::jsonb,'active','ransomed','ransomed'),
('__atlas_document_template__','Document blueprint','Reusable brief','document','standard','workspace',null,'owner',false,
 '{"title":"Strategy brief","content":"# Strategy\n\n## Outcome\n","icon":"file-text","allowed_context_types":["workspace","project","initiative"]}'::jsonb,'[]'::jsonb,'active','ransomed','ransomed');

select is((select count(*) from public.atlas_template_activity_log where event='template_created' and template_id like '__atlas_%_template__'),4::bigint,'template creation appends audit evidence');
select throws_ok($$insert into public.atlas_templates (id,name,template_type,mode,scope,default_audience,is_default,blueprint,form_schema,status,created_by,updated_by) values ('__atlas_duplicate_default__','Duplicate default','action','standard','workspace','owner',true,'{"title":"Duplicate"}'::jsonb,'[]'::jsonb,'active','ransomed','ransomed')$$,'23505',null,'only one active default exists per type/business/audience');
select throws_ok($$insert into public.atlas_templates (id,name,template_type,mode,scope,default_audience,blueprint,form_schema,status,created_by,updated_by) values ('__atlas_invalid_nodes__','Invalid nodes','action','standard','workspace','owner','{"title":"Bad","sub_actions":[{"key":"a","parent_key":"missing","title":"A"}]}'::jsonb,'[]'::jsonb,'active','ransomed','ransomed')$$,'23514','ATLAS_TEMPLATE_NODE_GRAPH_INVALID','missing template parents are rejected');
select throws_ok($$insert into public.atlas_templates (id,name,template_type,mode,scope,default_audience,blueprint,form_schema,status,created_by,updated_by) values ('__atlas_invalid_form__','Invalid form','action','form','workspace','owner','{}'::jsonb,'[]'::jsonb,'active','ransomed','ransomed')$$,'23514','ATLAS_TEMPLATE_FORM_SCHEMA_REQUIRED','form templates require fields');

create temporary table atlas_template_test_results (kind text,result jsonb);
select lives_ok($$insert into atlas_template_test_results values ('action',public.instantiate_atlas_template('__atlas_action_template__','Override action','personal',null,null,'{}'::jsonb,'{}'::jsonb,'ransomed'))$$,'standard action template instantiates transactionally');
select is((select title from public.atlas_actions where id=(select result->>'result_entity_id' from atlas_template_test_results where kind='action')),'Override action','action title override persists');
select is((select count(*) from public.atlas_actions where template_instance_id=(select result->>'instance_id' from atlas_template_test_results where kind='action')),3::bigint,'root and two nested actions are created');
select ok((select parent_action_id is not null from public.atlas_actions where title='Reproduce' and template_instance_id=(select result->>'instance_id' from atlas_template_test_results where kind='action')),'top template node is a child of the root action');
select is((select parent_action_id from public.atlas_actions where title='Fix' and template_instance_id=(select result->>'instance_id' from atlas_template_test_results where kind='action')),(select id from public.atlas_actions where title='Reproduce' and template_instance_id=(select result->>'instance_id' from atlas_template_test_results where kind='action')),'nested action parent key resolves correctly');
select ok((select bool_and(template_id='__atlas_action_template__') from public.atlas_actions where template_instance_id=(select result->>'instance_id' from atlas_template_test_results where kind='action')),'every created action retains template provenance');
select is((select count(*) from public.atlas_template_instances where id=(select result->>'instance_id' from atlas_template_test_results where kind='action')),1::bigint,'action instance receipt persists once');
select is((select usage_count from public.atlas_templates where id='__atlas_action_template__'),1::bigint,'action template usage count increments');

select throws_ok($$select public.instantiate_atlas_template('__atlas_form_template__',null,'personal',null,null,'{"severity":"high","platforms":["ios"]}'::jsonb,'{}'::jsonb,'ransomed')$$,'22023','ATLAS_TEMPLATE_REQUIRED_FIELD_MISSING','required form title is enforced');
select throws_ok($$select public.instantiate_atlas_template('__atlas_form_template__',null,'personal',null,null,'{"title":"Request","severity":"critical","platforms":["ios"]}'::jsonb,'{}'::jsonb,'ransomed')$$,'22023','ATLAS_TEMPLATE_FIELD_OPTION_INVALID','form dropdown options are enforced');
select lives_ok($$insert into atlas_template_test_results values ('form',public.instantiate_atlas_template('__atlas_form_template__',null,'personal',null,null,'{"title":"Customer request","severity":"high","platforms":["ios","web"]}'::jsonb,'{}'::jsonb,'ransomed'))$$,'valid structured form instantiates');
select is((select title from public.atlas_actions where id=(select result->>'result_entity_id' from atlas_template_test_results where kind='form')),'Customer request','form title property maps to action title');
select ok((select description like '%## Severity%high%' and description like '%## Platforms%' from public.atlas_actions where id=(select result->>'result_entity_id' from atlas_template_test_results where kind='form')),'generic form fields append structured Markdown');
select is((select form_values->>'severity' from public.atlas_template_instances where id=(select result->>'instance_id' from atlas_template_test_results where kind='form')),'high','form instance preserves submitted values');

select lives_ok($$insert into atlas_template_test_results values ('project',public.instantiate_atlas_template('__atlas_project_template__','Atlas launch','personal',null,null,'{}'::jsonb,'{}'::jsonb,'ransomed'))$$,'project template instantiates atomically');
select is((select name from public.atlas_projects where id=(select result->>'result_entity_id' from atlas_template_test_results where kind='project')),'Atlas launch','project title override persists');
select is((select count(*) from public.atlas_project_milestones where project_id=(select result->>'result_entity_id' from atlas_template_test_results where kind='project')),2::bigint,'project milestones are created');
select is((select count(*) from public.atlas_actions where project_id=(select result->>'result_entity_id' from atlas_template_test_results where kind='project')),2::bigint,'project actions are created');
select is((select parent_action_id from public.atlas_actions where title='Verify release' and project_id=(select result->>'result_entity_id' from atlas_template_test_results where kind='project')),(select id from public.atlas_actions where title='Build release' and project_id=(select result->>'result_entity_id' from atlas_template_test_results where kind='project')),'project sub-action hierarchy resolves');
select is((select milestone.name from public.atlas_actions action join public.atlas_project_milestones milestone on milestone.id=action.project_milestone_id where action.title='Verify release' and action.project_id=(select result->>'result_entity_id' from atlas_template_test_results where kind='project')),'General availability','milestone key resolves onto project action');
select is((select count(*) from public.atlas_initiative_projects where initiative_id='__atlas_template_initiative__' and project_id=(select result->>'result_entity_id' from atlas_template_test_results where kind='project') and status='active'),1::bigint,'project template attaches configured initiative');
select ok((select template_id='__atlas_project_template__' and template_instance_id=(select result->>'instance_id' from atlas_template_test_results where kind='project') from public.atlas_projects where id=(select result->>'result_entity_id' from atlas_template_test_results where kind='project')),'project retains template provenance');
select ok((select bool_and(template_id='__atlas_project_template__') from public.atlas_actions where project_id=(select result->>'result_entity_id' from atlas_template_test_results where kind='project')),'project actions retain project-template provenance');

select lives_ok($$insert into atlas_template_test_results values ('document',public.instantiate_atlas_template('__atlas_document_template__',null,null,'initiative','__atlas_template_initiative__','{}'::jsonb,'{}'::jsonb,'ransomed'))$$,'document template instantiates in initiative context');
select throws_ok($$select public.instantiate_atlas_template('__atlas_document_template__',null,null,'action','missing','{}'::jsonb,'{}'::jsonb,'ransomed')$$,'22023','ATLAS_DOCUMENT_TEMPLATE_CONTEXT_NOT_ALLOWED','document template enforces allowed context types');
select is((select title from public.atlas_documents where id=(select result->>'result_entity_id' from atlas_template_test_results where kind='document')),'Strategy brief','document template title persists');
select is((select context_type||':'||context_id from public.atlas_documents where id=(select result->>'result_entity_id' from atlas_template_test_results where kind='document')),'initiative:__atlas_template_initiative__','document context persists');
select is((select count(*) from public.atlas_document_versions where document_id=(select result->>'result_entity_id' from atlas_template_test_results where kind='document')),1::bigint,'document creation records the first version');
select lives_ok($$update public.atlas_documents set content='# Revised',revision=1,updated_by='ransomed',updated_at=timezone('utc',now()) where id=(select result->>'result_entity_id' from atlas_template_test_results where kind='document')$$,'document content can be revisioned');
select is((select count(*) from public.atlas_document_versions where document_id=(select result->>'result_entity_id' from atlas_template_test_results where kind='document')),2::bigint,'document edit appends another version');
select is((select content from public.atlas_document_versions where document_id=(select result->>'result_entity_id' from atlas_template_test_results where kind='document') and revision=0),'# Strategy'||E'\n\n## Outcome\n','original document version remains readable');
select throws_ok($$update public.atlas_document_versions set content='rewrite' where document_id=(select result->>'result_entity_id' from atlas_template_test_results where kind='document') and revision=0$$,'55000','ATLAS_PROJECT_HISTORY_IMMUTABLE','document versions cannot be rewritten');

select lives_ok($$select public.duplicate_atlas_template('__atlas_document_template__','__atlas_document_template_copy__','Brief copy','ransomed')$$,'templates can be duplicated');
select is((select name from public.atlas_templates where id='__atlas_document_template_copy__'),'Brief copy','duplicate has independent name');
select is((select is_default from public.atlas_templates where id='__atlas_document_template_copy__'),false,'duplicate does not inherit default status');
select lives_ok($$select public.transition_atlas_template('__atlas_document_template_copy__',false,'ransomed',0)$$,'template can archive');
select is((select status from public.atlas_templates where id='__atlas_document_template_copy__'),'archived','template archive persists');
select lives_ok($$select public.transition_atlas_template('__atlas_document_template_copy__',true,'ransomed',1)$$,'template can restore');
select is((select status from public.atlas_templates where id='__atlas_document_template_copy__'),'active','template restore persists');

select lives_ok($$select public.transition_atlas_document((select result->>'result_entity_id' from atlas_template_test_results where kind='document'),false,'ransomed',1)$$,'document can archive');
select is((select status from public.atlas_documents where id=(select result->>'result_entity_id' from atlas_template_test_results where kind='document')),'archived','document archive persists');
select lives_ok($$select public.transition_atlas_document((select result->>'result_entity_id' from atlas_template_test_results where kind='document'),true,'ransomed',2)$$,'document can restore');
select is((select status from public.atlas_documents where id=(select result->>'result_entity_id' from atlas_template_test_results where kind='document')),'active','document restore persists');
select is((select count(*) from public.atlas_document_versions where document_id=(select result->>'result_entity_id' from atlas_template_test_results where kind='document')),4::bigint,'document lifecycle transitions are versioned');

select throws_ok($$delete from public.atlas_templates where id='__atlas_action_template__'$$,'55000','ATLAS_IMMUTABLE_HISTORY','templates cannot be physically deleted');
select throws_ok($$delete from public.atlas_documents where id=(select result->>'result_entity_id' from atlas_template_test_results where kind='document')$$,'55000','ATLAS_IMMUTABLE_HISTORY','documents cannot be physically deleted');
select throws_ok($$update public.atlas_template_instances set actor='codex' where id=(select result->>'instance_id' from atlas_template_test_results where kind='action')$$,'55000','ATLAS_PROJECT_HISTORY_IMMUTABLE','template instance provenance cannot be rewritten');
select ok((select count(*) >= 8 from public.atlas_template_activity_log where template_id like '__atlas_%_template__'),'template activity captures lifecycle and usage evidence');
select ok((select count(*) >= 4 from public.atlas_document_activity_log where document_id=(select result->>'result_entity_id' from atlas_template_test_results where kind='document')),'document activity captures creation, edit, archive, and restore');

select * from finish();
rollback;
