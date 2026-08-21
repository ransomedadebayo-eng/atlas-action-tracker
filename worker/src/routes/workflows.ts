import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, getDb } from '../db';
import { getActor } from '../utils/actors';
import { apiError } from '../utils/http';
import { validateKnownBusinessId, validateKnownMemberIds } from '../utils/referenceData';
import { evaluateWorkflowRules, validateWorkflowRuleInput } from '../utils/workflowRules';
import {
  executeWorkflowRules,
  hydrateWorkflow,
  inactivityCandidates,
  loadWorkflowAction,
  loadWorkflowForBusiness,
} from '../services/workflows';

type Row = Record<string, any>;
const workflowRouter = new Hono<{ Bindings: Env }>();
const triageRouter = new Hono<{ Bindings: Env }>();
const CATEGORIES = new Set(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']);
const TRIGGERS = new Set(['triage_entered', 'action_created', 'action_updated', 'status_changed', 'priority_changed', 'manual']);

function expectedRevision(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
}

function legacyStatus(category: string, requested: unknown) {
  const allowed: Record<string, string[]> = {
    triage: ['open'],
    backlog: ['not_started', 'todo'],
    unstarted: ['not_started', 'todo'],
    started: ['in_progress', 'waiting', 'blocked'],
    completed: ['done', 'completed', 'closed'],
    canceled: ['canceled', 'cancelled'],
  };
  const fallback: Record<string, string> = {
    triage: 'open', backlog: 'not_started', unstarted: 'not_started',
    started: 'in_progress', completed: 'done', canceled: 'canceled',
  };
  const value = typeof requested === 'string' ? requested : '';
  return allowed[category]?.includes(value) ? value : fallback[category];
}

function mutationError(c: any, error: any, fallback: string) {
  const message = String(error?.message || '');
  if (error?.code === '40001' || message.includes('REVISION_CONFLICT')) return apiError(c, 409, 'REVISION_CONFLICT', 'The workflow changed since it was loaded. Refresh and retry.');
  if (error?.code === 'P0002' || message.includes('NOT_FOUND')) return apiError(c, 404, 'WORKFLOW_NOT_FOUND', 'The requested workflow resource was not found.');
  if (error?.code === '55000') return apiError(c, 409, 'WORKFLOW_STATE_CONFLICT', message || fallback);
  if (['22023', '23503', '23505', '23514'].includes(String(error?.code))) return apiError(c, 400, 'WORKFLOW_VALIDATION_FAILED', message || fallback);
  console.error(`[workflows] ${fallback}: ${message || error}`);
  return apiError(c, 500, 'WORKFLOW_OPERATION_FAILED', fallback);
}

workflowRouter.get('/', async c => {
  try {
    const supabase = getDb(c.env);
    const business = c.req.query('business');
    if (business !== undefined) {
      const workflow = await loadWorkflowForBusiness(supabase, business || null);
      return c.json({ workflow: workflow ? await hydrateWorkflow(supabase, workflow) : null });
    }
    const { data, error } = await supabase.from('atlas_workflows').select('*').is('archived_at', null).order('business');
    if (error) throw error;
    return c.json({ workflows: await Promise.all((data || []).map(item => hydrateWorkflow(supabase, item))) });
  } catch (error) {
    return mutationError(c, error, 'Unable to load workflows.');
  }
});

workflowRouter.get('/:id', async c => {
  try {
    const supabase = getDb(c.env);
    const { data, error } = await supabase.from('atlas_workflows').select('*').eq('id', c.req.param('id')).is('archived_at', null).single();
    if (error) throw error;
    return c.json(await hydrateWorkflow(supabase, data));
  } catch (error) {
    return mutationError(c, error, 'Unable to load the workflow.');
  }
});

workflowRouter.post('/', async c => {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json() as Row;
    const business = body.business || null;
    const businessError = await validateKnownBusinessId(supabase, business);
    if (businessError) return apiError(c, 400, 'BUSINESS_INVALID', businessError);
    const name = String(body.name || '').trim();
    if (!name || name.length > 120) return apiError(c, 400, 'WORKFLOW_NAME_INVALID', 'Name must be 1-120 characters.');
    const actor = getActor(c);
    const { data, error } = await supabase.from('atlas_workflows').insert({
      business, name, description: String(body.description || ''), created_by: actor, updated_by: actor,
    }).select().single();
    if (error) throw error;
    return c.json(await hydrateWorkflow(supabase, data), 201);
  } catch (error) {
    return mutationError(c, error, 'Unable to create the workflow.');
  }
});

workflowRouter.put('/:id', async c => {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json<Row>();
    const updates: Row = { updated_by: getActor(c), updated_at: new Date().toISOString() };
    if (body.name !== undefined) updates.name = String(body.name).trim();
    if (body.description !== undefined) updates.description = String(body.description);
    if (body.parent_auto_close !== undefined) updates.parent_auto_close = Boolean(body.parent_auto_close);
    if (body.sub_action_auto_close !== undefined) updates.sub_action_auto_close = Boolean(body.sub_action_auto_close);
    if (!updates.name && body.name !== undefined) return apiError(c, 400, 'WORKFLOW_NAME_INVALID', 'Name is required.');
    let query = supabase.from('atlas_workflows').update({ ...updates, revision: Number(body.expected_revision || 0) + 1 }).eq('id', c.req.param('id')).is('archived_at', null);
    if (body.expected_revision !== undefined) query = query.eq('revision', expectedRevision(body.expected_revision));
    const { data, error } = await query.select().maybeSingle();
    if (error) throw error;
    if (!data) return apiError(c, 409, 'REVISION_CONFLICT', 'The workflow changed since it was loaded.');
    return c.json(await hydrateWorkflow(supabase, data));
  } catch (error) {
    return mutationError(c, error, 'Unable to update the workflow.');
  }
});

workflowRouter.post('/:id/statuses', async c => configureStatus(c, null));
workflowRouter.put('/:id/statuses/:statusId', async c => configureStatus(c, c.req.param('statusId')));

async function configureStatus(c: any, statusId: string | null) {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json() as Row;
    const category = String(body.category || '');
    const name = String(body.name || '').trim();
    if (!CATEGORIES.has(category) || !name || name.length > 80) {
      return apiError(c, 400, 'WORKFLOW_STATUS_INVALID', 'A valid category and 1-80 character name are required.');
    }
    const statusKey = String(body.status_key || slug(name));
    const { data, error } = await supabase.rpc('configure_atlas_workflow_status', {
      p_workflow_id: c.req.param('id'),
      p_status_id: statusId,
      p_status_key: statusKey,
      p_name: name,
      p_description: String(body.description || ''),
      p_color: String(body.color || '#71717a'),
      p_category: category,
      p_legacy_status: legacyStatus(category, body.legacy_status),
      p_position: Number.isSafeInteger(body.position) ? body.position : 0,
      p_is_default: Boolean(body.is_default),
      p_actor: getActor(c),
      p_expected_revision: expectedRevision(body.expected_revision),
    });
    if (error) throw error;
    return c.json(data, statusId ? 200 : 201);
  } catch (error) {
    return mutationError(c, error, 'Unable to save the workflow status.');
  }
}

workflowRouter.post('/:id/statuses/:statusId/archive', async c => {
  try {
    const body = await c.req.json<Row>();
    const { data, error } = await getDb(c.env).rpc('archive_atlas_workflow_status', {
      p_status_id: c.req.param('statusId'),
      p_replacement_status_id: body.replacement_status_id || null,
      p_actor: getActor(c),
      p_expected_revision: expectedRevision(body.expected_revision),
    });
    if (error) throw error;
    return c.json(data);
  } catch (error) {
    return mutationError(c, error, 'Unable to archive the workflow status.');
  }
});

workflowRouter.post('/:id/statuses/reorder', async c => {
  try {
    const body = await c.req.json<Row>();
    if (!Array.isArray(body.status_ids) || body.status_ids.some((id: unknown) => typeof id !== 'string')) {
      return apiError(c, 400, 'WORKFLOW_STATUS_ORDER_INVALID', 'status_ids must be an array of status ids.');
    }
    const { data, error } = await getDb(c.env).rpc('reorder_atlas_workflow_statuses', {
      p_workflow_id: c.req.param('id'), p_status_ids: body.status_ids, p_actor: getActor(c),
    });
    if (error) throw error;
    return c.json(data);
  } catch (error) {
    return mutationError(c, error, 'Unable to reorder workflow statuses.');
  }
});

workflowRouter.put('/:id/triage-settings', async c => {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json<Row>();
    const members = Array.isArray(body.responsible_member_ids) ? body.responsible_member_ids : [];
    const memberErrors = await validateKnownMemberIds(supabase, members, 'responsible_member_ids');
    if (memberErrors.length) return apiError(c, 400, 'TRIAGE_RESPONSIBILITY_INVALID', memberErrors.join('; '));
    const actor = getActor(c);
    const row = {
      workflow_id: c.req.param('id'), enabled: Boolean(body.enabled),
      require_priority: Boolean(body.require_priority), responsible_member_ids: members,
      default_accept_status_id: body.default_accept_status_id || null,
      auto_close_days: body.auto_close_days === null || body.auto_close_days === '' ? null : Number(body.auto_close_days),
      auto_archive_days: body.auto_archive_days === null || body.auto_archive_days === '' ? null : Number(body.auto_archive_days),
      auto_close_categories: Array.isArray(body.auto_close_categories) ? body.auto_close_categories : ['backlog', 'unstarted'],
      revision: Number(body.expected_revision || 0) + 1, updated_by: actor, updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('atlas_triage_settings').upsert(row, { onConflict: 'workflow_id' }).select().single();
    if (error) throw error;
    await supabase.from('atlas_workflow_activity_log').insert({
      workflow_id: row.workflow_id, entity_type: 'triage_setting', entity_id: row.workflow_id,
      event: 'configured', new_value: data, actor,
    });
    return c.json(data);
  } catch (error) {
    return mutationError(c, error, 'Unable to update Triage settings.');
  }
});

workflowRouter.post('/:id/rules', async c => {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json<Row>();
    const errors = validateWorkflowRuleInput(body);
    if (errors.length) return apiError(c, 400, 'WORKFLOW_RULE_INVALID', errors.join('; '));
    const actor = getActor(c);
    const { data, error } = await supabase.from('atlas_workflow_rules').insert({
      workflow_id: c.req.param('id'), name: body.name.trim(), description: String(body.description || ''),
      trigger_type: body.trigger_type, conditions: body.conditions, effects: body.effects,
      position: Number.isSafeInteger(body.position) ? body.position : 0,
      enabled: false, created_by: actor, updated_by: actor,
    }).select().single();
    if (error) throw error;
    return c.json(data, 201);
  } catch (error) {
    return mutationError(c, error, 'Unable to create the workflow rule.');
  }
});

workflowRouter.put('/:id/rules/:ruleId', async c => {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json<Row>();
    const errors = validateWorkflowRuleInput(body);
    if (errors.length) return apiError(c, 400, 'WORKFLOW_RULE_INVALID', errors.join('; '));
    const { data: existing, error: loadError } = await supabase.from('atlas_workflow_rules').select('*').eq('id', c.req.param('ruleId')).eq('workflow_id', c.req.param('id')).single();
    if (loadError) throw loadError;
    if (existing.enabled) return apiError(c, 409, 'WORKFLOW_RULE_ACTIVE', 'Deactivate the rule before editing it.');
    if (body.expected_revision !== undefined && existing.revision !== expectedRevision(body.expected_revision)) return apiError(c, 409, 'REVISION_CONFLICT', 'The rule changed since it was loaded.');
    const { data, error } = await supabase.from('atlas_workflow_rules').update({
      name: body.name.trim(), description: String(body.description || ''), trigger_type: body.trigger_type,
      conditions: body.conditions, effects: body.effects,
      position: Number.isSafeInteger(body.position) ? body.position : existing.position,
      revision: existing.revision + 1, updated_by: getActor(c), updated_at: new Date().toISOString(),
    }).eq('id', existing.id).select().single();
    if (error) throw error;
    return c.json(data);
  } catch (error) {
    return mutationError(c, error, 'Unable to update the workflow rule.');
  }
});

for (const enabled of [true, false]) {
  const action = enabled ? 'activate' : 'deactivate';
  workflowRouter.post(`/:id/rules/:ruleId/${action}`, async c => {
    try {
      const supabase = getDb(c.env);
      const body = await c.req.json().catch(() => ({})) as Row;
      const { data: existing, error: loadError } = await supabase.from('atlas_workflow_rules').select('*').eq('id', c.req.param('ruleId')).eq('workflow_id', c.req.param('id')).single();
      if (loadError) throw loadError;
      if (body.expected_revision !== undefined && existing.revision !== expectedRevision(body.expected_revision)) return apiError(c, 409, 'REVISION_CONFLICT', 'The rule changed since it was loaded.');
      const actor = getActor(c);
      const { data, error } = await supabase.from('atlas_workflow_rules').update({
        enabled, activated_by: enabled ? actor : null, activated_at: enabled ? new Date().toISOString() : null,
        revision: existing.revision + 1, updated_by: actor, updated_at: new Date().toISOString(),
      }).eq('id', existing.id).select().single();
      if (error) throw error;
      return c.json(data);
    } catch (error) {
      return mutationError(c, error, `Unable to ${action} the workflow rule.`);
    }
  });
}

workflowRouter.post('/:id/rules/:ruleId/archive', async c => {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json().catch(() => ({})) as Row;
    const { data: existing, error: loadError } = await supabase.from('atlas_workflow_rules').select('*').eq('id', c.req.param('ruleId')).eq('workflow_id', c.req.param('id')).single();
    if (loadError) throw loadError;
    if (body.expected_revision !== undefined && existing.revision !== expectedRevision(body.expected_revision)) return apiError(c, 409, 'REVISION_CONFLICT', 'The rule changed since it was loaded.');
    const { data, error } = await supabase.from('atlas_workflow_rules').update({
      enabled: false, activated_by: null, activated_at: null, archived_at: new Date().toISOString(),
      revision: existing.revision + 1, updated_by: getActor(c), updated_at: new Date().toISOString(),
    }).eq('id', existing.id).select().single();
    if (error) throw error;
    return c.json(data);
  } catch (error) {
    return mutationError(c, error, 'Unable to archive the workflow rule.');
  }
});

workflowRouter.post('/:id/rules/:ruleId/preview', async c => {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json<Row>();
    if (!body.action_id) return apiError(c, 400, 'WORKFLOW_PREVIEW_ACTION_REQUIRED', 'action_id is required.');
    const { data: rule, error: ruleError } = await supabase.from('atlas_workflow_rules').select('*').eq('id', c.req.param('ruleId')).eq('workflow_id', c.req.param('id')).is('archived_at', null).single();
    if (ruleError) throw ruleError;
    const action = await loadWorkflowAction(supabase, String(body.action_id));
    const evaluation = evaluateWorkflowRules(action, [{ ...rule, enabled: true }], rule.trigger_type);
    const { data, error } = await supabase.rpc('record_atlas_workflow_rule_run', {
      p_workflow_id: c.req.param('id'), p_action_id: String(action.id),
      p_event_key: String(body.event_key || `rule-preview:${rule.id}:${action.id}:${uuidv4()}`),
      p_trigger_type: rule.trigger_type, p_matched_rule_ids: evaluation.matched_rule_ids,
      p_proposed_effects: evaluation.proposed_effects, p_conflicts: evaluation.conflicts,
      p_actor: getActor(c), p_dry_run: true,
    });
    if (error) throw error;
    return c.json(data);
  } catch (error) {
    return mutationError(c, error, 'Unable to preview the workflow rule.');
  }
});

workflowRouter.post('/:id/evaluate', async c => {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json<Row>();
    const triggerType = String(body.trigger_type || 'manual');
    if (!TRIGGERS.has(triggerType) || !body.action_id) return apiError(c, 400, 'WORKFLOW_EVALUATION_INVALID', 'action_id and a valid trigger_type are required.');
    const action = await loadWorkflowAction(supabase, String(body.action_id));
    const eventKey = String(body.event_key || `${body.apply ? 'manual-apply' : 'manual-preview'}:${action.id}:${uuidv4()}`);
    const result = await executeWorkflowRules(supabase, action, triggerType, getActor(c), eventKey, !body.apply);
    return c.json(result || { run: null, action });
  } catch (error) {
    return mutationError(c, error, 'Unable to evaluate workflow rules.');
  }
});

async function evaluateInactivity(c: any, apply: boolean) {
  try {
    const supabase = getDb(c.env);
    const workflowId = c.req.param('id');
    const body = await c.req.json().catch(() => ({})) as Row;
    const { data: workflow, error: workflowError } = await supabase.from('atlas_workflows').select('*').eq('id', workflowId).is('archived_at', null).single();
    if (workflowError) throw workflowError;
    const { data: settings, error: settingsError } = await supabase.from('atlas_triage_settings').select('*').eq('workflow_id', workflowId).single();
    if (settingsError) throw settingsError;
    let query = supabase.from('atlas_actions').select('*,workflow_status:atlas_workflow_statuses!workflow_status_id(id,workflow_id,category,name,color)').neq('status', 'archived').limit(2000);
    query = workflow.business ? query.eq('business', workflow.business) : query.is('business', null);
    const { data: actions, error: actionError } = await query;
    if (actionError) throw actionError;
    const asOf = body.as_of ? new Date(String(body.as_of)) : new Date();
    if (Number.isNaN(asOf.getTime())) return apiError(c, 400, 'INACTIVITY_AS_OF_INVALID', 'as_of must be an ISO timestamp.');
    const candidates = inactivityCandidates(actions || [], settings, asOf);
    const runKey = String(body.run_key || `${apply ? 'apply' : 'preview'}:${workflowId}:${asOf.toISOString()}:${uuidv4()}`);
    if (apply) {
      const existing = await supabase.from('atlas_inactivity_policy_runs').select('*').eq('run_key', runKey).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) return c.json(existing.data);
    }
    const closed: string[] = [];
    const archived: string[] = [];
    const skipped = [...candidates.skipped];
    if (apply) {
      for (const [mode, ids] of [['close', candidates.close], ['archive', candidates.archive]] as const) {
        for (const actionId of ids) {
          const { error } = await supabase.rpc('apply_atlas_inactivity_action', {
            p_workflow_id: workflowId, p_action_id: actionId, p_mode: mode,
            p_as_of: asOf.toISOString(), p_run_key: runKey, p_actor: getActor(c),
          });
          if (error) skipped.push({ action_id: actionId, reason: error.message || 'apply_failed' });
          else (mode === 'close' ? closed : archived).push(actionId);
        }
      }
    }
    const receipt = {
      workflow_id: workflowId, run_key: runKey, dry_run: !apply, as_of: asOf.toISOString(),
      candidate_action_ids: [...candidates.close, ...candidates.archive],
      closed_action_ids: closed, archived_action_ids: archived, skipped, actor: getActor(c),
    };
    const { data, error } = await supabase.from('atlas_inactivity_policy_runs').insert(receipt).select().single();
    if (error) throw error;
    return c.json({ ...data, candidates });
  } catch (error) {
    return mutationError(c, error, 'Unable to evaluate inactivity policy.');
  }
}

workflowRouter.post('/:id/inactivity/preview', c => evaluateInactivity(c, false));
workflowRouter.post('/:id/inactivity/apply', c => evaluateInactivity(c, true));

triageRouter.get('/', async c => {
  try {
    const supabase = getDb(c.env);
    const workflow = await loadWorkflowForBusiness(supabase, c.req.query('business') || null);
    if (!workflow) return c.json({ workflow: null, entries: [] });
    const includeSnoozed = c.req.query('include_snoozed') === 'true';
    let query = supabase.from('atlas_triage_entries')
      .select('*,action:atlas_actions!action_id(*,workflow_status:atlas_workflow_statuses!workflow_status_id(id,name,color,category,status_key))')
      .eq('workflow_id', workflow.id).order('created_at');
    query = includeSnoozed ? query.in('state', ['pending', 'snoozed']) : query.eq('state', 'pending');
    const { data, error } = await query;
    if (error) throw error;
    return c.json({ workflow: await hydrateWorkflow(supabase, workflow), entries: data || [] });
  } catch (error) {
    return mutationError(c, error, 'Unable to load Triage.');
  }
});

triageRouter.post('/:actionId/enter', async c => {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json().catch(() => ({})) as Row;
    const actor = getActor(c);
    const { data, error } = await supabase.rpc('enter_atlas_triage_action', {
      p_action_id: c.req.param('actionId'), p_source_type: body.source_type || 'manual',
      p_source_ref: body.source_ref || null, p_actor: actor,
    });
    if (error) throw error;
    const action = await loadWorkflowAction(supabase, c.req.param('actionId'));
    const automation = await executeWorkflowRules(supabase, action, 'triage_entered', actor, `triage-entered:${action.id}:${data.entry.revision}`, false);
    return c.json({ ...data, automation });
  } catch (error) {
    return mutationError(c, error, 'Unable to enter Triage.');
  }
});

for (const decision of ['accept', 'decline', 'duplicate', 'snooze']) {
  triageRouter.post(`/:actionId/${decision}`, async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as Row;
      const { data, error } = await getDb(c.env).rpc('transition_atlas_triage_action', {
        p_action_id: c.req.param('actionId'), p_decision: decision, p_actor: getActor(c),
        p_target_status_id: body.target_status_id || null, p_reason: body.reason || '',
        p_snoozed_until: body.snoozed_until || null, p_canonical_action_id: body.canonical_action_id || null,
        p_expected_revision: expectedRevision(body.expected_revision),
      });
      if (error) throw error;
      return c.json(data);
    } catch (error) {
      return mutationError(c, error, `Unable to ${decision} the Triage action.`);
    }
  });
}

export { workflowRouter, triageRouter };
