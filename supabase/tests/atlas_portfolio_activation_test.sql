begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(28);

select is((select count(*) from public.atlas_projects where id like 'portfolio-%'),12::bigint,'twelve evidence-backed portfolio projects exist');
select is((select count(*) from public.atlas_project_milestones where id like 'milestone-%'),16::bigint,'sixteen verifiable milestones exist');
select is((select count(*) from public.atlas_actions where project_id like 'portfolio-%'),37::bigint,'thirty-seven current actions occupy outcome projects');
select is((select count(*) from public.atlas_actions where status in('not_started','in_progress','waiting','blocked','todo','open') and project_id is null),2::bigint,'only two intentionally standalone active actions remain unprojected');
select set_eq(
  $$select id from public.atlas_actions where status in('not_started','in_progress','waiting','blocked','todo','open') and project_id is null$$,
  $$select * from (values('household-2026-0705-mount-curtains'::text),('d1f343a0-0a7c-4c7c-b130-ca34a2d0a0db'::text)) as expected(id)$$,
  'the standalone actions are the curtain chore and Pharmaclock onboarding'
);

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

select is((select count(*) from public.atlas_actions where cycle_id is not null and work_mode='user_only'),0::bigint,'user-only work is excluded from cycles');
select is((select count(*) from public.atlas_actions where cycle_id is not null and approval_state in('needs_review','deferred','user_only')),0::bigint,'dormant approval work is excluded from cycles');

select is((select count(*) from public.atlas_saved_views where id like 'portfolio-view-%' and archived_at is null),9::bigint,'nine multi-action projects have contextual boards');
select is((select count(*) from public.atlas_saved_views where id='portfolio-active-projects-timeline' and archived_at is null),1::bigint,'portfolio project workspace view remains active');
select is((select count(*) from public.atlas_documents where id like 'portfolio-%' and status='active'),6::bigint,'six useful portfolio documents exist');
select ok((select count(*)>=20 from public.atlas_text_references where status='active' and source_id like 'portfolio-%'),'portfolio documents and projects produce automatic backlinks');
select is((select count(*) from public.atlas_project_updates where id like 'portfolio-update-%'),5::bigint,'five material activation health updates exist');
select is((select count(*) from public.atlas_notification_subscriptions where principal_id='ransomed' and target_type='project' and target_id like 'portfolio-%' and status='active'),5::bigint,'five owner project subscriptions exist');
select ok((select count(*)>=5 from public.atlas_notifications notification join public.atlas_notification_events event on event.id=notification.event_id where notification.principal_id='ransomed' and event.resource_type='project' and event.resource_id like 'portfolio-%'),'portfolio updates reached the Atlas Inbox');


select ok((select status='in_progress' and priority='p0' and owners='["codex"]'::jsonb and work_mode='autonomous' and approval_state='not_required' from public.atlas_actions where id='email-triage-2026-08-12-resolve-supabase-security-advisor-findings'),'security action semantics are preserved');
select ok((select status='not_started' and priority='p1' and owners='["codex","ransomed"]'::jsonb and work_mode='review_required' and approval_state='needs_review' from public.atlas_actions where id='re-label-2026-0809-002'),'Riddim review-gated action semantics are preserved');
select ok((select count(*)=count(distinct identifier) and count(*)=count(identifier) from public.atlas_actions),'all action identifiers remain unique and populated');

select ok((select archived_at is not null from public.atlas_saved_views where id='portfolio-active-initiatives'),'retired initiative view is archived');

select * from finish();
rollback;
