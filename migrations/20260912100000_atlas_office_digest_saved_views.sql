-- Align office-digest saved-view filters with public.atlas_office_digest_v1.
-- The view remains canonical; these filters are the UI/API equivalent.

update public.atlas_saved_views
set
  filters = '{"status":"done","completed_within":"48h"}'::jsonb,
  sort_by = 'completed_at',
  sort_dir = 'desc',
  display_options = jsonb_build_object(
    'digest', 'done',
    'source', 'atlas_office_digest_v1',
    'include_fields', jsonb_build_array('owners', 'agent_assignment_id', 'completed_at'),
    'show_approval_state', true
  ),
  revision = revision + 1,
  updated_by = 'ransomed',
  updated_at = timezone('utc', now())
where id = 'office-digest-done';

update public.atlas_saved_views
set
  filters = '{"open":"true","approval_state":"needs_review"}'::jsonb,
  sort_by = 'updated_at',
  sort_dir = 'desc',
  display_options = jsonb_build_object(
    'digest', 'waiting_on_owner',
    'source', 'atlas_office_digest_v1',
    'include_fields', jsonb_build_array('owners', 'agent_assignment_id', 'approval_state'),
    'show_approval_state', true
  ),
  revision = revision + 1,
  updated_by = 'ransomed',
  updated_at = timezone('utc', now())
where id = 'office-digest-waiting-on-owner';

update public.atlas_saved_views
set
  filters = '{"open":"true","has_blocked_by":"true","exclude_approval_state":"needs_review"}'::jsonb,
  sort_by = 'updated_at',
  sort_dir = 'desc',
  display_options = jsonb_build_object(
    'digest', 'blocked_by_office',
    'source', 'atlas_office_digest_v1',
    'include_fields', jsonb_build_array('blocked_by', 'owners', 'agent_assignment_id'),
    'show_approval_state', true
  ),
  revision = revision + 1,
  updated_by = 'ransomed',
  updated_at = timezone('utc', now())
where id = 'office-digest-blocked-by-office';
