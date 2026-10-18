-- READ ONLY. Re-run immediately before the separately approved migration.
select table_name,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text::int as n
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
  and table_name ~ '^atlas_(release|template|insight|dashboard|analytics|export_receipts|cycle|initiative|workflow|triage|inactivity_policy|hierarchy_automation)'
order by 1;

select 'actions' as entity, count(*) filter(where template_id is not null or template_instance_id is not null) as template_references from public.atlas_actions
union all select 'projects',count(*) filter(where template_id is not null or template_instance_id is not null) from public.atlas_projects
union all select 'documents',count(*) filter(where template_id is not null or template_instance_id is not null) from public.atlas_documents;
select context_type,id,context_id from public.atlas_documents where context_type in ('cycle','initiative') order by id;
select id,entity_type,archived_at,context_initiative_id from public.atlas_saved_views where entity_type='initiative' or context_initiative_id is not null;
select count(*) as subscriptions_with_initiative from public.atlas_integration_subscriptions where initiative_id is not null;
select id,status from public.atlas_projects where id='project-familyos-operations';
select status,count(*) from public.atlas_actions group by 1 order by 1;
select proname,count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname=any(array['apply_atlas_inactivity_action','archive_atlas_workflow_status','assign_atlas_action_to_cycle','atlas_apply_hierarchy_completion_policy','atlas_audit_analytics_row','atlas_audit_cycle_row','atlas_audit_cycle_schedule_row','atlas_audit_initiative_child_row','atlas_audit_initiative_row','atlas_audit_release_row','atlas_audit_template_row','atlas_auto_add_action_to_cycle','atlas_capture_action_cycle_change','atlas_capture_cycle_scope','atlas_manage_initiative_row','atlas_protect_completed_cycle_snapshot','atlas_sync_action_workflow_status','atlas_unsnooze_triage_on_action_activity','atlas_unsnooze_triage_on_comment','atlas_validate_initiative_resource_target','atlas_validate_template_row','atlas_validate_triage_settings','atlas_validate_workflow_status_definition','complete_atlas_cycle','configure_atlas_cycle_schedule','configure_atlas_workflow_status','create_atlas_release','disable_atlas_cycle_schedule','duplicate_atlas_template','enter_atlas_triage_action','generate_atlas_release_notes','ingest_atlas_release_event','instantiate_atlas_template','move_atlas_initiative_order','post_atlas_initiative_update','record_atlas_export_receipt','record_atlas_insight_snapshot','record_atlas_workflow_rule_run','remove_atlas_action_from_cycle','reorder_atlas_workflow_statuses','restore_atlas_release','rotate_atlas_release_access_key','set_atlas_initiative_parent','set_atlas_initiative_project','set_atlas_release_action','start_atlas_cycle_today','transition_atlas_analytics_entity','transition_atlas_initiative','transition_atlas_release','transition_atlas_release_stage','transition_atlas_template','transition_atlas_triage_action','upsert_atlas_initiative_resource']) group by 1 order by 1;
