begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(50);

select has_table('public', 'atlas_saved_view_activity_log', 'saved-view activity table exists');
select has_column('public', 'atlas_projects', 'sort_order', 'projects have durable manual order');
select has_column('public', 'atlas_projects', 'completed_at', 'projects record completion time');
select has_column('public', 'atlas_saved_views', 'entity_type', 'views are typed by entity');
select has_column('public', 'atlas_saved_views', 'context_project_id', 'views can attach to project context');
select has_column('public', 'atlas_saved_views', 'layout', 'views persist layout');
select has_column('public', 'atlas_saved_views', 'group_by', 'views persist grouping');
select has_column('public', 'atlas_saved_views', 'subgroup_by', 'views persist subgrouping');
select has_column('public', 'atlas_saved_views', 'display_options', 'views persist display options');
select has_column('public', 'atlas_saved_views', 'is_favorite', 'views can be favorited');
select has_column('public', 'atlas_saved_views', 'is_default', 'views can be contextual defaults');
select has_column('public', 'atlas_saved_views', 'archived_at', 'views archive instead of deleting');
select has_column('public', 'atlas_saved_views', 'revision', 'views use optimistic revisions');
select has_column('public', 'atlas_saved_views', 'created_by', 'views retain creator evidence');
select has_column('public', 'atlas_saved_views', 'updated_by', 'views retain last actor evidence');
select has_trigger('public', 'atlas_projects', 'atlas_projects_manage_completed_at', 'project completion timestamp is managed');
select has_trigger('public', 'atlas_saved_views', 'atlas_saved_views_audit_row', 'saved-view changes are audited');
select has_trigger('public', 'atlas_saved_views', 'atlas_saved_views_reject_delete', 'saved views reject physical deletion');
select has_trigger('public', 'atlas_saved_view_activity_log', 'atlas_saved_view_activity_reject_mutation', 'saved-view history is append-only');
select has_function('public', 'move_atlas_project_order', array['text','text','text','bigint'], 'manual project order RPC exists');
select has_function('public', 'move_atlas_project_timeline', array['text','date','date','boolean','text','bigint'], 'timeline move RPC exists');
select ok(
  not has_function_privilege('anon', 'public.move_atlas_project_order(text,text,text,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.move_atlas_project_timeline(text,date,date,boolean,text,bigint)', 'execute'),
  'public application roles cannot execute project-view mutation RPCs'
);
select ok(
  has_function_privilege('service_role', 'public.move_atlas_project_order(text,text,text,bigint)', 'execute')
  and has_function_privilege('service_role', 'public.move_atlas_project_timeline(text,date,date,boolean,text,bigint)', 'execute'),
  'service role can execute project-view mutation RPCs'
);
select ok(
  not has_table_privilege('service_role', 'public.atlas_saved_views', 'delete')
  and not has_table_privilege('service_role', 'public.atlas_saved_view_activity_log', 'update')
  and not has_table_privilege('service_role', 'public.atlas_saved_view_activity_log', 'delete'),
  'service role cannot delete views or rewrite view history'
);
select ok((select relrowsecurity from pg_class where oid = 'public.atlas_saved_views'::regclass), 'saved views enforce row-level security');
select ok((select relrowsecurity from pg_class where oid = 'public.atlas_saved_view_activity_log'::regclass), 'saved-view history enforces row-level security');

insert into public.atlas_projects (id, name, status, priority, start_date, target_date, sort_order, created_by, updated_by)
values
  ('__atlas_view_root__', 'View root', 'planned', 'p1', '2026-08-01', '2026-08-05', 1000, 'ransomed', 'ransomed'),
  ('__atlas_view_child__', 'View child', 'planned', 'p2', '2026-08-06', '2026-08-10', 2000, 'ransomed', 'ransomed'),
  ('__atlas_view_grandchild__', 'View grandchild', 'backlog', 'p3', '2026-08-11', '2026-08-15', 3000, 'ransomed', 'ransomed'),
  ('__atlas_view_completion__', 'View completion', 'planned', 'p3', null, null, 4000, 'ransomed', 'ransomed');

insert into public.atlas_project_dependencies (id, blocked_project_id, blocking_project_id, status, created_by, updated_by)
values
  ('__atlas_view_dependency_1__', '__atlas_view_child__', '__atlas_view_root__', 'active', 'ransomed', 'ransomed'),
  ('__atlas_view_dependency_2__', '__atlas_view_grandchild__', '__atlas_view_child__', 'active', 'ransomed', 'ransomed');

select is((select completed_at from public.atlas_projects where id = '__atlas_view_completion__'), null::timestamptz, 'active projects do not have completion timestamps');
select lives_ok($$update public.atlas_projects set status = 'completed' where id = '__atlas_view_completion__'$$, 'a project can transition to completed');
select ok((select completed_at is not null from public.atlas_projects where id = '__atlas_view_completion__'), 'completing a project records completion time');
select lives_ok($$update public.atlas_projects set status = 'planned' where id = '__atlas_view_completion__'$$, 'a completed project can reopen');
select is((select completed_at from public.atlas_projects where id = '__atlas_view_completion__'), null::timestamptz, 'reopening clears completion time');

select lives_ok(
  $$insert into public.atlas_saved_views (id, name, filters, sort_by, sort_dir, entity_type, layout, group_by, display_options, is_favorite, is_default, created_by, updated_by)
    values ('__atlas_project_view__', 'Portfolio timeline', '{"health":"at_risk"}'::jsonb, 'priority', 'asc', 'project', 'timeline', 'status', '{"zoom":"quarter"}'::jsonb, false, true, 'ransomed', 'ransomed')$$,
  'a typed project timeline view can be saved'
);
select is((select entity_type || ':' || layout from public.atlas_saved_views where id = '__atlas_project_view__'), 'project:timeline', 'saved-view type and layout persist');
select is((select count(*) from public.atlas_saved_view_activity_log where view_id = '__atlas_project_view__' and event = 'view_created'), 1::bigint, 'creating a view appends audit evidence');
select lives_ok($$update public.atlas_saved_views set is_favorite = true, revision = revision + 1, updated_by = 'ransomed' where id = '__atlas_project_view__'$$, 'a saved view can be favorited');
select is((select count(*) from public.atlas_saved_view_activity_log where view_id = '__atlas_project_view__' and event = 'view_favorite_changed'), 1::bigint, 'favorite changes append audit evidence');
select throws_ok(
  $$insert into public.atlas_saved_views (id, name, filters, sort_by, sort_dir, entity_type, layout, is_default, created_by, updated_by)
    values ('__atlas_project_view_default_2__', 'Second default', '{}'::jsonb, 'priority', 'asc', 'project', 'list', true, 'ransomed', 'ransomed')$$,
  '23505', null, 'only one active contextual default is allowed'
);
select throws_ok(
  $$insert into public.atlas_saved_views (id, name, filters, sort_by, sort_dir, entity_type, layout, created_by, updated_by)
    values ('__atlas_invalid_action_timeline__', 'Invalid timeline', '{}'::jsonb, 'priority', 'asc', 'action', 'timeline', 'ransomed', 'ransomed')$$,
  '23514', null, 'action views cannot use the project timeline layout'
);
select throws_ok($$delete from public.atlas_saved_views where id = '__atlas_project_view__'$$, '55000', 'ATLAS_IMMUTABLE_HISTORY', 'saved views cannot be physically deleted');
select throws_ok($$update public.atlas_saved_view_activity_log set actor = 'codex' where view_id = '__atlas_project_view__'$$, '55000', 'ATLAS_PROJECT_HISTORY_IMMUTABLE', 'saved-view audit history cannot be rewritten');

select lives_ok(
  $$select public.move_atlas_project_order('__atlas_view_grandchild__', '__atlas_view_root__', 'ransomed', 0)$$,
  'a project can move before another project transactionally'
);
select ok(
  (select sort_order from public.atlas_projects where id = '__atlas_view_grandchild__')
    < (select sort_order from public.atlas_projects where id = '__atlas_view_root__'),
  'manual move persists micro-order before the reference project'
);
select is((select revision from public.atlas_projects where id = '__atlas_view_grandchild__'), 1::bigint, 'manual moves increment project revision');

create temporary table atlas_project_view_rpc_results (kind text, result jsonb);
select lives_ok(
  $$insert into atlas_project_view_rpc_results values ('timeline', public.move_atlas_project_timeline('__atlas_view_root__', '2026-08-03', '2026-08-07', true, 'ransomed', 0))$$,
  'timeline movement can shift a planned dependency chain transactionally'
);
select is((select start_date from public.atlas_projects where id = '__atlas_view_root__'), '2026-08-03'::date, 'timeline move updates the root project');
select is((select start_date from public.atlas_projects where id = '__atlas_view_child__'), '2026-08-08'::date, 'timeline move shifts the direct planned dependent');
select is((select start_date from public.atlas_projects where id = '__atlas_view_grandchild__'), '2026-08-13'::date, 'timeline move shifts the recursive backlog dependent');
select is((select jsonb_array_length(result->'moved_project_ids') from atlas_project_view_rpc_results where kind = 'timeline'), 3, 'timeline result identifies every shifted project');
select throws_ok(
  $$select public.move_atlas_project_timeline('__atlas_view_root__', '2026-09-10', '2026-09-01', false, 'ransomed', 1)$$,
  '22023', 'ATLAS_PROJECT_TIMEFRAME_INVALID', 'timeline moves reject inverted dates'
);
select throws_ok(
  $$select public.move_atlas_project_order('__atlas_view_child__', null, 'ransomed', 99)$$,
  '40001', 'ATLAS_PROJECT_REVISION_CONFLICT', 'manual ordering enforces optimistic revision'
);

select * from finish();
rollback;
