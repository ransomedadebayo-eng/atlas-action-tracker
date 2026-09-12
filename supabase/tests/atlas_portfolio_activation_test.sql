begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(40);

select is((select count(*) from public.atlas_projects where id like 'portfolio-%'),12::bigint,'twelve evidence-backed portfolio projects exist');
select is((select count(*) from public.atlas_initiatives where id like 'initiative-%-2026'),4::bigint,'four strategic initiatives exist');
select is((select count(*) from public.atlas_project_milestones where id like 'milestone-%'),16::bigint,'sixteen verifiable milestones exist');
select is((select count(*) from public.atlas_actions where project_id like 'portfolio-%'),37::bigint,'thirty-seven current actions occupy outcome projects');
select is((select count(*) from public.atlas_actions where status in('not_started','in_progress','waiting','blocked','todo','open') and project_id is null),2::bigint,'only two intentionally standalone active actions remain unprojected');
select set_eq(
  $$select id from public.atlas_actions where status in('not_started','in_progress','waiting','blocked','todo','open') and project_id is null$$,
  $$select * from (values('household-2026-0705-mount-curtains'::text),('d1f343a0-0a7c-4c7c-b130-ca34a2d0a0db'::text)) as expected(id)$$,
  'the standalone actions are the curtain chore and Pharmaclock onboarding'
);
select is((select count(*) from public.atlas_initiative_projects where status='active' and initiative_id like 'initiative-%-2026'),13::bigint,'initiative membership connects all strategic projects');
select ok((select bool_and(project_count>=2) from(select initiative_id,count(*) project_count from public.atlas_initiative_projects where status='active' and initiative_id like 'initiative-%-2026' group by initiative_id) grouped),'every initiative contains at least two projects');

select is((select status from public.atlas_actions where id='c9a40e09-a3d9-4ee3-8050-58328ef5b6cb'),'in_progress','Relationships standing anchor is active');
select is((select status from public.atlas_actions where id='9d45ade8-3383-4855-8382-d4b837a6bab3'),'in_progress','Creative standing anchor is active');
select ok((select resolution is null and completed_at is null from public.atlas_actions where id='c9a40e09-a3d9-4ee3-8050-58328ef5b6cb'),'Relationships completion markers were cleared');
select ok((select resolution is null and completed_at is null from public.atlas_actions where id='9d45ade8-3383-4855-8382-d4b837a6bab3'),'Creative completion markers were cleared');
select is((select count(*) from public.atlas_activity_log where event='standing_anchor_reactivated' and action_id in('c9a40e09-a3d9-4ee3-8050-58328ef5b6cb','9d45ade8-3383-4855-8382-d4b837a6bab3')),2::bigint,'anchor reactivation is audited');

select is((select project_milestone_id from public.atlas_actions where id='re-label-2026-0809-002'),'milestone-riddim-legal-rights','Riddim contract work is in Legal & rights');
select is((select project_milestone_id from public.atlas_actions where id='re-label-2026-0809-005'),'milestone-riddim-catalog-distribution','Riddim catalog work is in Catalog & distribution');
select is((select project_milestone_id from public.atlas_actions where id='re-label-2026-0809-006'),'milestone-riddim-finance-controls','Riddim royalty work is in Finance & administration');
select is((select count(*) from public.atlas_actions where project_id='portfolio-riddim-label'),9::bigint,'the label project contains nine foundation actions');
select is((select count(*) from public.atlas_actions where project_id='portfolio-four-lane'),4::bigint,'the Four-Lane project contains all four anchors');

select is((select count(*) from public.atlas_cycle_schedules where id='portfolio-workspace-cycle' and enabled),1::bigint,'one workspace execution cadence exists');
select is((select count(*) from public.atlas_cycles where schedule_id='portfolio-workspace-cycle' and status='active'),1::bigint,'one portfolio cycle is active');
select is((select count(*) from public.atlas_cycles where schedule_id='portfolio-workspace-cycle' and status='planned'),3::bigint,'three future portfolio cycles exist');
select is((select count(*) from public.atlas_actions where cycle_id=(select id from public.atlas_cycles where schedule_id='portfolio-workspace-cycle' and status='active')),6::bigint,'the active cycle contains six executable actions');
select is((select count(*) from public.atlas_actions where cycle_id is not null and work_mode='user_only'),0::bigint,'user-only work is excluded from cycles');
select is((select count(*) from public.atlas_actions where cycle_id is not null and approval_state in('needs_review','deferred','user_only')),0::bigint,'dormant approval work is excluded from cycles');
select set_eq(
  $$select id from public.atlas_actions where cycle_id=(select id from public.atlas_cycles where schedule_id='portfolio-workspace-cycle' and status='active')$$,
  $$select * from (values('email-triage-2026-08-12-resolve-supabase-security-advisor-findings'::text),('re-2026-0318-013'::text),('property-inspection-211-wirecrested-2026'::text),('property-inspection-ellingford-road-2026'::text),('property-inspection-kingsway-circle-2026'::text),('property-inspection-willkomen-way-2026'::text)) as expected(id)$$,
  'the active cycle contains only the selected bounded work'
);

select is((select count(*) from public.atlas_saved_views where id like 'portfolio-view-%' and archived_at is null),9::bigint,'nine multi-action projects have contextual boards');
select is((select count(*) from public.atlas_saved_views where id in('portfolio-active-projects-timeline','portfolio-active-initiatives') and archived_at is null),2::bigint,'portfolio and initiative workspace views exist');
select is((select count(*) from public.atlas_documents where id like 'portfolio-%' and status='active'),6::bigint,'six useful portfolio documents exist');
select ok((select count(*)>=20 from public.atlas_text_references where status='active' and source_id like 'portfolio-%'),'portfolio documents and projects produce automatic backlinks');
select is((select count(*) from public.atlas_project_updates where id like 'portfolio-update-%'),5::bigint,'five material activation health updates exist');
select is((select count(*) from public.atlas_notification_subscriptions where principal_id='ransomed' and target_type='project' and target_id like 'portfolio-%' and status='active'),5::bigint,'five owner project subscriptions exist');
select ok((select count(*)>=5 from public.atlas_notifications notification join public.atlas_notification_events event on event.id=notification.event_id where notification.principal_id='ransomed' and event.resource_type='project' and event.resource_id like 'portfolio-%'),'portfolio updates reached the Atlas Inbox');

select is((select count(*) from public.atlas_insights where id like 'portfolio-insight-%' and status='active'),4::bigint,'four reusable portfolio Insights exist');
select is((select count(*) from public.atlas_dashboards where id='portfolio-command-dashboard' and status='active'),1::bigint,'the portfolio command dashboard exists');
select is((select count(*) from public.atlas_dashboard_insights where dashboard_id='portfolio-command-dashboard' and status='active'),4::bigint,'the dashboard contains four decision-useful cards');
select is((select count(*) from public.atlas_release_pipelines where id like 'portfolio-%'),0::bigint,'no fake release pipeline was created');
select is((select count(*) from public.atlas_releases where id like 'portfolio-%'),0::bigint,'no fake release was created');

select ok((select status='in_progress' and priority='p0' and owners='["codex"]'::jsonb and work_mode='autonomous' and approval_state='not_required' from public.atlas_actions where id='email-triage-2026-08-12-resolve-supabase-security-advisor-findings'),'security action semantics are preserved');
select ok((select status='not_started' and priority='p1' and owners='["codex","ransomed"]'::jsonb and work_mode='review_required' and approval_state='needs_review' from public.atlas_actions where id='re-label-2026-0809-002'),'Riddim review-gated action semantics are preserved');
select ok((select count(*)=count(distinct identifier) and count(*)=count(identifier) from public.atlas_actions),'all action identifiers remain unique and populated');

select * from finish();
rollback;
