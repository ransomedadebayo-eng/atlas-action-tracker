begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(25);

select has_table('public', 'atlas_projects', 'projects table exists');
select has_table('public', 'atlas_project_milestones', 'project milestones table exists');
select has_table('public', 'atlas_project_updates', 'project updates table exists');
select has_table('public', 'atlas_project_dependencies', 'project dependencies table exists');
select has_table('public', 'atlas_project_activity_log', 'project activity table exists');

select has_column('public', 'atlas_actions', 'project_id', 'actions can belong to a project');
select has_column('public', 'atlas_actions', 'project_milestone_id', 'actions can belong to a project milestone');
select has_column('public', 'atlas_actions', 'estimate_points', 'actions expose project effort');

select has_trigger('public', 'atlas_projects', 'atlas_projects_audit_row', 'project mutations are audited');
select has_trigger('public', 'atlas_project_milestones', 'atlas_project_milestones_audit_row', 'milestone mutations are audited');
select has_trigger('public', 'atlas_project_dependencies', 'atlas_project_dependencies_audit_row', 'dependency mutations are audited');
select has_trigger('public', 'atlas_project_updates', 'atlas_project_updates_reject_mutation', 'project updates are append-only');
select has_trigger('public', 'atlas_actions', 'atlas_actions_validate_project_membership', 'action milestone membership is validated');

select has_function('public', 'post_atlas_project_update', array['text', 'text', 'text', 'text', 'text'], 'transactional project-update RPC exists');
select has_function('public', 'assign_atlas_action_to_project', array['text', 'text', 'text', 'integer', 'text'], 'transactional project assignment RPC exists');
select has_function('public', 'remove_atlas_action_from_project', array['text', 'text', 'text'], 'transactional project removal RPC exists');

select ok(
  not has_function_privilege('anon', 'public.post_atlas_project_update(text,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.post_atlas_project_update(text,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.assign_atlas_action_to_project(text,text,text,integer,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.assign_atlas_action_to_project(text,text,text,integer,text)', 'execute')
  and not has_function_privilege('anon', 'public.remove_atlas_action_from_project(text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.remove_atlas_action_from_project(text,text,text)', 'execute'),
  'public application roles cannot execute project mutation RPCs'
);
select ok(
  has_function_privilege('service_role', 'public.post_atlas_project_update(text,text,text,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.assign_atlas_action_to_project(text,text,text,integer,text)', 'execute')
  and has_function_privilege('service_role', 'public.remove_atlas_action_from_project(text,text,text)', 'execute'),
  'service_role can execute project mutation RPCs'
);
select ok(
  not has_table_privilege('anon', 'public.atlas_projects', 'delete')
  and not has_table_privilege('authenticated', 'public.atlas_projects', 'delete')
  and not has_table_privilege('service_role', 'public.atlas_projects', 'delete'),
  'application roles cannot delete projects'
);
select ok(
  not has_table_privilege('service_role', 'public.atlas_project_updates', 'update')
  and not has_table_privilege('service_role', 'public.atlas_project_updates', 'delete'),
  'project updates are append-only for the Worker role'
);

insert into public.atlas_projects (
  id, name, summary, business, status, health, priority, lead_id, members, created_by, updated_by
) values (
  '__atlas_project_test__', 'ATLAS project regression fixture', 'Rolled back by pgTAP.',
  'personal', 'in_progress', 'no_update', 'p2', 'ransomed', '["ransomed"]'::jsonb, 'ransomed', 'ransomed'
);
insert into public.atlas_project_milestones (
  id, project_id, name, status, created_by, updated_by
) values (
  '__atlas_project_milestone_test__', '__atlas_project_test__', 'Foundation', 'in_progress', 'ransomed', 'ransomed'
);
insert into public.atlas_actions (
  id, title, description, status, business, priority, owners, evidence_json, created_at, updated_at
) values (
  '__atlas_project_action_test__', 'Project action regression fixture', 'Rolled back by pgTAP.',
  'in_progress', 'personal', 'p2', '["ransomed"]'::jsonb, '{}'::jsonb, timezone('utc', now()), timezone('utc', now())
);

select lives_ok(
  $$select public.assign_atlas_action_to_project('__atlas_project_test__', '__atlas_project_action_test__', '__atlas_project_milestone_test__', 5, 'ransomed')$$,
  'an action can be assigned transactionally'
);
select is(
  (select project_id from public.atlas_actions where id = '__atlas_project_action_test__'),
  '__atlas_project_test__',
  'project assignment is persisted'
);
select lives_ok(
  $$select public.post_atlas_project_update('__atlas_project_test__', '__atlas_project_update_test__', 'on_track', 'The foundation is progressing.', 'ransomed')$$,
  'a health update can be posted transactionally'
);
select is(
  (select health from public.atlas_projects where id = '__atlas_project_test__'),
  'on_track',
  'the latest project update becomes current health'
);
select lives_ok(
  $$select public.remove_atlas_action_from_project('__atlas_project_test__', '__atlas_project_action_test__', 'ransomed')$$,
  'an action can be removed transactionally'
);

select * from finish();
rollback;
