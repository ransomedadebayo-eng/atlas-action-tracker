-- Cover the remaining weekly-plan foreign-key access paths.

create index if not exists atlas_weekly_plan_activity_revision_idx
  on public.atlas_weekly_plan_activity(weekly_revision_id,created_at desc);
create index if not exists atlas_weekly_plan_items_source_action_idx
  on public.atlas_weekly_plan_items(source_action_id)
  where source_action_id is not null;
