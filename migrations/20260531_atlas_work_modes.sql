ALTER TABLE public.atlas_actions ADD COLUMN IF NOT EXISTS work_mode text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'atlas_actions_work_mode_check'
      AND conrelid = 'public.atlas_actions'::regclass
  ) THEN
    ALTER TABLE public.atlas_actions
      ADD CONSTRAINT atlas_actions_work_mode_check
      CHECK (work_mode IS NULL OR work_mode IN ('autonomous', 'review_required', 'user_only'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_atlas_actions_work_mode ON public.atlas_actions(work_mode);

COMMENT ON COLUMN public.atlas_actions.work_mode IS
  'Agent collaboration mode: autonomous, review_required, user_only, or null when not classified.';
