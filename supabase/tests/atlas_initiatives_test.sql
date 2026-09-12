begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(72);

select has_table('public', 'atlas_initiatives', 'initiatives table exists');
select has_table('public', 'atlas_initiative_projects', 'initiative project membership exists');
select has_table('public', 'atlas_initiative_relations', 'multi-parent initiative graph exists');
select has_table('public', 'atlas_initiative_updates', 'initiative updates exist');
select has_table('public', 'atlas_initiative_resources', 'initiative resources exist');
select has_table('public', 'atlas_initiative_activity_log', 'initiative audit history exists');
select has_column('public', 'atlas_initiatives', 'owner_id', 'initiatives have an owner');
select has_column('public', 'atlas_initiatives', 'labels', 'initiatives have labels');
select has_column('public', 'atlas_initiatives', 'target_date', 'initiatives have target dates');
select has_column('public', 'atlas_initiatives', 'health', 'initiatives have health');
select has_column('public', 'atlas_initiatives', 'sort_order', 'initiatives have manual micro-order');
select has_column('public', 'atlas_initiatives', 'completed_at', 'initiatives record completion time');
select has_column('public', 'atlas_saved_views', 'context_initiative_id', 'saved views support initiative context');
select col_is_fk('public', 'atlas_saved_views', 'context_initiative_id', 'saved initiative context is referentially constrained');
select has_trigger('public', 'atlas_initiatives', 'atlas_initiatives_manage_row', 'initiative lifecycle properties are managed');
select has_trigger('public', 'atlas_initiatives', 'atlas_initiatives_audit_row', 'initiative changes are audited');
select has_trigger('public', 'atlas_initiatives', 'atlas_initiatives_reject_delete', 'initiative deletion is rejected');
select has_trigger('public', 'atlas_initiative_projects', 'atlas_initiative_projects_audit_row', 'project membership is audited');
select has_trigger('public', 'atlas_initiative_relations', 'atlas_initiative_relations_audit_row', 'hierarchy changes are audited');
select has_trigger('public', 'atlas_initiative_updates', 'atlas_initiative_updates_reject_mutation', 'initiative updates are immutable');
select has_trigger('public', 'atlas_initiative_resources', 'atlas_initiative_resources_reject_delete', 'resources reject physical deletion');
select has_trigger('public', 'atlas_initiative_activity_log', 'atlas_initiative_activity_reject_mutation', 'initiative history is append-only');
select has_function('public', 'set_atlas_initiative_project', array['text','text','boolean','text'], 'project membership RPC exists');
select has_function('public', 'set_atlas_initiative_parent', array['text','text','boolean','text'], 'initiative parent RPC exists');
select has_function('public', 'post_atlas_initiative_update', array['text','text','text','text','text'], 'initiative update RPC exists');
select has_function('public', 'move_atlas_initiative_order', array['text','text','text','bigint'], 'initiative order RPC exists');
select has_function('public', 'transition_atlas_initiative', array['text','boolean','text','bigint'], 'initiative lifecycle RPC exists');
select has_function('public', 'upsert_atlas_initiative_resource', array['text','text','text','text','text','text','text','text','bigint'], 'initiative resource RPC exists');
select ok(
  not has_function_privilege('anon', 'public.set_atlas_initiative_parent(text,text,boolean,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.post_atlas_initiative_update(text,text,text,text,text)', 'execute'),
  'public application roles cannot execute initiative RPCs'
);
select ok(
  has_function_privilege('service_role', 'public.set_atlas_initiative_parent(text,text,boolean,text)', 'execute')
  and has_function_privilege('service_role', 'public.post_atlas_initiative_update(text,text,text,text,text)', 'execute'),
  'service role can execute initiative RPCs'
);
select ok(
  not has_table_privilege('service_role', 'public.atlas_initiatives', 'delete')
  and not has_table_privilege('service_role', 'public.atlas_initiative_updates', 'update')
  and not has_table_privilege('service_role', 'public.atlas_initiative_activity_log', 'delete'),
  'service role cannot delete initiative state or rewrite history'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class where oid in (
    'public.atlas_initiatives'::regclass, 'public.atlas_initiative_projects'::regclass,
    'public.atlas_initiative_relations'::regclass, 'public.atlas_initiative_updates'::regclass,
    'public.atlas_initiative_resources'::regclass, 'public.atlas_initiative_activity_log'::regclass
  )),
  'all initiative tables enforce RLS'
);

insert into public.atlas_projects (id, name, status, health, priority, start_date, target_date, sort_order, created_by, updated_by)
values
  ('__atlas_initiative_project_1__', 'Initiative project one', 'in_progress', 'at_risk', 'p1', '2026-08-01', '2026-09-01', 1000, 'ransomed', 'ransomed'),
  ('__atlas_initiative_project_2__', 'Initiative project two', 'planned', 'on_track', 'p2', '2026-09-02', '2026-10-01', 2000, 'ransomed', 'ransomed');

insert into public.atlas_initiatives (id, name, status, health, priority, owner_id, labels, start_date, target_date, sort_order, created_by, updated_by)
values
  ('__atlas_initiative_root__', 'Root objective', 'active', 'no_update', 'p0', 'ransomed', '["strategy"]'::jsonb, '2026-08-01', '2026-12-31', 1000, 'ransomed', 'ransomed'),
  ('__atlas_initiative_a__', 'Workstream A', 'active', 'on_track', 'p1', 'codex', '[]'::jsonb, null, '2026-10-01', 2000, 'ransomed', 'ransomed'),
  ('__atlas_initiative_b__', 'Workstream B', 'planned', 'no_update', 'p1', 'ransomed', '[]'::jsonb, null, '2026-11-01', 3000, 'ransomed', 'ransomed'),
  ('__atlas_initiative_shared__', 'Shared objective', 'planned', 'no_update', 'p2', 'ransomed', '[]'::jsonb, null, '2026-10-15', 4000, 'ransomed', 'ransomed'),
  ('__atlas_initiative_l4__', 'Level four', 'planned', 'no_update', 'p2', 'ransomed', '[]'::jsonb, null, null, 5000, 'ransomed', 'ransomed'),
  ('__atlas_initiative_l5__', 'Level five', 'planned', 'no_update', 'p3', 'ransomed', '[]'::jsonb, null, null, 6000, 'ransomed', 'ransomed'),
  ('__atlas_initiative_l6__', 'Level six candidate', 'planned', 'no_update', 'p3', 'ransomed', '[]'::jsonb, null, null, 7000, 'ransomed', 'ransomed');

select lives_ok($$select public.set_atlas_initiative_project('__atlas_initiative_root__','__atlas_initiative_project_1__',true,'ransomed')$$, 'a project can attach directly to the root');
select lives_ok($$select public.set_atlas_initiative_project('__atlas_initiative_shared__','__atlas_initiative_project_1__',true,'ransomed')$$, 'the same project can contribute through a descendant');
select lives_ok($$select public.set_atlas_initiative_project('__atlas_initiative_shared__','__atlas_initiative_project_2__',true,'ransomed')$$, 'another project can attach to a descendant');
select is((select count(*) from public.atlas_initiative_projects where status = 'active' and initiative_id like '__atlas_initiative_%'), 3::bigint, 'three direct memberships are stored');
select lives_ok($$select public.set_atlas_initiative_parent('__atlas_initiative_a__','__atlas_initiative_root__',true,'ransomed')$$, 'root can own workstream A');
select lives_ok($$select public.set_atlas_initiative_parent('__atlas_initiative_b__','__atlas_initiative_root__',true,'ransomed')$$, 'root can own workstream B');
select lives_ok($$select public.set_atlas_initiative_parent('__atlas_initiative_shared__','__atlas_initiative_a__',true,'ransomed')$$, 'A can own the shared objective');
select lives_ok($$select public.set_atlas_initiative_parent('__atlas_initiative_shared__','__atlas_initiative_b__',true,'ransomed')$$, 'the shared objective can have a second parent');
select is((select count(*) from public.atlas_initiative_relations where child_initiative_id = '__atlas_initiative_shared__' and status = 'active'), 2::bigint, 'multi-parent initiative state persists');
select is((
  with recursive tree(id) as (
    select '__atlas_initiative_root__'
    union
    select relation.child_initiative_id from public.atlas_initiative_relations relation join tree on relation.parent_initiative_id = tree.id where relation.status = 'active'
  ) select count(distinct membership.project_id) from public.atlas_initiative_projects membership join tree on tree.id = membership.initiative_id where membership.status = 'active'
), 2::bigint, 'recursive project rollup deduplicates multi-path membership');
select throws_ok(
  $$select public.set_atlas_initiative_parent('__atlas_initiative_root__','__atlas_initiative_shared__',true,'ransomed')$$,
  '23514', 'ATLAS_INITIATIVE_CYCLE', 'reverse reachability rejects initiative cycles'
);
select lives_ok($$select public.set_atlas_initiative_parent('__atlas_initiative_l4__','__atlas_initiative_shared__',true,'ransomed')$$, 'a fourth initiative level is allowed');
select lives_ok($$select public.set_atlas_initiative_parent('__atlas_initiative_l5__','__atlas_initiative_l4__',true,'ransomed')$$, 'a fifth initiative level is allowed');
select throws_ok(
  $$select public.set_atlas_initiative_parent('__atlas_initiative_l6__','__atlas_initiative_l5__',true,'ransomed')$$,
  '23514', 'ATLAS_INITIATIVE_MAX_DEPTH', 'a sixth initiative level is rejected'
);

select lives_ok(
  $$select public.post_atlas_initiative_update('__atlas_initiative_root__','__atlas_initiative_update__','at_risk','Execution evidence is behind plan.','ransomed')$$,
  'a structured initiative update can be posted'
);
select is((select health from public.atlas_initiatives where id = '__atlas_initiative_root__'), 'at_risk', 'latest initiative update controls health');
select is((select (context_snapshot->>'projects')::integer from public.atlas_initiative_updates where id = '__atlas_initiative_update__'), 2, 'initiative update snapshots the deduplicated project rollup');
select is((select count(*) from public.atlas_initiative_updates where id = '__atlas_initiative_update__'), 1::bigint, 'initiative update is appended once');
select throws_ok($$update public.atlas_initiative_updates set body = 'rewrite' where id = '__atlas_initiative_update__'$$, '55000', 'ATLAS_PROJECT_HISTORY_IMMUTABLE', 'initiative updates cannot be rewritten');

create temporary table atlas_initiative_rpc_results (kind text, result jsonb);
select lives_ok(
  $$insert into atlas_initiative_rpc_results values ('resource', public.upsert_atlas_initiative_resource(null,'__atlas_initiative_root__','link','Strategy brief','https://example.com/strategy',null,'active','ransomed',null))$$,
  'an initiative resource can be created'
);
select is((select result->>'status' from atlas_initiative_rpc_results where kind = 'resource'), 'active', 'new initiative resource is active');
select lives_ok(
  $$select public.upsert_atlas_initiative_resource((select result->>'id' from atlas_initiative_rpc_results where kind='resource'),'__atlas_initiative_root__','link','Strategy brief','https://example.com/strategy',null,'archived','ransomed',0)$$,
  'an initiative resource can be archived by revision'
);
select is((select status from public.atlas_initiative_resources where initiative_id = '__atlas_initiative_root__'), 'archived', 'resource archive persists');
select throws_ok(
  $$insert into public.atlas_initiative_resources(id,initiative_id,resource_type,title,url,status,created_by,updated_by) values('__unsafe_link__','__atlas_initiative_root__','link','Unsafe','javascript:alert(1)','active','ransomed','ransomed')$$,
  '22023', 'ATLAS_INITIATIVE_RESOURCE_TARGET_INVALID',
  'initiative resources reject unsafe external URL schemes'
);
select throws_ok(
  $$insert into public.atlas_initiative_resources(id,initiative_id,resource_type,title,document_ref,status,created_by,updated_by) values('__unsafe_document__','__atlas_initiative_root__','document','Unsafe','javascript:alert(1)','active','ransomed','ransomed')$$,
  '22023', 'ATLAS_INITIATIVE_RESOURCE_TARGET_INVALID',
  'initiative resources reject unsafe internal document references'
);

select lives_ok($$select public.transition_atlas_initiative('__atlas_initiative_root__',false,'ransomed',1)$$, 'initiative can archive transactionally');
select is((select status from public.atlas_initiatives where id = '__atlas_initiative_root__'), 'archived', 'initiative archive persists');
select lives_ok($$select public.transition_atlas_initiative('__atlas_initiative_root__',true,'ransomed',2)$$, 'initiative can restore transactionally');
select is((select status from public.atlas_initiatives where id = '__atlas_initiative_root__'), 'active', 'initiative restore returns to previous status');
select is((select revision from public.atlas_initiatives where id = '__atlas_initiative_root__'), 3::bigint, 'update and lifecycle transitions increment revision');

select lives_ok($$select public.move_atlas_initiative_order('__atlas_initiative_l6__','__atlas_initiative_root__','ransomed',0)$$, 'initiative can move before another initiative');
select ok((select sort_order from public.atlas_initiatives where id = '__atlas_initiative_l6__') < (select sort_order from public.atlas_initiatives where id = '__atlas_initiative_root__'), 'manual initiative order persists');
select is((select revision from public.atlas_initiatives where id = '__atlas_initiative_l6__'), 1::bigint, 'manual initiative order increments revision');

select lives_ok(
  $$insert into public.atlas_saved_views (id,name,filters,sort_by,sort_dir,entity_type,context_initiative_id,layout,group_by,display_options,created_by,updated_by)
    values ('__atlas_initiative_view__','Strategy timeline','{}'::jsonb,'health','asc','initiative','__atlas_initiative_root__','timeline','owner','{"zoom":"quarter"}'::jsonb,'ransomed','ransomed')$$,
  'an initiative timeline view can be saved in initiative context'
);
select is((select entity_type || ':' || layout from public.atlas_saved_views where id = '__atlas_initiative_view__'), 'initiative:timeline', 'initiative view type and layout persist');
select throws_ok(
  $$insert into public.atlas_saved_views (id,name,filters,sort_by,sort_dir,entity_type,layout,created_by,updated_by)
    values ('__atlas_initiative_board__','Invalid board','{}'::jsonb,'priority','asc','initiative','board','ransomed','ransomed')$$,
  '23514', null, 'initiative saved views reject board layout'
);
select throws_ok($$delete from public.atlas_initiatives where id = '__atlas_initiative_l6__'$$, '55000', 'ATLAS_IMMUTABLE_HISTORY', 'initiatives cannot be physically deleted');
select throws_ok($$delete from public.atlas_initiative_relations where child_initiative_id = '__atlas_initiative_shared__'$$, '55000', 'ATLAS_IMMUTABLE_HISTORY', 'initiative graph edges cannot be physically deleted');
select ok((select count(*) >= 10 from public.atlas_initiative_activity_log where initiative_id like '__atlas_initiative_%'), 'initiative mutations append audit evidence');
select throws_ok($$update public.atlas_initiative_activity_log set actor = 'codex' where initiative_id = '__atlas_initiative_root__'$$, '55000', 'ATLAS_PROJECT_HISTORY_IMMUTABLE', 'initiative audit evidence cannot be rewritten');

select * from finish();
rollback;
