-- Forward advisor correction for production migration 2026082014.
create index if not exists atlas_dashboard_insights_insight_idx
  on public.atlas_dashboard_insights(insight_id) where status='active';
