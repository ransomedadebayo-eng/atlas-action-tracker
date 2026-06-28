CREATE TABLE IF NOT EXISTS public.atlas_today_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL,
  rule_type text NOT NULL CHECK (rule_type IN ('hard_gate', 'score', 'capacity')),
  enabled boolean NOT NULL DEFAULT true,
  weight integer NOT NULL DEFAULT 0,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  rationale text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.atlas_today_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_label text NOT NULL,
  rules_snapshot jsonb NOT NULL,
  activated_by text NOT NULL DEFAULT 'system',
  proposal_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.atlas_daily_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_date date NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'superseded', 'blocked')),
  readiness_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_capacity integer NOT NULL DEFAULT 3,
  rule_version_id uuid NULL REFERENCES public.atlas_today_rule_versions(id),
  automation_report_id uuid NULL REFERENCES public.automation_run_reports(id),
  summary text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.atlas_daily_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.atlas_daily_plans(id) ON DELETE CASCADE,
  source_action_id text NULL REFERENCES public.atlas_actions(id),
  source_report_id uuid NULL REFERENCES public.automation_run_reports(id),
  item_status text NOT NULL CHECK (item_status IN ('selected', 'review', 'deferred', 'suppressed')),
  rank integer NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  score integer NOT NULL DEFAULT 0,
  matched_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_gate text NULL,
  estimated_effort text NULL,
  source_confidence text NOT NULL DEFAULT 'medium',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS atlas_daily_plan_items_plan_id_status_idx
  ON public.atlas_daily_plan_items(plan_id, item_status, rank);

CREATE TABLE IF NOT EXISTS public.atlas_today_rule_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'activated')),
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  proposal_type text NOT NULL DEFAULT 'rule_change',
  rule_key text NULL,
  rationale text NOT NULL DEFAULT '',
  proposed_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_rule jsonb NULL,
  expected_impact text NOT NULL DEFAULT '',
  proposed_by text NOT NULL DEFAULT 'assistant',
  proposed_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  source_plan_id uuid NULL REFERENCES public.atlas_daily_plans(id),
  activated_rule_version_id uuid NULL REFERENCES public.atlas_today_rule_versions(id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
