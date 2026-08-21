begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

select is((select count(*) from public.atlas_actions where parent_action_id='real-estate-annual-inspections-yard-pest-2026'),4::bigint,'the property outcome has four direct sub-actions');
select is((select count(*) from public.atlas_actions where parent_action_id='real-estate-annual-inspections-yard-pest-2026' and project_id='portfolio-real-estate-care'),4::bigint,'all property children inherit the project');
select is((select count(*) from public.atlas_actions where parent_action_id='real-estate-annual-inspections-yard-pest-2026' and project_milestone_id='milestone-real-estate-inspection-plans'),4::bigint,'all property children occupy the inspection milestone');
select is((select count(*) from public.atlas_actions where parent_action_id='real-estate-annual-inspections-yard-pest-2026' and estimate_points=1),4::bigint,'the four bounded child plans have honest unit estimates');
select is((select count(*) from public.atlas_actions where parent_action_id='real-estate-annual-inspections-yard-pest-2026' and cycle_id=(select id from public.atlas_cycles where schedule_id='portfolio-workspace-cycle' and status='active')),4::bigint,'all four executable children are in the active cycle');
select ok((select cycle_id is null and estimate_points is null from public.atlas_actions where id='real-estate-annual-inspections-yard-pest-2026'),'the parent outcome is not double-counted in cycle capacity');
select ok((select parent_auto_close and not sub_action_auto_close from public.atlas_workflows where business='real_estate' and archived_at is null),'the real-estate workflow closes the parent only after all children resolve');
select is((select count(*) from public.atlas_workflow_activity_log where event='hierarchy_completion_policy_enabled' and workflow_id=(select id from public.atlas_workflows where business='real_estate' and archived_at is null)),1::bigint,'the workflow policy change is audited');
select is((select count(*) from public.atlas_documents where id='portfolio-doc-property-inspections' and status='active'),1::bigint,'the four-property operating document exists');
select is((select count(*) from public.atlas_text_references where source_id='portfolio-doc-property-inspections' and status='active'),5::bigint,'the property document links the parent and four children');
select is((select count(*) from public.atlas_saved_views where id='portfolio-view-portfolio-real-estate-care' and archived_at is null),1::bigint,'the property project has a contextual action board');
select is((select count(*) from public.atlas_notifications notification join public.atlas_notification_events event on event.id=notification.event_id where notification.principal_id='ransomed' and notification.status='unread' and event.created_at>=timestamptz '2026-08-21T06:36:09Z' and (event.resource_id like 'portfolio-%' or exists(select 1 from public.atlas_actions action where action.id=event.resource_id and action.project_id like 'portfolio-%') or exists(select 1 from public.atlas_cycles cycle where cycle.id=event.resource_id and cycle.schedule_id='portfolio-workspace-cycle'))),8::bigint,'the activation Inbox is compacted to eight navigation-worthy notices');
select ok((select count(*)>100 from public.atlas_notifications notification join public.atlas_notification_events event on event.id=notification.event_id where notification.principal_id='ransomed' and notification.status='archived' and event.created_at>=timestamptz '2026-08-21T06:36:09Z'),'bootstrap activity remains recoverable as archived notification history');
select is((select count(*) from public.atlas_releases where id like 'portfolio-%'),0::bigint,'hierarchy activation still creates no fake release');

select * from finish();
rollback;
