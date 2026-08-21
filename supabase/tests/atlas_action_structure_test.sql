begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(39);

select has_column('public', 'atlas_actions', 'parent_action_id', 'actions expose a parent relation');
select has_column('public', 'atlas_actions', 'resolution', 'actions distinguish completion resolution');
select has_column('public', 'atlas_actions', 'duplicate_of_id', 'duplicates point to a canonical action');
select has_table('public', 'atlas_action_relations', 'typed action relations table exists');
select has_trigger('public', 'atlas_actions', 'atlas_actions_validate_hierarchy', 'hierarchy validation trigger exists');
select has_trigger('public', 'atlas_actions', 'atlas_actions_validate_resolution', 'resolution validation trigger exists');
select has_trigger('public', 'atlas_actions', 'atlas_actions_reclassify_completed_blocks', 'completed blockers reclassify relations');
select has_trigger('public', 'atlas_action_relations', 'atlas_action_relations_audit', 'relation changes are audited');
select has_trigger('public', 'atlas_action_relations', 'atlas_action_relations_sync_blocked_by', 'typed blockers synchronize legacy readiness state');
select has_trigger('public', 'atlas_action_relations', 'atlas_action_relations_reject_delete', 'relation deletion is blocked');

select has_function('public', 'set_atlas_action_parent', array['text', 'text', 'text', 'bigint'], 'parent mutation RPC exists');
select has_function('public', 'create_atlas_sub_action', array['text', 'text', 'text', 'text', 'date', 'text', 'bigint'], 'sub-action creation RPC exists');
select has_function('public', 'mark_atlas_action_duplicate', array['text', 'text', 'text', 'bigint'], 'duplicate resolution RPC exists');
select has_function('public', 'restore_atlas_duplicate_action', array['text', 'text', 'bigint'], 'duplicate restoration RPC exists');

select ok(
  not has_function_privilege('anon', 'public.set_atlas_action_parent(text,text,text,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.set_atlas_action_parent(text,text,text,bigint)', 'execute')
  and not has_function_privilege('anon', 'public.create_atlas_sub_action(text,text,text,text,date,text,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.mark_atlas_action_duplicate(text,text,text,bigint)', 'execute'),
  'public application roles cannot execute structural mutation RPCs'
);
select ok(
  has_function_privilege('service_role', 'public.set_atlas_action_parent(text,text,text,bigint)', 'execute')
  and has_function_privilege('service_role', 'public.create_atlas_sub_action(text,text,text,text,date,text,bigint)', 'execute')
  and has_function_privilege('service_role', 'public.mark_atlas_action_duplicate(text,text,text,bigint)', 'execute')
  and has_function_privilege('service_role', 'public.restore_atlas_duplicate_action(text,text,bigint)', 'execute'),
  'service role can execute structural mutation RPCs'
);
select ok(
  not has_table_privilege('anon', 'public.atlas_action_relations', 'delete')
  and not has_table_privilege('authenticated', 'public.atlas_action_relations', 'delete')
  and not has_table_privilege('service_role', 'public.atlas_action_relations', 'delete'),
  'application roles cannot delete action relations'
);
select is(
  (select value->>'scale' from public.atlas_config where key = 'estimate_settings'),
  'fibonacci',
  'a valid default estimate scale is staged'
);

insert into public.atlas_actions (
  id, title, description, status, business, priority, owners, tags, evidence_json, work_mode, created_at, updated_at
) values
  ('__atlas_structure_parent__', 'Structure parent', '', 'in_progress', 'personal', 'p1', '["ransomed"]'::jsonb, '["parent-tag"]'::jsonb, '{}'::jsonb, 'autonomous', timezone('utc', now()), timezone('utc', now())),
  ('__atlas_structure_blocker__', 'Blocking action', '', 'in_progress', 'personal', 'p2', '["ransomed"]'::jsonb, '[]'::jsonb, '{}'::jsonb, 'autonomous', timezone('utc', now()), timezone('utc', now())),
  ('__atlas_structure_blocked__', 'Blocked action', '', 'blocked', 'personal', 'p2', '["ransomed"]'::jsonb, '[]'::jsonb, '{}'::jsonb, 'autonomous', timezone('utc', now()), timezone('utc', now())),
  ('__atlas_structure_duplicate__', 'Duplicate action', '', 'not_started', 'personal', 'p3', '["ransomed"]'::jsonb, '[]'::jsonb, '{}'::jsonb, 'autonomous', timezone('utc', now()), timezone('utc', now()));

select lives_ok(
  $$select public.create_atlas_sub_action('__atlas_structure_parent__', '__atlas_structure_child__', 'Inherited child', '', null, 'ransomed', (select revision from public.atlas_actions where id='__atlas_structure_parent__'))$$,
  'a sub-action can be created transactionally'
);
select is(
  (select parent_action_id from public.atlas_actions where id = '__atlas_structure_child__'),
  '__atlas_structure_parent__',
  'the created action points to its parent'
);
select is(
  (select business from public.atlas_actions where id = '__atlas_structure_child__'),
  'personal',
  'sub-actions inherit business'
);
select is(
  (select priority from public.atlas_actions where id = '__atlas_structure_child__'),
  'p1',
  'sub-actions inherit priority'
);
select is(
  (select tags from public.atlas_actions where id = '__atlas_structure_child__'),
  '[]'::jsonb,
  'sub-actions do not inherit tags'
);
select throws_ok(
  $$select public.set_atlas_action_parent('__atlas_structure_parent__', '__atlas_structure_child__', 'ransomed', (select revision from public.atlas_actions where id='__atlas_structure_parent__'))$$,
  '23514',
  'ATLAS_ACTION_HIERARCHY_CYCLE',
  'hierarchy cycles are rejected'
);

select lives_ok(
  $$insert into public.atlas_action_relations (id, source_action_id, target_action_id, relation_type, status, created_by, updated_by) values ('__atlas_structure_blocks__', '__atlas_structure_blocker__', '__atlas_structure_blocked__', 'blocks', 'active', 'ransomed', 'ransomed')$$,
  'a directional blocking relation can be created'
);
select ok(
  (select blocked_by @> '["__atlas_structure_blocker__"]'::jsonb from public.atlas_actions where id = '__atlas_structure_blocked__'),
  'typed blocking edges update the canonical blocked_by readiness field'
);
select lives_ok(
  $$select public.complete_atlas_action('__atlas_structure_blocker__', '{"kind":"manual_attestation","summary":"Blocker resolved"}'::jsonb, 'ransomed', (select revision from public.atlas_actions where id='__atlas_structure_blocker__'))$$,
  'the blocking action can complete normally'
);
select is(
  (select relation_type from public.atlas_action_relations where id = '__atlas_structure_blocks__'),
  'related',
  'completing a blocker moves its edge to related'
);
select ok(
  (select not (blocked_by @> '["__atlas_structure_blocker__"]'::jsonb) from public.atlas_actions where id = '__atlas_structure_blocked__'),
  'completed blockers are removed from the canonical blocked_by readiness field'
);

select lives_ok(
  $$select public.mark_atlas_action_duplicate('__atlas_structure_duplicate__', '__atlas_structure_parent__', 'ransomed', (select revision from public.atlas_actions where id='__atlas_structure_duplicate__'))$$,
  'duplicate resolution commits transactionally'
);
select is(
  (select status from public.atlas_actions where id = '__atlas_structure_duplicate__'),
  'done',
  'duplicate resolution closes the duplicate action'
);
select is(
  (select resolution from public.atlas_actions where id = '__atlas_structure_duplicate__'),
  'duplicate',
  'duplicate resolution remains distinct from completion'
);
select is(
  (select duplicate_of_id from public.atlas_actions where id = '__atlas_structure_duplicate__'),
  '__atlas_structure_parent__',
  'the duplicate points to its canonical action'
);
select is(
  (select evidence_json->>'kind' from public.atlas_actions where id = '__atlas_structure_duplicate__'),
  'duplicate_resolution',
  'duplicate resolution stores typed evidence'
);
select is(
  (select count(*) from public.atlas_action_relations where source_action_id = '__atlas_structure_duplicate__' and relation_type = 'duplicate' and status = 'active'),
  1::bigint,
  'one active canonical duplicate edge exists'
);
select lives_ok(
  $$select public.restore_atlas_duplicate_action('__atlas_structure_duplicate__', 'ransomed', (select revision from public.atlas_actions where id='__atlas_structure_duplicate__'))$$,
  'the owner can restore an incorrectly marked duplicate'
);
select ok(
  (select status = 'not_started' and resolution is null and duplicate_of_id is null from public.atlas_actions where id = '__atlas_structure_duplicate__'),
  'restoring a duplicate makes it active without stale resolution'
);
select is(
  (select status from public.atlas_action_relations where source_action_id = '__atlas_structure_duplicate__' and relation_type = 'duplicate'),
  'archived',
  'restoring a duplicate archives its relation evidence'
);
select throws_ok(
  $$delete from public.atlas_action_relations where id = '__atlas_structure_blocks__'$$,
  '55000',
  'ATLAS_IMMUTABLE_HISTORY',
  'relations cannot be physically deleted'
);

select * from finish();
rollback;
