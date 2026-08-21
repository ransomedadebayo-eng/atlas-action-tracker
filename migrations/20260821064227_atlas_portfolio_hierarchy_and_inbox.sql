-- Complete the portfolio activation with one evidence-backed hierarchy and a
-- compact Inbox. The four property plans are real executable children of the
-- existing annual-inspection outcome; bootstrap activity noise is archived
-- while material project/cycle/document/dashboard notices remain visible.

insert into public.atlas_project_milestones(
  id,project_id,name,description,target_date,status,sort_order,created_by,updated_by
)
values(
  'milestone-real-estate-inspection-plans','portfolio-real-estate-care',
  'Property inspection plans','Create one verified annual inspection plan per live property.',
  date '2026-08-31','in_progress',1000,'ransomed','ransomed'
)
on conflict(id) do nothing;

select public.assign_atlas_action_to_project(
  'portfolio-real-estate-care','real-estate-annual-inspections-yard-pest-2026',
  'milestone-real-estate-inspection-plans',null,'ransomed'
);

do $migration$
declare parent_revision bigint;
begin
  select revision into parent_revision from public.atlas_actions
   where id='real-estate-annual-inspections-yard-pest-2026';
  if parent_revision is null then raise exception using errcode='P0002',message='ATLAS_PROPERTY_PARENT_NOT_FOUND'; end if;

  if not exists(select 1 from public.atlas_actions where id='property-inspection-211-wirecrested-2026') then
    perform public.create_atlas_sub_action('real-estate-annual-inspections-yard-pest-2026','property-inspection-211-wirecrested-2026','Prepare annual inspection plan — 211 Wirecrested','Use the four-home inspection contract to prepare the source-backed inspection, yard, and pest checklist for this live property.',date '2026-08-31','ransomed',parent_revision);
  end if;
  if not exists(select 1 from public.atlas_actions where id='property-inspection-ellingford-road-2026') then
    perform public.create_atlas_sub_action('real-estate-annual-inspections-yard-pest-2026','property-inspection-ellingford-road-2026','Prepare annual inspection plan — Ellingford Road','Use the four-home inspection contract to prepare the source-backed inspection, yard, and pest checklist for this live property.',date '2026-08-31','ransomed',parent_revision);
  end if;
  if not exists(select 1 from public.atlas_actions where id='property-inspection-kingsway-circle-2026') then
    perform public.create_atlas_sub_action('real-estate-annual-inspections-yard-pest-2026','property-inspection-kingsway-circle-2026','Prepare annual inspection plan — Kingsway Circle','Use the four-home inspection contract to prepare the source-backed inspection, yard, and pest checklist for this live property.',date '2026-08-31','ransomed',parent_revision);
  end if;
  if not exists(select 1 from public.atlas_actions where id='property-inspection-willkomen-way-2026') then
    perform public.create_atlas_sub_action('real-estate-annual-inspections-yard-pest-2026','property-inspection-willkomen-way-2026','Prepare annual inspection plan — Willkomen Way','Use the four-home inspection contract to prepare the source-backed inspection, yard, and pest checklist for this live property.',date '2026-08-31','ransomed',parent_revision);
  end if;
end
$migration$;

do $migration$
declare child_id text; active_cycle_id text;
begin
  select id into active_cycle_id from public.atlas_cycles
   where schedule_id='portfolio-workspace-cycle' and status='active'
   order by start_date desc limit 1;
  if active_cycle_id is null then raise exception using errcode='P0002',message='ATLAS_PORTFOLIO_ACTIVE_CYCLE_NOT_FOUND'; end if;

  if exists(select 1 from public.atlas_actions where id='real-estate-annual-inspections-yard-pest-2026' and cycle_id=active_cycle_id) then
    perform public.remove_atlas_action_from_cycle(active_cycle_id,'real-estate-annual-inspections-yard-pest-2026','ransomed');
  end if;

  foreach child_id in array array[
    'property-inspection-211-wirecrested-2026',
    'property-inspection-ellingford-road-2026',
    'property-inspection-kingsway-circle-2026',
    'property-inspection-willkomen-way-2026'
  ] loop
    perform public.assign_atlas_action_to_project(
      'portfolio-real-estate-care',child_id,'milestone-real-estate-inspection-plans',1,'ransomed'
    );
    perform public.assign_atlas_action_to_cycle(active_cycle_id,child_id,'ransomed');
  end loop;
end
$migration$;

with changed as(
  update public.atlas_workflows
     set parent_auto_close=true,revision=revision+1,updated_by='ransomed',updated_at=timezone('utc',now())
   where business='real_estate' and archived_at is null and not parent_auto_close
  returning id
)
insert into public.atlas_workflow_activity_log(
  workflow_id,entity_type,entity_id,event,old_value,new_value,actor
)
select id,'workflow',id::text,'hierarchy_completion_policy_enabled',
       '{"parent_auto_close":false}'::jsonb,'{"parent_auto_close":true,"sub_action_auto_close":false}'::jsonb,'ransomed'
from changed;

insert into public.atlas_saved_views(
  id,name,filters,sort_by,sort_dir,entity_type,context_project_id,layout,
  group_by,display_options,is_favorite,is_default,created_by,updated_by
)
values(
  'portfolio-view-portfolio-real-estate-care','Active board',
  '{"status":"not_started,in_progress,waiting,blocked,todo,open"}','priority','asc',
  'action','portfolio-real-estate-care','board','status','{}',true,false,'ransomed','ransomed'
)
on conflict(id) do nothing;

insert into public.atlas_documents(
  id,title,content,context_type,context_id,icon,color,status,created_by,updated_by
)
select
  'portfolio-doc-property-inspections','Four-Property Inspection Plan',
  format(
    '# Four-Property Inspection Plan\n\nParent outcome: %s.\n\n- %s — 211 Wirecrested\n- %s — Ellingford Road\n- %s — Kingsway Circle\n- %s — Willkomen Way\n\nEach child produces one inspection/yard/pest checklist. Vendor contact, booking, contracts, purchases, and insurance changes remain owner-gated.',
    (select identifier from public.atlas_actions where id='real-estate-annual-inspections-yard-pest-2026'),
    (select identifier from public.atlas_actions where id='property-inspection-211-wirecrested-2026'),
    (select identifier from public.atlas_actions where id='property-inspection-ellingford-road-2026'),
    (select identifier from public.atlas_actions where id='property-inspection-kingsway-circle-2026'),
    (select identifier from public.atlas_actions where id='property-inspection-willkomen-way-2026')
  ),
  'project','portfolio-real-estate-care','file-text','#a16207','active','ransomed','ransomed'
where not exists(select 1 from public.atlas_documents where id='portfolio-doc-property-inspections');

-- Keep only the compact activation notices that help the owner navigate the
-- new portfolio. All underlying event history remains immutable.
do $migration$
declare notification_row record;
begin
  for notification_row in
    select notification.id,notification.revision
      from public.atlas_notifications notification
      join public.atlas_notification_events event on event.id=notification.event_id
     where notification.principal_id='ransomed'
       and notification.status<>'archived'
       and event.created_at>=timestamptz '2026-08-21T06:36:09Z'
       and (
         event.resource_id like 'portfolio-%'
         or exists(select 1 from public.atlas_actions action where action.id=event.resource_id and action.project_id like 'portfolio-%')
         or exists(select 1 from public.atlas_initiatives initiative where initiative.id=event.resource_id and initiative.id like 'initiative-%-2026')
         or exists(select 1 from public.atlas_cycles cycle where cycle.id=event.resource_id and cycle.schedule_id='portfolio-workspace-cycle')
       )
       and not (
         (event.resource_type='project' and event.event_action='updated' and event.resource_id in(
           'portfolio-atlas-agent-ops','portfolio-asa-beta','portfolio-family-health-admin',
           'portfolio-nigeria-travel-docs','portfolio-riddim-label'
         ))
         or (event.resource_type='cycle' and event.event_action='updated' and event.payload->>'event'='cycle_updated' and exists(
           select 1 from public.atlas_cycles cycle where cycle.id=event.resource_id and cycle.schedule_id='portfolio-workspace-cycle' and cycle.status='active'
         ))
         or (event.resource_type='document' and event.event_action='created' and event.resource_id='portfolio-operating-map-2026')
         or (event.resource_type='insight' and event.event_action='created' and event.resource_id='portfolio-command-dashboard')
       )
  loop
    perform public.transition_atlas_notification(notification_row.id,'archived','ransomed',notification_row.revision);
  end loop;
end
$migration$;
