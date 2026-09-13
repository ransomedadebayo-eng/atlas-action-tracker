-- ATLAS-693 / PR #7: keep the canonical digest and open saved views aligned.
-- Preserve the existing columns, Done (48h) window, and waiting-before-blocked order.
CREATE OR REPLACE VIEW public.atlas_office_digest_v1
WITH (security_invoker = true) AS
SELECT
  CASE
    WHEN status = 'done' AND completed_at IS NOT NULL
      AND completed_at >= now() - interval '48 hours' THEN 'done'
    WHEN archived_at IS NULL
      AND status NOT IN ('done', 'completed', 'closed', 'cancelled', 'canceled', 'archived')
      AND approval_state = 'needs_review' THEN 'waiting_on_owner'
    WHEN archived_at IS NULL
      AND status NOT IN ('done', 'completed', 'closed', 'cancelled', 'canceled', 'archived')
      AND blocked_by IS NOT NULL AND blocked_by <> '[]'::jsonb THEN 'blocked_by_office'
    ELSE NULL::text
  END AS digest_bucket,
  id, identifier, title, status, approval_state, business, project_id,
  owners, agent_assignment_id, blocked_by, next_action, priority, due_date,
  work_mode, completed_at, updated_at, created_at
FROM public.atlas_actions a
WHERE (status = 'done' AND completed_at IS NOT NULL
       AND completed_at >= now() - interval '48 hours')
   OR (archived_at IS NULL
       AND status NOT IN ('done', 'completed', 'closed', 'cancelled', 'canceled', 'archived')
       AND approval_state = 'needs_review')
   OR (archived_at IS NULL
       AND status NOT IN ('done', 'completed', 'closed', 'cancelled', 'canceled', 'archived')
       AND blocked_by IS NOT NULL AND blocked_by <> '[]'::jsonb);
