-- AEGIS Agent Operating Protocol V1, Atlas-side migration copy.
-- The canonical PEOS migration also seeds task playbooks. This file keeps
-- Atlas schema history aware of the action fields it now reads and writes.

alter table public.atlas_actions
  add column if not exists next_action text,
  add column if not exists definition_of_done text,
  add column if not exists review_date text,
  add column if not exists evidence_json jsonb not null default '{}'::jsonb,
  add column if not exists agent_assignment_id uuid,
  add column if not exists approval_state text not null default 'not_required';

alter table public.atlas_actions
  drop constraint if exists atlas_actions_evidence_json_check,
  add constraint atlas_actions_evidence_json_check
    check (jsonb_typeof(evidence_json) = 'object'),
  drop constraint if exists atlas_actions_approval_state_check,
  add constraint atlas_actions_approval_state_check
    check (
      approval_state in (
        'not_required',
        'needs_review',
        'approved',
        'rejected',
        'deferred',
        'user_only'
      )
    );

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'atlas_actions'
      and constraint_name = 'atlas_actions_agent_assignment_id_fkey'
  ) then
    alter table public.atlas_actions
      add constraint atlas_actions_agent_assignment_id_fkey
      foreign key (agent_assignment_id) references public.agent_assignments(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_atlas_actions_review_date
  on public.atlas_actions (review_date)
  where review_date is not null;

create index if not exists idx_atlas_actions_approval_state
  on public.atlas_actions (approval_state);

create index if not exists idx_atlas_actions_agent_assignment_id
  on public.atlas_actions (agent_assignment_id)
  where agent_assignment_id is not null;

insert into public.atlas_saved_views (id, name, filters, sort_by, sort_dir)
values
  (
    'codex-pull-queue',
    'Codex Pull Queue',
    '{"status":"not_started,in_progress,waiting,blocked,todo,open","work_mode":"autonomous","owner_id":"codex","show_blocked":"true"}'::jsonb,
    'priority',
    'asc'
  ),
  (
    'needs-review',
    'Needs Review',
    '{"status":"not_started,in_progress,waiting,blocked,todo,open","work_mode":"review_required","show_blocked":"true"}'::jsonb,
    'priority',
    'asc'
  ),
  (
    'user-only',
    'User Only',
    '{"status":"not_started,in_progress,waiting,blocked,todo,open","work_mode":"user_only","show_blocked":"true"}'::jsonb,
    'priority',
    'asc'
  ),
  (
    'unclassified-cleanup',
    'Unclassified Cleanup',
    '{"status":"not_started,in_progress,waiting,blocked,todo,open","work_mode":"__null__","show_blocked":"true"}'::jsonb,
    'updated_at',
    'desc'
  ),
  (
    'stale-needs-stewardship',
    'Stale / Needs Stewardship',
    '{"status":"not_started,in_progress,waiting,blocked,todo,open","stewardship":"stale","show_blocked":"true"}'::jsonb,
    'priority',
    'asc'
  )
on conflict (id) do update set
  name = excluded.name,
  filters = excluded.filters,
  sort_by = excluded.sort_by,
  sort_dir = excluded.sort_dir,
  updated_at = timezone('utc'::text, now());
