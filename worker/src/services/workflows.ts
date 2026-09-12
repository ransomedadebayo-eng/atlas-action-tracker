import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateWorkflowRules, type WorkflowAction } from '../utils/workflowRules';

type Row = Record<string, any>;

export async function loadWorkflowForBusiness(supabase: SupabaseClient, business: string | null | undefined) {
  let query = supabase.from('atlas_workflows').select('*').is('archived_at', null);
  query = business ? query.eq('business', business) : query.is('business', null);
  let { data: workflow, error } = await query.maybeSingle();
  if (error) throw error;
  if (!workflow && business) {
    const fallback = await supabase.from('atlas_workflows').select('*').is('business', null).is('archived_at', null).maybeSingle();
    if (fallback.error) throw fallback.error;
    workflow = fallback.data;
  }
  return workflow as Row | null;
}

export async function hydrateWorkflow(supabase: SupabaseClient, workflow: Row) {
  const [statuses, settings, rules, ruleRuns, triageCount] = await Promise.all([
    supabase.from('atlas_workflow_statuses').select('*').eq('workflow_id', workflow.id).is('archived_at', null).order('position'),
    supabase.from('atlas_triage_settings').select('*').eq('workflow_id', workflow.id).maybeSingle(),
    supabase.from('atlas_workflow_rules').select('*').eq('workflow_id', workflow.id).is('archived_at', null).order('position'),
    supabase.from('atlas_workflow_rule_runs').select('*').eq('workflow_id', workflow.id).order('created_at', { ascending: false }).limit(20),
    supabase.from('atlas_triage_entries').select('id', { count: 'exact', head: true }).eq('workflow_id', workflow.id).eq('state', 'pending'),
  ]);
  for (const result of [statuses, settings, rules, ruleRuns, triageCount]) {
    if (result.error) throw result.error;
  }
  return {
    ...workflow,
    statuses: statuses.data || [],
    triage_settings: settings.data || null,
    rules: rules.data || [],
    recent_rule_runs: ruleRuns.data || [],
    pending_triage_count: triageCount.count || 0,
  };
}

export async function loadWorkflowAction(supabase: SupabaseClient, actionId: string) {
  const { data: action, error } = await supabase
    .from('atlas_actions')
    .select('*,workflow_status:atlas_workflow_statuses!workflow_status_id(id,workflow_id,status_key,name,description,color,category,position,is_default,is_system)')
    .eq('id', actionId)
    .single();
  if (error) throw error;
  return action as WorkflowAction;
}

export async function executeWorkflowRules(
  supabase: SupabaseClient,
  action: WorkflowAction,
  triggerType: string,
  actor: string,
  eventKey: string,
  dryRun = false,
) {
  const workflow = await loadWorkflowForBusiness(supabase, typeof action.business === 'string' ? action.business : null);
  if (!workflow) return null;
  const { data: rules, error } = await supabase
    .from('atlas_workflow_rules')
    .select('*')
    .eq('workflow_id', workflow.id)
    .eq('trigger_type', triggerType)
    .eq('enabled', true)
    .is('archived_at', null)
    .order('position');
  if (error) throw error;
  const evaluation = evaluateWorkflowRules(action, (rules || []) as any[], triggerType);
  const { data, error: rpcError } = await supabase.rpc('record_atlas_workflow_rule_run', {
    p_workflow_id: workflow.id,
    p_action_id: String(action.id),
    p_event_key: eventKey,
    p_trigger_type: triggerType,
    p_matched_rule_ids: evaluation.matched_rule_ids,
    p_proposed_effects: evaluation.proposed_effects,
    p_conflicts: evaluation.conflicts,
    p_actor: actor,
    p_dry_run: dryRun,
  });
  if (rpcError) throw rpcError;
  return data;
}

export function inactivityCandidates(actions: Row[], settings: Row, asOf = new Date()) {
  const closeCutoff = settings.auto_close_days
    ? new Date(asOf.getTime() - Number(settings.auto_close_days) * 86_400_000)
    : null;
  const archiveCutoff = settings.auto_archive_days
    ? new Date(asOf.getTime() - Number(settings.auto_archive_days) * 86_400_000)
    : null;
  const closeCategories = new Set(Array.isArray(settings.auto_close_categories) ? settings.auto_close_categories : []);
  const close: string[] = [];
  const archive: string[] = [];
  const skipped: Array<{ action_id: string; reason: string }> = [];

  for (const action of actions) {
    const updatedAt = new Date(action.updated_at);
    const category = action.workflow_status?.category;
    if (action.status === 'archived') continue;
    if (archiveCutoff && ['completed', 'canceled', 'duplicate'].includes(category) && updatedAt <= archiveCutoff) {
      archive.push(action.id);
      continue;
    }
    if (!closeCutoff || !closeCategories.has(category) || updatedAt > closeCutoff) continue;
    if (['needs_review', 'deferred'].includes(action.approval_state) || action.work_mode === 'user_only') {
      skipped.push({ action_id: action.id, reason: 'owner_obligation' });
      continue;
    }
    close.push(action.id);
  }
  return { close, archive, skipped };
}
