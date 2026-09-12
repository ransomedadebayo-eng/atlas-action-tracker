-- A constrained week may have unused capacity, but automation must not turn
-- a rejected candidate into a zero-media policy.

with changed as (
  update public.atlas_media_plans
  set weekly_budget=1,revision=revision+1,updated_by='system',updated_at=timezone('utc',now())
  where weekly_budget=0
  returning id,week_start,revision
)
insert into public.atlas_media_plan_activity(media_plan_id,week_start,event,actor,idempotency_key,revision,details)
select id,week_start,'plan_refreshed','system','migration:atlas-media-positive-budget:'||week_start::text,revision,jsonb_build_object('weekly_budget',1,'reason','zero budget is not an automated outcome')
from changed
on conflict(idempotency_key) do nothing;

alter table public.atlas_media_plans drop constraint if exists atlas_media_plan_weekly_budget_check;
alter table public.atlas_media_plans add constraint atlas_media_plan_weekly_budget_check
  check(weekly_budget between 1 and 6);
