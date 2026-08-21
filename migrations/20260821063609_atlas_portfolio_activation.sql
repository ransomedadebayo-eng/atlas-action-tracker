-- Activate the full Atlas portfolio model for the existing live action queue.
-- Owner-authorized 2026-08-20. Idempotent stable IDs; no source-action
-- status/priority/owner/due-date/approval/evidence drift except reactivating the
-- two Four-Lane standing anchors that their own definitions require to remain active.

create temporary table atlas_portfolio_semantic_before on commit drop as
select id,status,priority,owners,due_date,approval_state,work_mode,evidence_json,
       completed_at,resolution
from public.atlas_actions;

insert into public.atlas_projects(
  id,name,summary,description,business,status,health,priority,lead_id,members,
  start_date,target_date,color,icon,update_frequency,sort_order,created_by,updated_by
)
values
  ('portfolio-atlas-agent-ops','Atlas & Agent Operations','Keep Atlas secure, reliable, and evidence-backed.','Current work: ATLAS-364 security hardening and ATLAS-88 Jarvis performance review.','aegis','in_progress','no_update','p0','codex','["codex","ransomed"]',date '2026-08-20',date '2026-09-15','#3b82f6','shield','weekly',1000,'ransomed','ransomed'),
  ('portfolio-asa-beta','Asa Beta Launch Foundation','Resolve the commercial and acquisition decisions required for an honest beta.','Founder decision work: ATLAS-387 commercial terms and ATLAS-396 waitlist/channel plan.','asa','in_progress','no_update','p1','codex','["codex","ransomed"]',date '2026-08-20',date '2026-09-30','#8b5cf6','rocket','weekly',2000,'ransomed','ransomed'),
  ('portfolio-family-health-admin','Family Health & Appointment Readiness','Complete bounded care-admin preparation and owner appointments.','Current work: ATLAS-300 appointment form, ATLAS-200 dermatology, and ATLAS-202 dental.','family','in_progress','no_update','p1','ransomed','["ransomed","codex"]',date '2026-08-20',date '2026-09-11','#ec4899','heart','weekly',3000,'ransomed','ransomed'),
  ('portfolio-nigeria-travel-docs','Nigeria Family Travel & Documents','Resolve traveler, itinerary, and family document readiness for Nigeria.','Current work: ATLAS-203 trip decision, ATLAS-204 eVisa preparation, and ATLAS-198 combined document follow-up.','personal','in_progress','no_update','p1','ransomed','["ransomed","codex"]',date '2026-08-20',date '2026-10-01','#f59e0b','plane','weekly',4000,'ransomed','ransomed'),
  ('portfolio-four-lane','Four-Lane Weekly Portfolio','Operate the approved Foundation, Relationships, Growth, and Creative weekly protocol.','Long-lived planning anchors: ATLAS-382, ATLAS-185, ATLAS-386, and ATLAS-192.','personal','in_progress','no_update','p2','ransomed','["ransomed"]',date '2026-08-16',null,'#22c55e','compass','weekly',5000,'ransomed','ransomed'),
  ('portfolio-family-celebrations','Family Celebrations & Gifts','Make the next family celebration and gift decisions with clear scope and gates.','Current work: ATLAS-199 Mum birthday planning and ATLAS-339 Ola gift decision.','personal','planned','no_update','p3','ransomed','["ransomed","codex"]',date '2026-08-20',date '2026-11-15','#f97316','gift','monthly',6000,'ransomed','ransomed'),
  ('portfolio-riddim-label','Riddim Exchange Label Foundation','Build the legal, rights, distribution, catalog, and accounting foundation for the label.','Foundation work: ATLAS-138, ATLAS-248, ATLAS-258, ATLAS-189, ATLAS-254, ATLAS-259, ATLAS-255, ATLAS-260, and ATLAS-139.','riddim_exchange','planned','no_update','p1','codex','["codex","ransomed"]',date '2026-08-20',date '2026-12-31','#ef4444','music','biweekly',7000,'ransomed','ransomed'),
  ('portfolio-riddim-grants','Riddim Exchange 2027 Grant Pipeline','Build a verified, direct-eligibility grant pipeline for 2027.','The dated research and preparation case is ATLAS-366.','riddim_exchange','planned','no_update','p2','codex','["codex"]',date '2026-12-01',date '2026-12-15','#dc2626','award','monthly',8000,'ransomed','ransomed'),
  ('portfolio-wealth-strategy','Family Investment Strategy','Decide which investment capabilities belong in the family roadmap before any capital moves.','Current research: ATLAS-481 entity strategy, ATLAS-478 angel-investor readiness, and ATLAS-479 passive-income stack.','wealth-os','planned','no_update','p1','codex','["codex","ransomed"]',date '2026-08-20',date '2026-12-31','#14b8a6','trending-up','monthly',9000,'ransomed','ransomed'),
  ('portfolio-tax-reconciliation','2025 California Tax Reconciliation','Carry the amended-return payment case to authoritative resolution.','Canonical case: ATLAS-483.','wealth-os','in_progress','no_update','p1','codex','["codex","ransomed"]',date '2026-08-20',null,'#0f766e','receipt','weekly',10000,'ransomed','ransomed'),
  ('portfolio-real-estate-care','2026 Property Care & Inspections','Create a verified annual inspection, yard, and pest plan across four properties.','Canonical case: ATLAS-221.','real_estate','in_progress','no_update','p2','codex','["codex","ransomed"]',date '2026-08-20',date '2026-08-31','#a16207','home','weekly',11000,'ransomed','ransomed'),
  ('portfolio-mannahouse-marketing','Manna House Marketing Readiness','Verify Google Ads account and measurement readiness before any campaign mutation.','Blocked authenticated-readiness case: ATLAS-222.','mannahouse','paused','no_update','p2','codex','["codex","ransomed"]',date '2026-08-20',null,'#6366f1','megaphone','monthly',12000,'ransomed','ransomed')
on conflict(id) do nothing;

insert into public.atlas_project_milestones(
  id,project_id,name,description,target_date,status,sort_order,created_by,updated_by
)
values
  ('milestone-atlas-security','portfolio-atlas-agent-ops','Security foundation','Scope and verify the least-privilege security work.',date '2026-08-31','in_progress',1000,'ransomed','ransomed'),
  ('milestone-atlas-performance','portfolio-atlas-agent-ops','Performance review','Resolve the bounded Jarvis performance decision.',date '2026-09-15','in_progress',2000,'ransomed','ransomed'),
  ('milestone-asa-commercial','portfolio-asa-beta','Commercial model','Approve vertical, pricing posture, and creator terms.',date '2026-08-31','in_progress',1000,'ransomed','ransomed'),
  ('milestone-asa-acquisition','portfolio-asa-beta','Waitlist activation','Approve channels, qualifiers, and capture requirements.',date '2026-09-15','in_progress',2000,'ransomed','ransomed'),
  ('milestone-family-forms','portfolio-family-health-admin','Appointment forms','Complete verified pre-visit form readiness.',date '2026-09-10','in_progress',1000,'ransomed','ransomed'),
  ('milestone-family-care-bookings','portfolio-family-health-admin','Care bookings','Book, waitlist, or intentionally defer dental and dermatology.',date '2026-09-11','in_progress',2000,'ransomed','ransomed'),
  ('milestone-nigeria-itinerary','portfolio-nigeria-travel-docs','Traveler and itinerary decision','Resolve traveler count, dates, and preferred itinerary.',date '2026-09-01','in_progress',1000,'ransomed','ransomed'),
  ('milestone-nigeria-documents','portfolio-nigeria-travel-docs','Family document readiness','Prepare verified eVisa and post-passport document work.',date '2026-10-01','planned',2000,'ransomed','ransomed'),
  ('milestone-family-mum-birthday','portfolio-family-celebrations','Mum birthday plan','Approve concept, participants, budget, and coordinator.',date '2026-11-15','planned',1000,'ransomed','ransomed'),
  ('milestone-family-ola-gift','portfolio-family-celebrations','Ola gift decision','Confirm need and choose or close the gift lane.',date '2026-08-24','planned',2000,'ransomed','ransomed'),
  ('milestone-riddim-legal-rights','portfolio-riddim-label','Legal & rights','Contracts, registrations, and copyright queue.',date '2026-10-31','planned',1000,'ransomed','ransomed'),
  ('milestone-riddim-catalog-distribution','portfolio-riddim-label','Catalog & distribution','Distributor workflow, catalog, and artist/house-band separation.',date '2026-11-30','planned',2000,'ransomed','ransomed'),
  ('milestone-riddim-finance-controls','portfolio-riddim-label','Finance & administration','Royalty ledger, banking/accounting, and annual compliance.',date '2026-12-31','planned',3000,'ransomed','ransomed'),
  ('milestone-wealth-entity','portfolio-wealth-strategy','Entity strategy','Compare and decide the family investment entity direction.',date '2026-12-31','planned',1000,'ransomed','ransomed'),
  ('milestone-wealth-learning','portfolio-wealth-strategy','Investor learning','Complete bounded angel and passive-income decision packets.',date '2026-10-15','planned',2000,'ransomed','ransomed')
on conflict(id) do nothing;

create temporary table atlas_portfolio_action_map(
  action_id text primary key,
  project_id text not null,
  milestone_id text,
  estimate_points integer
) on commit drop;

insert into atlas_portfolio_action_map values
  ('jarvis-performance-review-2026-08-19','portfolio-atlas-agent-ops','milestone-atlas-performance',null),
  ('email-triage-2026-08-12-resolve-supabase-security-advisor-findings','portfolio-atlas-agent-ops','milestone-atlas-security',3),
  ('lp-biz-creator-deal-terms','portfolio-asa-beta','milestone-asa-commercial',null),
  ('lp-biz-waitlist-nurture-plan','portfolio-asa-beta','milestone-asa-acquisition',null),
  ('email-triage-2026-08-14-complete-soulsisters-appointment-form','portfolio-family-health-admin','milestone-family-forms',null),
  ('health-2026-0705-book-dermatology-appointment','portfolio-family-health-admin','milestone-family-care-bookings',null),
  ('health-2026-0705-book-dental-appointment','portfolio-family-health-admin','milestone-family-care-bookings',null),
  ('family-nigeria-trip-december-2026-feasibility','portfolio-nigeria-travel-docs','milestone-nigeria-itinerary',null),
  ('family-2026-0905-start-nigeria-f6a-evisas','portfolio-nigeria-travel-docs','milestone-nigeria-documents',null),
  ('nicole-documents-name-change-passport-ssn-2026-06','portfolio-nigeria-travel-docs','milestone-nigeria-documents',null),
  ('51e4a3ec-ffd7-486c-b686-079fe0ea83be','portfolio-four-lane',null,null),
  ('c9a40e09-a3d9-4ee3-8050-58328ef5b6cb','portfolio-four-lane',null,null),
  ('44d7970e-13fd-45a4-b21c-97571fc84e79','portfolio-four-lane',null,null),
  ('9d45ade8-3383-4855-8382-d4b837a6bab3','portfolio-four-lane',null,null),
  ('family-2026-0705-plan-mum-december-birthday-kids','portfolio-family-celebrations','milestone-family-mum-birthday',null),
  ('e788bdfa-6d87-447e-ba4c-5742ab5dd76c','portfolio-family-celebrations','milestone-family-ola-gift',null),
  ('re-label-2026-0809-002','portfolio-riddim-label','milestone-riddim-legal-rights',null),
  ('re-label-2026-0809-004','portfolio-riddim-label','milestone-riddim-legal-rights',null),
  ('re-label-2026-0809-007','portfolio-riddim-label','milestone-riddim-legal-rights',null),
  ('re-label-2026-0809-003','portfolio-riddim-label','milestone-riddim-catalog-distribution',null),
  ('re-label-2026-0809-005','portfolio-riddim-label','milestone-riddim-catalog-distribution',null),
  ('re-label-2026-0809-008','portfolio-riddim-label','milestone-riddim-catalog-distribution',null),
  ('re-label-2026-0809-006','portfolio-riddim-label','milestone-riddim-finance-controls',null),
  ('re-label-2026-0809-009','portfolio-riddim-label','milestone-riddim-finance-controls',null),
  ('re-2026-0318-013','portfolio-riddim-label','milestone-riddim-finance-controls',2),
  ('re-grants-2027-prep','portfolio-riddim-grants',null,null),
  ('family-investment-arm-entity-2026','portfolio-wealth-strategy','milestone-wealth-entity',null),
  ('atlas-angel-invest-research-1775718942','portfolio-wealth-strategy','milestone-wealth-learning',null),
  ('research-nigerian-stock-market-ngx-2026','portfolio-wealth-strategy','milestone-wealth-learning',null),
  ('583ca246-c89a-4ae5-8bc3-1e89ac2374b3','portfolio-wealth-strategy','milestone-wealth-learning',null),
  ('tax-ftb-2025-amended-return-payment-reconciliation','portfolio-tax-reconciliation',null,null),
  ('real-estate-annual-inspections-yard-pest-2026','portfolio-real-estate-care',null,5),
  ('mh-2026-0520-google-ads-account-readiness-followup','portfolio-mannahouse-marketing',null,null);

do $migration$
declare mapped record; current_estimate integer;
begin
  for mapped in select * from atlas_portfolio_action_map order by project_id,action_id loop
    if not exists(select 1 from public.atlas_actions where id=mapped.action_id) then
      raise exception using errcode='P0002',message='ATLAS_PORTFOLIO_ACTION_NOT_FOUND',detail=mapped.action_id;
    end if;
    select estimate_points into current_estimate from public.atlas_actions where id=mapped.action_id;
    perform public.assign_atlas_action_to_project(
      mapped.project_id,mapped.action_id,mapped.milestone_id,
      coalesce(current_estimate,mapped.estimate_points),'ransomed'
    );
  end loop;
end
$migration$;

-- Long-lived weekly anchors were completed even though their definitions say
-- they remain active while the Four-Lane protocol is in use.
with reactivated as (
  update public.atlas_actions
     set status='in_progress',resolution=null,completed_at=null,
         revision=revision+1,updated_at=timezone('utc',now())
   where id in('c9a40e09-a3d9-4ee3-8050-58328ef5b6cb','9d45ade8-3383-4855-8382-d4b837a6bab3')
     and status in('done','completed','closed')
  returning id,status
)
insert into public.atlas_activity_log(action_id,event,old_value,new_value,actor)
select reactivated.id,'standing_anchor_reactivated',
       jsonb_build_object('status',before.status,'completed_at',before.completed_at,'resolution',before.resolution)::text,
       jsonb_build_object('status','in_progress','reason','Four-Lane standing anchor remains active by approved protocol')::text,
       'ransomed'
from reactivated
join atlas_portfolio_semantic_before before on before.id=reactivated.id;

insert into public.atlas_initiatives(
  id,name,summary,description,business,status,health,priority,owner_id,labels,
  start_date,target_date,color,icon,update_frequency,sort_order,created_by,updated_by
)
values
  ('initiative-life-family-2026','Life & Family Operations 2026','Protect health, family readiness, travel, relationships, and sustainable capacity.','Coordinates the family-health, Nigeria, celebration, and Four-Lane outcomes.','personal','active','no_update','p1','ransomed','["family","health","capacity"]',date '2026-08-20',date '2026-12-31','#ec4899','heart','biweekly',1000,'ransomed','ransomed'),
  ('initiative-ventures-2026','Venture Foundations 2026','Build the minimum legal, commercial, operating, and acquisition foundations for active ventures.','Coordinates Asa, Riddim Exchange, and Manna House foundation projects.',null,'active','no_update','p1','codex','["ventures","foundation"]',date '2026-08-20',date '2026-12-31','#8b5cf6','rocket','biweekly',2000,'ransomed','ransomed'),
  ('initiative-wealth-assets-2026','Wealth & Asset Operations 2026','Improve family investment readiness, tax resolution, and property operations without premature capital decisions.','Coordinates Wealth OS strategy, tax reconciliation, and property-care outcomes.','wealth-os','active','no_update','p1','codex','["wealth","tax","real-estate"]',date '2026-08-20',date '2026-12-31','#14b8a6','landmark','monthly',3000,'ransomed','ransomed'),
  ('initiative-personal-os-2026','Personal Operating System 2026','Keep the operating system secure, evidence-backed, and aligned to sustainable weekly execution.','Coordinates Atlas/agent operations and the approved Four-Lane weekly portfolio.','aegis','active','no_update','p0','codex','["atlas","aegis","execution"]',date '2026-08-20',date '2026-12-31','#3b82f6','settings','biweekly',4000,'ransomed','ransomed')
on conflict(id) do nothing;

create temporary table atlas_portfolio_initiative_map(
  initiative_id text,
  project_id text,
  primary key(initiative_id,project_id)
) on commit drop;

insert into atlas_portfolio_initiative_map values
  ('initiative-life-family-2026','portfolio-family-health-admin'),
  ('initiative-life-family-2026','portfolio-nigeria-travel-docs'),
  ('initiative-life-family-2026','portfolio-family-celebrations'),
  ('initiative-life-family-2026','portfolio-four-lane'),
  ('initiative-ventures-2026','portfolio-asa-beta'),
  ('initiative-ventures-2026','portfolio-riddim-label'),
  ('initiative-ventures-2026','portfolio-riddim-grants'),
  ('initiative-ventures-2026','portfolio-mannahouse-marketing'),
  ('initiative-wealth-assets-2026','portfolio-wealth-strategy'),
  ('initiative-wealth-assets-2026','portfolio-tax-reconciliation'),
  ('initiative-wealth-assets-2026','portfolio-real-estate-care'),
  ('initiative-personal-os-2026','portfolio-atlas-agent-ops'),
  ('initiative-personal-os-2026','portfolio-four-lane');

do $migration$
declare mapped record;
begin
  for mapped in select * from atlas_portfolio_initiative_map order by initiative_id,project_id loop
    perform public.set_atlas_initiative_project(mapped.initiative_id,mapped.project_id,true,'ransomed');
  end loop;
end
$migration$;

-- Contextual action boards for genuine multi-action projects.
insert into public.atlas_saved_views(
  id,name,filters,sort_by,sort_dir,entity_type,context_project_id,layout,
  group_by,display_options,is_favorite,is_default,created_by,updated_by
)
select
  'portfolio-view-'||project.id,
  'Active board',
  '{"status":"not_started,in_progress,waiting,blocked,todo,open"}'::jsonb,
  'priority','asc','action',project.id,'board','status','{}'::jsonb,true,false,
  'ransomed','ransomed'
from public.atlas_projects project
where project.id in(
  'portfolio-atlas-agent-ops','portfolio-asa-beta','portfolio-family-health-admin',
  'portfolio-nigeria-travel-docs','portfolio-four-lane','portfolio-family-celebrations',
  'portfolio-riddim-label','portfolio-wealth-strategy'
)
on conflict(id) do nothing;

insert into public.atlas_saved_views(
  id,name,filters,sort_by,sort_dir,entity_type,layout,group_by,display_options,
  is_favorite,is_default,created_by,updated_by
)
values
  ('portfolio-active-projects-timeline','Active portfolio timeline','{"status":"planned,in_progress,paused"}','priority','asc','project','timeline','business','{"zoom":"month"}',true,false,'ransomed','ransomed'),
  ('portfolio-active-initiatives','Active initiatives','{"status":"active,planned"}','priority','asc','initiative','list','health','{}',true,false,'ransomed','ransomed')
on conflict(id) do nothing;

-- One workspace cycle. Only near-term executable work is assigned.
do $migration$
declare active_cycle_id text;
begin
  if not exists(select 1 from public.atlas_cycle_schedules where id='portfolio-workspace-cycle') then
    perform public.configure_atlas_cycle_schedule(
      'portfolio-workspace-cycle',null,2,0,3,
      (timezone('America/Los_Angeles',now()))::date,
      'America/Los_Angeles',true,false,'ransomed',null
    );
  end if;
  select id into active_cycle_id from public.atlas_cycles
   where schedule_id='portfolio-workspace-cycle' and status='active'
   order by start_date desc limit 1;
  if active_cycle_id is null then raise exception using errcode='P0002',message='ATLAS_PORTFOLIO_ACTIVE_CYCLE_NOT_FOUND'; end if;
  update public.atlas_cycles set name='Portfolio Cycle 1',revision=revision+1,
    updated_by='ransomed',updated_at=timezone('utc',now())
   where id=active_cycle_id and name<>'Portfolio Cycle 1';
  perform public.assign_atlas_action_to_cycle(active_cycle_id,'email-triage-2026-08-12-resolve-supabase-security-advisor-findings','ransomed');
  perform public.assign_atlas_action_to_cycle(active_cycle_id,'real-estate-annual-inspections-yard-pest-2026','ransomed');
  perform public.assign_atlas_action_to_cycle(active_cycle_id,'re-2026-0318-013','ransomed');
end
$migration$;

-- Owner subscriptions precede material project updates so Inbox events are useful.
insert into public.atlas_notification_subscriptions(
  principal_id,target_type,target_id,categories,channels,source,status,created_by,updated_by
)
values
  ('ransomed','project','portfolio-atlas-agent-ops','["project_updates"]','["inbox"]','creator','active','ransomed','ransomed'),
  ('ransomed','project','portfolio-asa-beta','["project_updates"]','["inbox"]','creator','active','ransomed','ransomed'),
  ('ransomed','project','portfolio-family-health-admin','["project_updates"]','["inbox"]','creator','active','ransomed','ransomed'),
  ('ransomed','project','portfolio-nigeria-travel-docs','["project_updates"]','["inbox"]','creator','active','ransomed','ransomed'),
  ('ransomed','project','portfolio-riddim-label','["project_updates"]','["inbox"]','creator','active','ransomed','ransomed')
on conflict(principal_id,target_type,target_id) where status<>'archived' do update
set categories=excluded.categories,channels=excluded.channels,status='active',
    updated_by='ransomed',updated_at=timezone('utc',now());

do $migration$
begin
  if not exists(select 1 from public.atlas_project_updates where id='portfolio-update-atlas-activation') then
    perform public.post_atlas_project_update('portfolio-atlas-agent-ops','portfolio-update-atlas-activation','at_risk','Portfolio activation grouped ATLAS-364 and ATLAS-88. Security scoping is executable now; the performance-review decision is waiting on owner review.','ransomed');
  end if;
  if not exists(select 1 from public.atlas_project_updates where id='portfolio-update-asa-activation') then
    perform public.post_atlas_project_update('portfolio-asa-beta','portfolio-update-asa-activation','at_risk','ATLAS-387 and ATLAS-396 are structured under separate decision milestones. Both remain review-gated and overdue; no public positioning, outreach, spend, or deployment was authorized.','ransomed');
  end if;
  if not exists(select 1 from public.atlas_project_updates where id='portfolio-update-family-health-activation') then
    perform public.post_atlas_project_update('portfolio-family-health-admin','portfolio-update-family-health-activation','at_risk','ATLAS-200 and ATLAS-202 are overdue owner bookings; ATLAS-300 remains due before the September 11 visit. No appointment or form submission was performed.','ransomed');
  end if;
  if not exists(select 1 from public.atlas_project_updates where id='portfolio-update-nigeria-activation') then
    perform public.post_atlas_project_update('portfolio-nigeria-travel-docs','portfolio-update-nigeria-activation','on_track','ATLAS-203, ATLAS-204, and ATLAS-198 now share itinerary and document milestones. Dates and owner gates are preserved; no booking, portal, payment, or identity submission occurred.','ransomed');
  end if;
  if not exists(select 1 from public.atlas_project_updates where id='portfolio-update-riddim-label-activation') then
    perform public.post_atlas_project_update('portfolio-riddim-label','portfolio-update-riddim-label-activation','at_risk','Nine foundation actions are now grouped into legal/rights, catalog/distribution, and finance/administration milestones. The structure is ready, but founder, legal, accounting, and provider decisions remain unresolved.','ransomed');
  end if;
end
$migration$;

insert into public.atlas_documents(
  id,title,content,context_type,context_id,icon,color,status,created_by,updated_by
)
values
  ('portfolio-operating-map-2026','2026 Atlas Portfolio Operating Map',
   '# 2026 Atlas Portfolio\n\n## Personal operating system\n- ATLAS-364 — Supabase security hardening\n- ATLAS-88 — Jarvis performance review\n- ATLAS-382 / ATLAS-185 / ATLAS-386 / ATLAS-192 — Four-Lane anchors\n\n## Life and family\n- ATLAS-300 — SoulSisters form\n- ATLAS-200 / ATLAS-202 — care bookings\n- ATLAS-203 / ATLAS-204 / ATLAS-198 — Nigeria travel and documents\n- ATLAS-199 / ATLAS-339 — celebrations and gifts\n\n## Ventures\n- ATLAS-387 / ATLAS-396 — Asa beta decisions\n- ATLAS-138 / ATLAS-248 / ATLAS-258 — Riddim legal and rights\n- ATLAS-189 / ATLAS-254 / ATLAS-259 — Riddim catalog and distribution\n- ATLAS-255 / ATLAS-260 / ATLAS-139 — Riddim finance and administration\n- ATLAS-366 — 2027 grants\n- ATLAS-222 — Manna House readiness\n\n## Wealth and assets\n- ATLAS-481 / ATLAS-478 / ATLAS-479 — investment strategy\n- ATLAS-483 — California tax reconciliation\n- ATLAS-221 — property care\n\nStandalone by design: ATLAS-23 and ATLAS-308. They do not justify portfolio projects yet.',
   'workspace',null,'map','#3b82f6','active','ransomed','ransomed'),
  ('portfolio-doc-asa-beta','Asa Beta Decision Map',
   '# Asa Beta Decision Map\n\n## Commercial model\nATLAS-387 covers vertical, pricing posture, creator defaults, guarantee recoupment, and institutional riders.\n\n## Acquisition readiness\nATLAS-396 covers the first organic channels, qualifier fields, nurture, and the approved capture path.\n\nNo outreach, pricing publication, paid spend, or deployment is authorized by this document.',
   'project','portfolio-asa-beta','file-text','#8b5cf6','active','ransomed','ransomed'),
  ('portfolio-doc-nigeria','Nigeria Travel & Documents Map',
   '# Nigeria Travel & Documents\n\n1. Resolve traveler count, dates, and preferred itinerary in ATLAS-203.\n2. Prepare verified F6A application inputs for Nicole and Yanmi in ATLAS-204; stop before payment or submission.\n3. Coordinate the post-passport Nicole/Yanmi document run in ATLAS-198.\n\nBookings, official submissions, identity changes, and payments remain exact owner gates.',
   'project','portfolio-nigeria-travel-docs','file-text','#f59e0b','active','ransomed','ransomed'),
  ('portfolio-doc-riddim-label','Riddim Exchange Label Foundation Map',
   '# Label Foundation\n\n## Legal & rights\nATLAS-138, ATLAS-248, and ATLAS-258.\n\n## Catalog & distribution\nATLAS-189, ATLAS-254, and ATLAS-259.\n\n## Finance & administration\nATLAS-255, ATLAS-260, and ATLAS-139.\n\nNo registration, filing, provider account, payment, contract use, or external outreach is authorized by this operating map.',
   'project','portfolio-riddim-label','file-text','#ef4444','active','ransomed','ransomed'),
  ('portfolio-doc-wealth-strategy','Family Investment Strategy Map',
   '# Family Investment Strategy\n\nATLAS-481 compares entity structures and professional gates.\nATLAS-478 covers angel-investor readiness and safeguards.\nATLAS-197 covers the bounded NGX market and broker-custody decision path.\nATLAS-479 evaluates the passive-income stack after Wealth OS source readiness.\n\nThis is a research and decision surface only. It authorizes no account opening, trade, transfer, investment commitment, tax election, or entity filing.',
   'project','portfolio-wealth-strategy','file-text','#14b8a6','active','ransomed','ransomed')
on conflict(id) do nothing;

insert into public.atlas_insights(
  id,name,description,measure,slice_by,segment_by,chart_type,filters,time_grouping,
  include_archived,exclude_no_priority,scope,owner_id,status,created_by,updated_by
)
values
  ('portfolio-insight-active-project','Active work by project','Current nonterminal action load across outcome projects.','issue_count','project','priority','bar','{"status":["not_started","in_progress","waiting","blocked","todo","open"]}','monthly',false,false,'workspace','ransomed','active','ransomed','ransomed'),
  ('portfolio-insight-effort-business','Active effort by business','Estimated and configured-unestimated effort across active businesses.','effort','business','priority','bar','{"status":["not_started","in_progress","waiting","blocked","todo","open"]}','monthly',false,false,'workspace','ransomed','active','ransomed','ransomed'),
  ('portfolio-insight-work-age','Open work age by project','Age of current nonterminal work, preserving unknown lifecycle history.','issue_age','project','status','table','{"status":["not_started","in_progress","waiting","blocked","todo","open"]}','monthly',false,false,'workspace','ransomed','active','ransomed','ransomed'),
  ('portfolio-insight-cycle-load','Active cycle load','Effort in the current execution cycle.','effort','cycle','status','bar','{"cycle":"Portfolio Cycle 1","status":["not_started","in_progress","waiting","blocked","todo","open"]}','weekly',false,false,'workspace','ransomed','active','ransomed','ransomed')
on conflict(id) do nothing;

insert into public.atlas_dashboards(
  id,name,description,scope,owner_id,filters,status,created_by,updated_by
)
values('portfolio-command-dashboard','Portfolio Command Dashboard','Project load, effort, age, and active-cycle capacity for the current Atlas portfolio.','workspace','ransomed','{}','active','ransomed','ransomed')
on conflict(id) do nothing;

insert into public.atlas_dashboard_insights(
  id,dashboard_id,insight_id,display_type,position,width,height,filters,status,created_by,updated_by
)
values
  ('portfolio-card-active-project','portfolio-command-dashboard','portfolio-insight-active-project','chart',0,2,2,'{}','active','ransomed','ransomed'),
  ('portfolio-card-effort-business','portfolio-command-dashboard','portfolio-insight-effort-business','chart',1,2,2,'{}','active','ransomed','ransomed'),
  ('portfolio-card-work-age','portfolio-command-dashboard','portfolio-insight-work-age','table',2,4,2,'{}','active','ransomed','ransomed'),
  ('portfolio-card-cycle-load','portfolio-command-dashboard','portfolio-insight-cycle-load','metric',3,2,1,'{}','active','ransomed','ransomed')
on conflict(id) do nothing;

-- Fail the migration on unintended source-action semantic drift.
do $migration$
begin
  if exists(
    select 1
    from atlas_portfolio_semantic_before before
    join public.atlas_actions after on after.id=before.id
    where before.id not in('c9a40e09-a3d9-4ee3-8050-58328ef5b6cb','9d45ade8-3383-4855-8382-d4b837a6bab3')
      and (after.status,after.priority,after.owners,after.due_date,after.approval_state,
           after.work_mode,after.evidence_json,after.completed_at,after.resolution)
          is distinct from
          (before.status,before.priority,before.owners,before.due_date,before.approval_state,
           before.work_mode,before.evidence_json,before.completed_at,before.resolution)
  ) then
    raise exception using errcode='55000',message='ATLAS_PORTFOLIO_SOURCE_SEMANTIC_DRIFT';
  end if;
  if exists(
    select 1 from public.atlas_actions action
    join atlas_portfolio_semantic_before before on before.id=action.id
    where action.id in('c9a40e09-a3d9-4ee3-8050-58328ef5b6cb','9d45ade8-3383-4855-8382-d4b837a6bab3')
      and (action.status<>'in_progress' or action.resolution is not null or action.completed_at is not null
        or (action.priority,action.owners,action.due_date,action.approval_state,action.work_mode,action.evidence_json)
           is distinct from
           (before.priority,before.owners,before.due_date,before.approval_state,before.work_mode,before.evidence_json))
  ) then
    raise exception using errcode='55000',message='ATLAS_PORTFOLIO_STANDING_ANCHOR_DRIFT';
  end if;
end
$migration$;
