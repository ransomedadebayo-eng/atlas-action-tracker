import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, getDb } from '../db';
import { validateStringLengths, sanitizeBody, parsePagination } from '../middleware/validate';
import { getActor, getAuthKind } from '../utils/actors';
import { hasRequestScope } from '../middleware/authorize';
import { validateActionFields, ACTION_TEXT_FIELDS, coerceActionBody } from '../utils/actionUtils';
import { serializeJsonArray, serializeJsonObject } from '../utils/json';
import { validateKnownBusinessId, validateKnownMemberIds } from '../utils/referenceData';
import { buildSafeIlikePattern } from '../utils/search';
import { buildCompletionEvidence } from '../utils/evidence';
import { apiError } from '../utils/http';
import { validateConfiguredEstimate } from '../utils/estimates';
import { executeWorkflowRules, loadWorkflowAction } from '../services/workflows';

const router = new Hono<{ Bindings: Env }>();
const BULK_MAX = 50;
const PRIORITY_ORDER: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };
const ACTIVE_STATUSES = ['not_started', 'in_progress', 'waiting', 'blocked', 'todo', 'open'];
const NON_BLOCKED_ACTIVE_STATUSES = ['not_started', 'in_progress', 'waiting', 'todo', 'open'];
const PROTOCOL_FIELDS = [
  'next_action',
  'definition_of_done',
  'review_date',
  'evidence_json',
  'agent_assignment_id',
  'approval_state',
];
const FILTERABLE_WORK_MODES = new Set(['autonomous', 'review_required', 'user_only']);
const EXPLICIT_TRANSITION_STATUSES = new Set(['done', 'archived']);
const ACTION_SELECT = '*,workflow_status:atlas_workflow_statuses!workflow_status_id(id,workflow_id,status_key,name,description,color,category,position,is_default,is_system)';

function parseExpectedRevision(value: unknown): { value: number | null; error: string | null } {
  if (value === undefined || value === null) return { value: null, error: null };
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return { value: null, error: 'expected_revision must be a non-negative integer.' };
  }
  return { value, error: null };
}

function rpcErrorResponse(c: Parameters<typeof apiError>[0], error: { code?: string; message?: string }, operation: string) {
  if (error.code === '40001' || error.message?.includes('ATLAS_REVISION_CONFLICT')) {
    return apiError(c, 409, 'REVISION_CONFLICT', 'The action changed since it was loaded. Refresh it and retry.');
  }
  if (error.code === 'P0002' || error.message?.includes('NOT_FOUND')) {
    return apiError(c, 404, 'ACTION_NOT_FOUND', 'Action not found.');
  }
  if (error.code === '42501' || error.message?.includes('OWNER_REQUIRED')) {
    return apiError(c, 403, 'OWNER_REQUIRED', 'Only the ATLAS owner can perform this operation.');
  }
  if (error.code === '55000' || error.message?.includes('ARCHIVED')) {
    return apiError(c, 409, 'ACTION_ARCHIVED', 'Restore the action before changing its structure.');
  }
  if (['22023', '23503', '23514'].includes(String(error.code))) {
    return apiError(c, 400, 'INVALID_ACTION_TRANSITION', error.message || `Unable to ${operation} the action.`);
  }
  console.error(`[actions] ${operation} RPC error: ${error.message || error.code || 'unknown error'}`);
  return apiError(c, 500, 'ACTION_TRANSITION_FAILED', `Unable to ${operation} the action.`);
}

export function includesAssignmentFields(body: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(body, 'owners')
    || Object.prototype.hasOwnProperty.call(body, 'agent_assignment_id');
}

function getAtlasLocalDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function withBusinessFilter(query: any, business?: string | null) {
  return business ? query.eq('business', business) : query;
}

async function countActions(
  supabase: ReturnType<typeof getDb>,
  business: string | null,
  buildQuery: (query: any) => any,
): Promise<number> {
  const base = supabase.from('atlas_actions').select('id', { count: 'exact', head: true });
  const query = buildQuery(withBusinessFilter(base, business));
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function loadAllRows(query: any): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const batchSize = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await query.range(offset, offset + batchSize - 1);
    if (error) throw error;
    const batch = (data || []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < batchSize) return rows;
    offset += batchSize;
  }
}

function sortByPriority(actions: Record<string, unknown>[], direction = 'ASC') {
  return actions.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority as string] ?? 3;
    const pb = PRIORITY_ORDER[b.priority as string] ?? 3;
    const cmp = pa - pb;
    if (cmp !== 0) return direction === 'DESC' ? -cmp : cmp;
    if (a.due_date === b.due_date) return 0;
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return (a.due_date as string) < (b.due_date as string) ? -1 : 1;
  });
}

function parseBulkPayload(body: unknown, key: string): unknown[] | undefined {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') return (body as Record<string, unknown>)[key] as unknown[];
  return undefined;
}

function applyProtocolFields(target: Record<string, unknown>, source: Record<string, unknown>) {
  if (source.next_action !== undefined) target.next_action = source.next_action || null;
  if (source.definition_of_done !== undefined) target.definition_of_done = source.definition_of_done || null;
  if (source.review_date !== undefined) target.review_date = source.review_date || null;
  if (source.evidence_json !== undefined) target.evidence_json = serializeJsonObject(source.evidence_json);
  if (source.agent_assignment_id !== undefined) target.agent_assignment_id = source.agent_assignment_id || null;
  if (source.approval_state !== undefined) target.approval_state = source.approval_state || 'not_required';
}

function isProtocolStale(action: Record<string, unknown>, today: string): boolean {
  const dueDate = typeof action.due_date === 'string' ? action.due_date : null;
  const isOverdue = !!dueDate && dueDate < today && action.status !== 'done';
  return (
    isOverdue ||
    !action.work_mode ||
    !action.next_action ||
    !action.definition_of_done ||
    (!dueDate && !action.review_date)
  );
}

function filterProtocolSpecialModes(query: any, workMode?: string) {
  if (!workMode) return query;
  const workModes = workMode.split(',').filter(mode => mode === '__null__' || FILTERABLE_WORK_MODES.has(mode));
  if (workModes.length === 0) return query;
  if (workModes.includes('__null__')) {
    const concrete = workModes.filter(mode => mode !== '__null__');
    if (concrete.length === 0) return query.is('work_mode', null);
    return query.or(`work_mode.is.null,work_mode.in.(${concrete.join(',')})`);
  }
  return query.in('work_mode', workModes);
}

async function validateActionReferences(supabase: ReturnType<typeof getDb>, action: Record<string, unknown>) {
  const errors: string[] = [];
  const businessError = await validateKnownBusinessId(supabase, action.business);
  if (businessError) errors.push(businessError);
  errors.push(...(await validateKnownMemberIds(supabase, action.owners)));
  const estimateError = await validateConfiguredEstimate(supabase, action.estimate_points);
  if (estimateError) errors.push(estimateError);
  return errors;
}

function isBlocked(action: Record<string, unknown>): boolean {
  const deps = action.blocked_by;
  if (!deps || !Array.isArray(deps)) return false;
  return deps.length > 0;
}

function annotateBlocked(actions: Record<string, unknown>[]): Record<string, unknown>[] {
  return actions.map(a => ({ ...a, is_blocked: isBlocked(a) }));
}

function estimateWeight(action: Record<string, unknown>, unestimatedValue = 1): number {
  return Number.isSafeInteger(action.estimate_points) ? Number(action.estimate_points) : unestimatedValue;
}

export function calculateActionChildProgress(actions: Record<string, unknown>[], unestimatedValue = 1) {
  const complete = new Set(['done', 'completed', 'closed']);
  const totalEffort = actions.reduce((sum, action) => sum + estimateWeight(action, unestimatedValue), 0);
  const completed = actions.filter(action => complete.has(String(action.status)));
  const completedEffort = completed.reduce((sum, action) => sum + estimateWeight(action, unestimatedValue), 0);
  return {
    total_children: actions.length,
    completed_children: completed.length,
    total_effort: totalEffort,
    completed_effort: completedEffort,
    progress_percent: totalEffort === 0 ? 0 : Math.round((completedEffort / totalEffort) * 100),
  };
}

export function normalizeActionRelation(currentActionId: string, targetActionId: string, requestedType: string) {
  if (!currentActionId || !targetActionId || currentActionId === targetActionId) return null;
  if (requestedType === 'related') {
    return {
      source_action_id: currentActionId < targetActionId ? currentActionId : targetActionId,
      target_action_id: currentActionId < targetActionId ? targetActionId : currentActionId,
      relation_type: 'related',
    };
  }
  if (requestedType === 'blocks') return { source_action_id: currentActionId, target_action_id: targetActionId, relation_type: 'blocks' };
  if (requestedType === 'blocked_by') return { source_action_id: targetActionId, target_action_id: currentActionId, relation_type: 'blocks' };
  return null;
}

function filterHierarchy(actions: Record<string, unknown>[], hierarchy: string | undefined, parentsWithChildren: Set<string>) {
  if (hierarchy === 'top_level') return actions.filter(action => !action.parent_action_id);
  if (hierarchy === 'sub_actions') return actions.filter(action => Boolean(action.parent_action_id));
  if (hierarchy === 'with_children') return actions.filter(action => parentsWithChildren.has(String(action.id)));
  return actions;
}

export function filterByOwner(actions: Record<string, unknown>[], ownerId?: string) {
  if (!ownerId) return actions;
  return actions.filter(action => Array.isArray(action.owners) && action.owners.includes(ownerId));
}

async function hydrateReleaseSummaries(supabase: ReturnType<typeof getDb>, actions: Record<string, unknown>[]) {
  const actionIds = actions.map(action => String(action.id));
  if (!actionIds.length) return actions;
  const associationResult = await supabase.from('atlas_release_actions').select('*').eq('status', 'active').in('action_id', actionIds);
  if (associationResult.error) throw associationResult.error;
  const associations = associationResult.data || [];
  const releaseIds = Array.from(new Set(associations.map(item => String(item.release_id))));
  if (!releaseIds.length) return actions.map(action => ({ ...action, releases: [] }));
  const releaseResult = await supabase.from('atlas_releases').select('id,pipeline_id,name,version,commit_sha,status,scheduled_at,released_at').in('id', releaseIds);
  if (releaseResult.error) throw releaseResult.error;
  const releases = releaseResult.data || [];
  const pipelineIds = Array.from(new Set(releases.map(item => String(item.pipeline_id))));
  const pipelineResult = await supabase.from('atlas_release_pipelines').select('id,name,pipeline_type').in('id', pipelineIds);
  if (pipelineResult.error) throw pipelineResult.error;
  const stageRunIds = Array.from(new Set(associations.map(item => item.stage_run_id).filter(Boolean).map(String)));
  let stageRuns: Record<string, unknown>[] = [];
  let stages: Record<string, unknown>[] = [];
  if (stageRunIds.length) {
    const runResult = await supabase.from('atlas_release_stage_runs').select('id,stage_id,status,frozen_at,started_at,completed_at').in('id', stageRunIds);
    if (runResult.error) throw runResult.error;
    stageRuns = runResult.data || [];
    const stageIds = Array.from(new Set(stageRuns.map(item => String(item.stage_id))));
    const stageResult = await supabase.from('atlas_release_stages').select('id,stage_key,name,environment,position').in('id', stageIds);
    if (stageResult.error) throw stageResult.error;
    stages = stageResult.data || [];
  }
  return actions.map(action => ({
    ...action,
    releases: associations.filter(item => item.action_id === action.id).map(association => {
      const release = releases.find(item => item.id === association.release_id);
      const pipeline = release ? (pipelineResult.data || []).find(item => item.id === release.pipeline_id) : null;
      const run = stageRuns.find(item => item.id === association.stage_run_id) as Record<string, unknown> | undefined;
      const stage = run ? stages.find(item => item.id === run.stage_id) : null;
      return { ...association, release, pipeline, stage_run: run || null, stage: stage || null };
    }),
  }));
}

function assignmentPriority(priority: unknown): string {
  if (priority === 'p0') return 'critical';
  if (priority === 'p1') return 'high';
  if (priority === 'p3') return 'low';
  return 'medium';
}

function assignmentTypeForWorkMode(workMode: unknown): string {
  return workMode === 'review_required' || workMode === 'user_only' ? 'review' : 'execution';
}

// GET /
router.get('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { status, business, priority, owner_id, due_before, due_after, search, source_id, work_mode, sort_by, sort_dir, show_blocked, stewardship, parent_id, hierarchy, estimate_points, resolution, cycle_id, template_id, release_id, pipeline_id, stage_run_id, include_triage } = c.req.query() as Record<string, string>;

    let query = supabase.from('atlas_actions').select(ACTION_SELECT);

    if (status) query = query.in('status', status.split(','));
    if (business) query = query.eq('business', business);
    if (priority) query = query.in('priority', priority.split(','));
    query = filterProtocolSpecialModes(query, work_mode);
    if (due_before) query = query.lte('due_date', due_before);
    if (due_after) query = query.gte('due_date', due_after);
    const searchTerm = buildSafeIlikePattern(search);
    if (searchTerm) {
      const term = searchTerm;
      query = query.or(`identifier.ilike.${term},id.ilike.${term},title.ilike.${term},description.ilike.${term},notes.ilike.${term}`);
    }
    if (source_id) query = query.eq('source_transcript_id', source_id);
    if (parent_id) query = query.eq('parent_action_id', parent_id);
    if (estimate_points === '__null__') query = query.is('estimate_points', null);
    else if (estimate_points && /^\d+$/.test(estimate_points)) query = query.eq('estimate_points', Number(estimate_points));
    if (resolution === '__null__') query = query.is('resolution', null);
    else if (['completed', 'canceled', 'duplicate'].includes(resolution)) query = query.eq('resolution', resolution);
    if (cycle_id === '__null__') query = query.is('cycle_id', null);
    else if (cycle_id) query = query.eq('cycle_id', cycle_id);
    if (template_id === '__null__') query = query.is('template_id', null);
    else if (template_id) query = query.eq('template_id', template_id);
    if (release_id || pipeline_id || stage_run_id) {
      let releaseIds: string[] | null = null;
      if (pipeline_id) {
        const releaseResult = await supabase.from('atlas_releases').select('id').eq('pipeline_id', pipeline_id);
        if (releaseResult.error) throw releaseResult.error;
        releaseIds = (releaseResult.data || []).map(item => item.id);
      }
      let associationQuery = supabase.from('atlas_release_actions').select('action_id').eq('status', 'active');
      if (release_id) associationQuery = associationQuery.eq('release_id', release_id);
      else if (releaseIds) associationQuery = releaseIds.length ? associationQuery.in('release_id', releaseIds) : associationQuery.eq('release_id', '__none__');
      if (stage_run_id) associationQuery = associationQuery.eq('stage_run_id', stage_run_id);
      const associationResult = await associationQuery;
      if (associationResult.error) throw associationResult.error;
      const matchedIds = Array.from(new Set((associationResult.data || []).map(item => item.action_id)));
      query = matchedIds.length ? query.in('id', matchedIds) : query.eq('id', '__no_release_match__');
    }

    const validSorts = ['priority', 'due_date', 'review_date', 'status', 'resolution', 'title', 'business', 'work_mode', 'approval_state', 'estimate_points', 'parent_action_id', 'cycle_id', 'created_at', 'updated_at'];
    const sortField = validSorts.includes(sort_by) ? sort_by : 'priority';
    const direction = sort_dir === 'desc' ? 'DESC' : 'ASC';
    const { limit, offset } = parsePagination(c.req.query() as Record<string, string>);
    const hideBlocked = show_blocked === 'false';
    const asOf = new Date().toISOString();
    let parentsWithChildren = new Set<string>();
    let triageActionIds = new Set<string>();
    if (include_triage !== 'true') {
      const triageResult = await supabase.from('atlas_triage_entries').select('action_id').in('state', ['pending', 'snoozed']);
      if (triageResult.error) throw triageResult.error;
      triageActionIds = new Set((triageResult.data || []).map(item => String(item.action_id)));
    }
    if (hierarchy === 'with_children') {
      const { data: childRows, error: childError } = await supabase.from('atlas_actions').select('parent_action_id').not('parent_action_id', 'is', null);
      if (childError) throw childError;
      parentsWithChildren = new Set((childRows || []).map(row => String(row.parent_action_id)).filter(Boolean));
    }

    if (sortField === 'priority') {
      let results = filterByOwner(annotateBlocked(await hydrateReleaseSummaries(supabase, await loadAllRows(query))), owner_id);
      results = filterHierarchy(results, hierarchy, parentsWithChildren).filter(action => !triageActionIds.has(String(action.id)));
      if (stewardship === 'stale') results = results.filter(action => isProtocolStale(action, new Date().toISOString().slice(0, 10)));
      if (hideBlocked) results = results.filter(a => !a.is_blocked);
      const sorted = sortByPriority(results, direction);
      const items = sorted.slice(offset, offset + limit);
      return c.json({
        items,
        page: Math.floor(offset / limit) + 1,
        page_size: limit,
        total: sorted.length,
        has_more: offset + items.length < sorted.length,
        as_of: asOf,
      });
    } else {
      query = query.order(sortField, { ascending: direction === 'ASC', nullsFirst: false });
      let results = filterByOwner(annotateBlocked(await hydrateReleaseSummaries(supabase, await loadAllRows(query))), owner_id);
      results = filterHierarchy(results, hierarchy, parentsWithChildren).filter(action => !triageActionIds.has(String(action.id)));
      if (stewardship === 'stale') results = results.filter(action => isProtocolStale(action, new Date().toISOString().slice(0, 10)));
      if (hideBlocked) results = results.filter(a => !a.is_blocked);
      const items = results.slice(offset, offset + limit);
      return c.json({
        items,
        page: Math.floor(offset / limit) + 1,
        page_size: limit,
        total: results.length,
        has_more: offset + items.length < results.length,
        as_of: asOf,
      });
    }
  } catch (err) {
    console.error(`[actions] GET error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /stats
router.get('/stats', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { business } = c.req.query() as Record<string, string>;
    const businessFilter = business || null;
    const today = getAtlasLocalDate();
    const completedSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [activeTotal, readyNotOverdue, overdueActive, completedThisWeek, blockedActive, needsReviewActive] = await Promise.all([
      countActions(
        supabase,
        businessFilter,
        query => query.in('status', ACTIVE_STATUSES),
      ),
      countActions(
        supabase,
        businessFilter,
        query => query.in('status', NON_BLOCKED_ACTIVE_STATUSES).or(`due_date.is.null,due_date.gte.${today}`),
      ),
      countActions(
        supabase,
        businessFilter,
        query => query.in('status', ACTIVE_STATUSES).lt('due_date', today),
      ),
      countActions(
        supabase,
        businessFilter,
        query => query.eq('status', 'done').gte('completed_at', completedSince),
      ),
      countActions(
        supabase,
        businessFilter,
        query => query.eq('status', 'blocked'),
      ),
      countActions(
        supabase,
        businessFilter,
        query => query.in('status', ACTIVE_STATUSES).eq('approval_state', 'needs_review'),
      ),
    ]);

    return c.json({
      active_total: activeTotal,
      ready_not_overdue: readyNotOverdue,
      overdue_active: overdueActive,
      blocked_active: blockedActive,
      needs_review_active: needsReviewActive,
      completedThisWeek,
      completed_this_week: completedThisWeek,
      // Compatibility aliases for one frontend release.
      active: readyNotOverdue,
      totalActive: activeTotal,
      total_active: activeTotal,
      overdue: overdueActive,
      blocked: blockedActive,
      pendingReview: needsReviewActive,
      pending_review: needsReviewActive,
    });
  } catch (err) {
    console.error(`[actions] stats error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /by-owner/:id
router.get('/by-owner/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data, error } = await supabase
      .from('atlas_actions')
      .select('*')
      .filter('owners', 'cs', JSON.stringify([c.req.param('id')]));
    if (error) throw error;
    return c.json(sortByPriority((data || []) as Record<string, unknown>[]));
  } catch (err) {
    console.error(`[actions] by-owner error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /:id/structure
router.get('/:id/structure', async (c) => {
  try {
    const supabase = getDb(c.env);
    const actionId = c.req.param('id');
    const { data: action, error: actionError } = await supabase.from('atlas_actions').select('*').eq('id', actionId).maybeSingle();
    if (actionError) throw actionError;
    if (!action) return apiError(c, 404, 'ACTION_NOT_FOUND', 'Action not found.');

    const [childrenResult, outgoingResult, incomingResult, estimateResult, outgoingReferencesResult, backlinkReferencesResult] = await Promise.all([
      supabase.from('atlas_actions').select('*').eq('parent_action_id', actionId).order('priority', { ascending: true }).order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('atlas_action_relations').select('*').eq('source_action_id', actionId).eq('status', 'active').order('created_at', { ascending: true }),
      supabase.from('atlas_action_relations').select('*').eq('target_action_id', actionId).eq('status', 'active').order('created_at', { ascending: true }),
      supabase.from('atlas_config').select('value').eq('key', 'estimate_settings').maybeSingle(),
      supabase.from('atlas_text_references').select('*').eq('source_type', 'action').eq('source_id', actionId).eq('status', 'active').order('last_seen_at', { ascending: false }),
      supabase.from('atlas_text_references').select('*').eq('target_action_id', actionId).eq('status', 'active').order('last_seen_at', { ascending: false }),
    ]);
    for (const result of [childrenResult, outgoingResult, incomingResult, estimateResult, outgoingReferencesResult, backlinkReferencesResult]) if (result.error) throw result.error;

    let parent: Record<string, unknown> | null = null;
    if (action.parent_action_id) {
      const parentResult = await supabase.from('atlas_actions').select('id,title,status,priority,estimate_points,project_id').eq('id', action.parent_action_id).maybeSingle();
      if (parentResult.error) throw parentResult.error;
      parent = parentResult.data as Record<string, unknown> | null;
    }

    const relations = [
      ...((outgoingResult.data || []) as Record<string, unknown>[]),
      ...((incomingResult.data || []) as Record<string, unknown>[]),
    ];
    const relatedIds = Array.from(new Set(relations.map(relation => (
      String(relation.source_action_id) === actionId ? String(relation.target_action_id) : String(relation.source_action_id)
    ))));
    if (action.duplicate_of_id && !relatedIds.includes(String(action.duplicate_of_id))) relatedIds.push(String(action.duplicate_of_id));
    let relatedActions: Record<string, unknown>[] = [];
    if (relatedIds.length > 0) {
      const relatedResult = await supabase.from('atlas_actions').select('id,title,status,priority,resolution,estimate_points,project_id').in('id', relatedIds);
      if (relatedResult.error) throw relatedResult.error;
      relatedActions = (relatedResult.data || []) as Record<string, unknown>[];
    }
    const relatedById = new Map(relatedActions.map(row => [String(row.id), row]));
    const hydratedRelations = relations.map(relation => {
      const outgoing = String(relation.source_action_id) === actionId;
      const otherId = outgoing ? String(relation.target_action_id) : String(relation.source_action_id);
      let direction = 'related';
      if (relation.relation_type === 'blocks') direction = outgoing ? 'blocking' : 'blocked_by';
      if (relation.relation_type === 'duplicate') direction = outgoing ? 'duplicate_of' : 'duplicated_by';
      return { ...relation, direction, related_action: relatedById.get(otherId) || null };
    });
    const estimateValue = estimateResult.data?.value as Record<string, unknown> | undefined;
    const unestimatedValue = Number.isSafeInteger(estimateValue?.unestimated_value) ? Number(estimateValue?.unestimated_value) : 1;
    const children = (childrenResult.data || []) as Record<string, unknown>[];

    return c.json({
      action_id: actionId,
      parent,
      children,
      child_progress: calculateActionChildProgress(children, unestimatedValue),
      relations: hydratedRelations,
      canonical_action: action.duplicate_of_id ? relatedById.get(String(action.duplicate_of_id)) || null : null,
      estimate_settings: { unestimated_value: unestimatedValue },
      text_references: outgoingReferencesResult.data || [],
      backlinks: backlinkReferencesResult.data || [],
      as_of: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[actions] structure error: ${(err as Error).message}`);
    return apiError(c, 500, 'ACTION_STRUCTURE_FAILED', 'Unable to load action structure.');
  }
});

// POST /:id/convert-to-project
router.post('/:id/convert-to-project', async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const revision = parseExpectedRevision(body.expected_revision);
    if (revision.error) return apiError(c, 400, 'INVALID_REVISION', revision.error);
    if (body.project_name !== undefined && (typeof body.project_name !== 'string' || !body.project_name.trim() || body.project_name.length > 500)) {
      return apiError(c, 400, 'INVALID_PROJECT_NAME', 'project_name must be 1-500 characters.');
    }
    const { data, error } = await getDb(c.env).rpc('convert_atlas_action_to_project', {
      p_action_id: c.req.param('id'),
      p_project_id: uuidv4(),
      p_project_name: typeof body.project_name === 'string' ? body.project_name.trim() : null,
      p_actor: getActor(c),
      p_expected_revision: revision.value,
    });
    if (error) return rpcErrorResponse(c, error, 'convert to a project');
    return c.json(data, 201);
  } catch (err) {
    console.error(`[actions] convert-to-project error: ${(err as Error).message}`);
    return apiError(c, 500, 'ACTION_PROJECT_CONVERSION_FAILED', 'Unable to convert the parent action to a project.');
  }
});

// POST /:id/sub-actions
router.post('/:id/sub-actions', async (c) => {
  try {
    const raw = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const body = sanitizeBody(raw, ['title', 'description']);
    if (typeof body.title !== 'string' || !body.title.trim()) return apiError(c, 400, 'INVALID_SUB_ACTION', 'title is required.');
    const fieldErrors = [...validateActionFields({ due_date: body.due_date }), ...validateStringLengths(body)];
    if (fieldErrors.length > 0) return apiError(c, 400, 'INVALID_SUB_ACTION', fieldErrors.join('; '));
    const revision = parseExpectedRevision(body.expected_parent_revision);
    if (revision.error) return apiError(c, 400, 'INVALID_REVISION', revision.error);
    const { data, error } = await getDb(c.env).rpc('create_atlas_sub_action', {
      p_parent_action_id: c.req.param('id'),
      p_child_action_id: uuidv4(),
      p_title: body.title,
      p_description: typeof body.description === 'string' ? body.description : '',
      p_due_date: body.due_date || null,
      p_actor: getActor(c),
      p_expected_parent_revision: revision.value,
    });
    if (error) return rpcErrorResponse(c, error, 'create sub-action');
    return c.json(data, 201);
  } catch (err) {
    console.error(`[actions] sub-action create error: ${(err as Error).message}`);
    return apiError(c, 500, 'SUB_ACTION_CREATE_FAILED', 'Unable to create the sub-action.');
  }
});

// POST /:id/parent
router.post('/:id/parent', async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    if (body.parent_action_id !== null && body.parent_action_id !== undefined && (typeof body.parent_action_id !== 'string' || !body.parent_action_id.trim())) {
      return apiError(c, 400, 'INVALID_PARENT', 'parent_action_id must be an action id or null.');
    }
    const revision = parseExpectedRevision(body.expected_revision);
    if (revision.error) return apiError(c, 400, 'INVALID_REVISION', revision.error);
    const { data, error } = await getDb(c.env).rpc('set_atlas_action_parent', {
      p_action_id: c.req.param('id'),
      p_parent_action_id: body.parent_action_id || null,
      p_actor: getActor(c),
      p_expected_revision: revision.value,
    });
    if (error) return rpcErrorResponse(c, error, 'set parent');
    return c.json(data);
  } catch (err) {
    console.error(`[actions] parent update error: ${(err as Error).message}`);
    return apiError(c, 500, 'ACTION_PARENT_FAILED', 'Unable to update the action parent.');
  }
});

// POST /:id/relations
router.post('/:id/relations', async (c) => {
  try {
    const raw = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const body = sanitizeBody(raw, ['note']);
    const currentId = c.req.param('id');
    const targetId = typeof body.target_action_id === 'string' ? body.target_action_id : '';
    const normalized = normalizeActionRelation(currentId, targetId, String(body.relation_type || ''));
    if (!normalized) return apiError(c, 400, 'INVALID_ACTION_RELATION', 'Choose another action and a related, blocks, or blocked_by relation.');
    const supabase = getDb(c.env);
    const { data: targets, error: targetError } = await supabase.from('atlas_actions').select('id,status').in('id', [currentId, targetId]);
    if (targetError) throw targetError;
    if ((targets || []).length !== 2) return apiError(c, 404, 'ACTION_NOT_FOUND', 'Both actions must exist.');
    if ((targets || []).some(action => action.status === 'archived')) return apiError(c, 409, 'ACTION_ARCHIVED', 'Restore archived actions before relating them.');
    const actor = getActor(c);
    const { data, error } = await supabase.from('atlas_action_relations').insert({
      id: uuidv4(), ...normalized, status: 'active', note: body.note || '', created_by: actor, updated_by: actor,
    }).select().single();
    if (error?.code === '23505') return apiError(c, 409, 'ACTION_RELATION_EXISTS', 'That active relation already exists.');
    if (error) throw error;
    return c.json(data, 201);
  } catch (err) {
    console.error(`[actions] relation create error: ${(err as Error).message}`);
    return apiError(c, 500, 'ACTION_RELATION_CREATE_FAILED', 'Unable to create the action relation.');
  }
});

async function transitionActionRelation(c: Parameters<typeof apiError>[0] & any, status: 'resolved' | 'archived') {
  try {
    const supabase = getDb(c.env);
    const actionId = c.req.param('id');
    const relationId = c.req.param('relationId');
    const { data: relation, error: fetchError } = await supabase.from('atlas_action_relations').select('*').eq('id', relationId).maybeSingle();
    if (fetchError) throw fetchError;
    if (!relation || (relation.source_action_id !== actionId && relation.target_action_id !== actionId)) {
      return apiError(c, 404, 'ACTION_RELATION_NOT_FOUND', 'Relation not found for this action.');
    }
    if (relation.relation_type === 'duplicate') return apiError(c, 400, 'DUPLICATE_TRANSITION_REQUIRED', 'Use the duplicate restore operation.');
    if (relation.status === status) return c.json(relation);
    const { data, error } = await supabase.from('atlas_action_relations').update({
      status, revision: Number(relation.revision || 0) + 1, updated_by: getActor(c), updated_at: new Date().toISOString(),
    }).eq('id', relation.id).eq('revision', relation.revision).select().maybeSingle();
    if (error) throw error;
    if (!data) return apiError(c, 409, 'REVISION_CONFLICT', 'The relation changed. Refresh and retry.');
    return c.json(data);
  } catch (err) {
    console.error(`[actions] relation ${status} error: ${(err as Error).message}`);
    return apiError(c, 500, 'ACTION_RELATION_TRANSITION_FAILED', `Unable to mark the relation ${status}.`);
  }
}

router.post('/:id/relations/:relationId/resolve', c => transitionActionRelation(c, 'resolved'));
router.post('/:id/relations/:relationId/archive', c => transitionActionRelation(c, 'archived'));

// POST /:id/duplicate
router.post('/:id/duplicate', async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    if (typeof body.canonical_action_id !== 'string' || !body.canonical_action_id.trim()) {
      return apiError(c, 400, 'INVALID_DUPLICATE', 'canonical_action_id is required.');
    }
    const revision = parseExpectedRevision(body.expected_revision);
    if (revision.error) return apiError(c, 400, 'INVALID_REVISION', revision.error);
    const { data, error } = await getDb(c.env).rpc('mark_atlas_action_duplicate', {
      p_action_id: c.req.param('id'),
      p_canonical_action_id: body.canonical_action_id,
      p_actor: getActor(c),
      p_expected_revision: revision.value,
    });
    if (error) return rpcErrorResponse(c, error, 'mark duplicate');
    return c.json(data);
  } catch (err) {
    console.error(`[actions] duplicate error: ${(err as Error).message}`);
    return apiError(c, 500, 'ACTION_DUPLICATE_FAILED', 'Unable to mark the action as a duplicate.');
  }
});

// POST /:id/restore-duplicate (owner-only)
router.post('/:id/restore-duplicate', async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const revision = parseExpectedRevision(body.expected_revision);
    if (revision.error) return apiError(c, 400, 'INVALID_REVISION', revision.error);
    const { data, error } = await getDb(c.env).rpc('restore_atlas_duplicate_action', {
      p_action_id: c.req.param('id'),
      p_actor: getActor(c),
      p_expected_revision: revision.value,
    });
    if (error) return rpcErrorResponse(c, error, 'restore duplicate');
    return c.json(data);
  } catch (err) {
    console.error(`[actions] restore duplicate error: ${(err as Error).message}`);
    return apiError(c, 500, 'ACTION_DUPLICATE_RESTORE_FAILED', 'Unable to restore the duplicate action.');
  }
});

// GET /:id
router.get('/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data, error } = await supabase.from('atlas_actions').select(ACTION_SELECT).eq('id', c.req.param('id')).single();
    if (error || !data) return c.json({ error: 'Action not found' }, 404);
    return c.json((await hydrateReleaseSummaries(supabase, [data]))[0]);
  } catch (err) {
    console.error(`[actions] GET/:id error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// POST /:id/agent-assignment
router.post('/:id/agent-assignment', async (c) => {
  try {
    const supabase = getDb(c.env);
    const actor = getActor(c);
    const { data: action, error: fetchErr } = await supabase.from('atlas_actions').select('*').eq('id', c.req.param('id')).single();
    if (fetchErr || !action) return c.json({ error: 'Action not found' }, 404);
    if (action.agent_assignment_id) return c.json({ error: 'Action already has an agent assignment.' }, 409);

    const now = new Date().toISOString();
    const definition = action.definition_of_done || `Complete and verify: ${action.title}`;
    const assignmentId = uuidv4();
    const { data: assignment, error: insertErr } = await supabase
      .from('agent_assignments')
      .insert({
        id: assignmentId,
        title: `Atlas: ${action.title}`,
        description: action.description || action.notes || null,
        assignment_type: assignmentTypeForWorkMode(action.work_mode),
        task_type: 'execution',
        goal: action.next_action || action.title,
        success_criteria_json: [definition],
        constraints_json: [],
        due_at: action.due_date ? `${action.due_date}T23:59:00.000Z` : null,
        priority: assignmentPriority(action.priority),
        owner_review_required: action.work_mode !== 'autonomous',
        status: action.work_mode === 'autonomous' ? 'queued' : 'awaiting_review',
        created_by: actor,
        work_mode: action.work_mode || 'review_required',
        definition_of_done: definition,
        evidence_required_json: {
          required: true,
          sources: ['atlas_action', 'agent_run'],
        },
        review_medium: action.work_mode === 'autonomous' ? 'chat' : 'peos_review_queue',
        source_action_id: action.id,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();
    if (insertErr) throw insertErr;

    await supabase.from('atlas_actions').update({
      agent_assignment_id: assignment.id,
      approval_state: action.work_mode === 'autonomous' ? 'not_required' : 'needs_review',
      updated_at: now,
    }).eq('id', action.id);

    await supabase.from('atlas_activity_log').insert({
      action_id: action.id,
      event: 'agent_assignment_created',
      new_value: assignment.id,
      actor,
    });

    return c.json(assignment, 201);
  } catch (err) {
    console.error(`[actions] agent-assignment error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// POST /
router.post('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    const rawBody = await c.req.json();
    const body = coerceActionBody(sanitizeBody(rawBody, ACTION_TEXT_FIELDS));
    const actor = getActor(c);
    const {
      title, description = '', status = 'not_started', business, priority = 'p2',
      due_date = null, owners = ['ransomed'], source_transcript_id = null, source_label = null,
      tags = [], notes = '', recurrence = 'none', work_mode = null, estimate_points = null,
    } = body as Record<string, unknown>;

    if (!title || !business) return c.json({ error: 'title and business are required' }, 400);
    if (EXPLICIT_TRANSITION_STATUSES.has(String(status))) {
      return apiError(c, 400, 'EXPLICIT_TRANSITION_REQUIRED', 'Create the action first, then use its completion or archive endpoint.');
    }
    if (includesAssignmentFields(body) && !hasRequestScope(c, 'actions:assign')) {
      return apiError(c, 403, 'ASSIGNMENT_SCOPE_REQUIRED', 'Changing owners or assignment links requires actions:assign.');
    }

    const validationErrors = [
      ...validateActionFields(body),
      ...(await validateActionReferences(supabase, body)),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) return c.json({ error: validationErrors.join('; ') }, 400);

    const id = uuidv4();
    const now = new Date().toISOString();

    const protocolFields: Record<string, unknown> = {};
    applyProtocolFields(protocolFields, body);

    const { data: action, error } = await supabase
      .from('atlas_actions')
      .insert({ id, title, description, status, workflow_status_id: body.workflow_status_id || null, business, priority, due_date, owners: serializeJsonArray(owners), source_transcript_id, source_label, tags: serializeJsonArray(tags), notes, recurrence, work_mode, estimate_points, ...protocolFields, created_at: now, updated_at: now })
      .select(ACTION_SELECT).single();

    if (error) throw error;

    await supabase.from('atlas_activity_log').insert({ action_id: id, event: 'created', new_value: title, actor });
    let latest = action;
    const automations: unknown[] = [];
    const createdRun = await executeWorkflowRules(supabase, latest, 'action_created', actor, `action-created:${id}`, false);
    if (createdRun) automations.push(createdRun);
    if (body.triage === true) {
      const entered = await supabase.rpc('enter_atlas_triage_action', {
        p_action_id: id, p_source_type: body.triage_source_type || 'manual',
        p_source_ref: body.triage_source_ref || null, p_actor: actor,
      });
      if (entered.error) throw entered.error;
      latest = await loadWorkflowAction(supabase, id);
      const triageRun = await executeWorkflowRules(supabase, latest, 'triage_entered', actor, `triage-entered:${id}:${(entered.data as any)?.entry?.revision || 0}`, false);
      if (triageRun) automations.push(triageRun);
    }
    latest = await loadWorkflowAction(supabase, id);
    return c.json({ ...latest, workflow_automation_runs: automations }, 201);
  } catch (err) {
    console.error(`[actions] POST error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// POST /bulk
router.post('/bulk', async (c) => {
  try {
    const supabase = getDb(c.env);
    const rawBody = await c.req.json();
    const rawActions = parseBulkPayload(rawBody, 'actions');
    if (!Array.isArray(rawActions)) return c.json({ error: 'actions array required' }, 400);
    if (rawActions.length > BULK_MAX) return c.json({ error: `Bulk operations limited to ${BULK_MAX} items` }, 400);

    const actionsList = rawActions.map((item: unknown) => coerceActionBody(sanitizeBody(item as Record<string, unknown>, ACTION_TEXT_FIELDS)));
    for (let i = 0; i < actionsList.length; i++) {
      const action = actionsList[i];
      if (!action.title || !action.business) return c.json({ error: `Item ${i}: title and business are required` }, 400);
      if (EXPLICIT_TRANSITION_STATUSES.has(String(action.status))) {
        return apiError(c, 400, 'EXPLICIT_TRANSITION_REQUIRED', `Item ${i}: completion and archiving require their explicit action endpoints.`);
      }
      if (includesAssignmentFields(action) && !hasRequestScope(c, 'actions:assign')) {
        return apiError(c, 403, 'ASSIGNMENT_SCOPE_REQUIRED', `Item ${i}: changing owners or assignment links requires actions:assign.`);
      }
      const fieldErrors = [
        ...validateActionFields(action),
        ...(await validateActionReferences(supabase, action)),
        ...validateStringLengths(action),
      ];
      if (fieldErrors.length > 0) return c.json({ error: `Item ${i}: ${fieldErrors.join('; ')}` }, 400);
    }

    const actor = getActor(c);
    const rows = actionsList.map(action => ({
      id: uuidv4(),
      title: action.title,
      description: action.description || '',
      status: action.status || 'not_started',
      business: action.business,
      priority: action.priority || 'p2',
      due_date: action.due_date || null,
      owners: serializeJsonArray(action.owners === undefined ? ['ransomed'] : action.owners),
      source_transcript_id: action.source_transcript_id || null,
      source_label: action.source_label || null,
      tags: serializeJsonArray(action.tags),
      notes: action.notes || '',
      recurrence: action.recurrence || 'none',
      work_mode: action.work_mode || null,
      workflow_status_id: action.workflow_status_id || null,
      estimate_points: action.estimate_points ?? null,
      next_action: action.next_action || null,
      definition_of_done: action.definition_of_done || null,
      review_date: action.review_date || null,
      evidence_json: serializeJsonObject(action.evidence_json),
      agent_assignment_id: action.agent_assignment_id || null,
      approval_state: action.approval_state || 'not_required',
    }));

    const { error } = await supabase.from('atlas_actions').insert(rows);
    if (error) throw error;

    const logRows = rows.map(row => ({ action_id: row.id, event: 'created', new_value: row.title, actor }));
      await supabase.from('atlas_activity_log').insert(logRows);

    for (const row of rows) {
      const action = await loadWorkflowAction(supabase, row.id);
      await executeWorkflowRules(supabase, action, 'action_created', actor, `action-created:${row.id}`, false);
    }

    return c.json({ created: rows.length, ids: rows.map(r => r.id) }, 201);
  } catch (err) {
    console.error(`[actions] POST/bulk error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// PUT /bulk
router.put('/bulk', async (c) => {
  try {
    const supabase = getDb(c.env);
    const rawBody = await c.req.json();
    const rawUpdates = parseBulkPayload(rawBody, 'updates');
    if (!Array.isArray(rawUpdates)) return c.json({ error: 'updates array required' }, 400);
    if (rawUpdates.length > BULK_MAX) return c.json({ error: `Bulk operations limited to ${BULK_MAX} items` }, 400);

    const updates = rawUpdates.map((item: unknown) => coerceActionBody(sanitizeBody(item as Record<string, unknown>, ACTION_TEXT_FIELDS)));
    for (let i = 0; i < updates.length; i++) {
      if (EXPLICIT_TRANSITION_STATUSES.has(String(updates[i].status))) {
        return apiError(c, 400, 'EXPLICIT_TRANSITION_REQUIRED', `Item ${i}: completion and archiving require their explicit action endpoints.`);
      }
      if (includesAssignmentFields(updates[i]) && !hasRequestScope(c, 'actions:assign')) {
        return apiError(c, 403, 'ASSIGNMENT_SCOPE_REQUIRED', `Item ${i}: changing owners or assignment links requires actions:assign.`);
      }
      const fieldErrors = [
        ...validateActionFields(updates[i]),
        ...(await validateActionReferences(supabase, updates[i])),
        ...validateStringLengths(updates[i]),
      ];
      if (fieldErrors.length > 0) return c.json({ error: `Item ${i}: ${fieldErrors.join('; ')}` }, 400);
      if (updates[i].notes !== undefined && updates[i].append_note !== undefined) {
        return c.json({ error: `Item ${i}: notes and append_note are mutually exclusive` }, 400);
      }
    }

    const actor = getActor(c);
    const now = new Date().toISOString();
    let updatedCount = 0;

    for (const update of updates) {
      const { data: existing, error: fetchErr } = await supabase.from('atlas_actions').select('*').eq('id', update.id).single();
      if (fetchErr || !existing) continue;
      if (existing.status === 'archived') {
        return apiError(c, 409, 'ACTION_ARCHIVED', `Item ${update.id}: restore the action before editing it.`);
      }

      const fields: Record<string, unknown> = {};
      const appendNote = update.append_note;

      if (update.status !== undefined) fields.status = update.status;
      if (update.priority !== undefined) fields.priority = update.priority;
      if (update.title !== undefined) fields.title = update.title;
      if (update.description !== undefined) fields.description = update.description;
      if (update.due_date !== undefined) fields.due_date = update.due_date;
      if (update.owners !== undefined) fields.owners = serializeJsonArray(update.owners);
      if (update.business !== undefined) fields.business = update.business;
      if (update.source_transcript_id !== undefined) fields.source_transcript_id = update.source_transcript_id;
      if (update.source_label !== undefined) fields.source_label = update.source_label;
      if (update.tags !== undefined) fields.tags = serializeJsonArray(update.tags);
      if (update.notes !== undefined) fields.notes = update.notes;
      if (appendNote !== undefined) fields.notes = existing.notes ? `${existing.notes}\n\n${appendNote}` : appendNote;
      if (update.recurrence !== undefined) fields.recurrence = update.recurrence;
      if (update.work_mode !== undefined) fields.work_mode = update.work_mode;
      if (update.estimate_points !== undefined) fields.estimate_points = update.estimate_points;
      if (update.workflow_status_id !== undefined) fields.workflow_status_id = update.workflow_status_id || null;
      applyProtocolFields(fields, update);

      if (Object.keys(fields).length === 0) continue;

      fields.updated_at = now;

      const { error: updateErr } = await supabase.from('atlas_actions').update(fields).eq('id', update.id);
      if (updateErr) throw updateErr;

      if (update.status !== undefined && update.status !== existing.status) {
        await supabase.from('atlas_activity_log').insert({ action_id: update.id, event: 'status_changed', old_value: existing.status, new_value: update.status, actor });
      }
      if (update.priority !== undefined && update.priority !== existing.priority) {
        await supabase.from('atlas_activity_log').insert({ action_id: update.id, event: 'priority_changed', old_value: existing.priority, new_value: update.priority, actor });
      }
      if (update.notes !== undefined || appendNote !== undefined || update.description !== undefined || update.tags !== undefined || update.owners !== undefined || update.work_mode !== undefined || update.estimate_points !== undefined || PROTOCOL_FIELDS.some(field => update[field] !== undefined)) {
        await supabase.from('atlas_activity_log').insert({ action_id: update.id, event: 'updated', new_value: JSON.stringify(Object.keys(update).filter(k => k !== 'id')), actor });
      }

      const refreshed = await loadWorkflowAction(supabase, String(update.id));
      await executeWorkflowRules(supabase, refreshed, 'action_updated', actor, `action-updated:${update.id}:${now}`, false);
      if (update.status !== undefined && update.status !== existing.status) {
        await executeWorkflowRules(supabase, await loadWorkflowAction(supabase, String(update.id)), 'status_changed', actor, `status-changed:${update.id}:${now}`, false);
      }
      if (update.priority !== undefined && update.priority !== existing.priority) {
        await executeWorkflowRules(supabase, await loadWorkflowAction(supabase, String(update.id)), 'priority_changed', actor, `priority-changed:${update.id}:${now}`, false);
      }

      updatedCount += 1;
    }

    return c.json({ updated: updatedCount });
  } catch (err) {
    console.error(`[actions] PUT/bulk error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// PUT /:id
router.put('/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data: existing, error: fetchErr } = await supabase.from('atlas_actions').select('*').eq('id', c.req.param('id')).single();
    if (fetchErr || !existing) return c.json({ error: 'Action not found' }, 404);

    const rawBody = await c.req.json();
    const body = coerceActionBody(sanitizeBody(rawBody, ACTION_TEXT_FIELDS));

    if (EXPLICIT_TRANSITION_STATUSES.has(String(body.status))) {
      return apiError(c, 400, 'EXPLICIT_TRANSITION_REQUIRED', 'Use the action completion or archive endpoint for this status change.');
    }
    if (existing.status === 'archived') {
      return apiError(c, 409, 'ACTION_ARCHIVED', 'Restore the action before editing it.');
    }
    if (includesAssignmentFields(body) && !hasRequestScope(c, 'actions:assign')) {
      return apiError(c, 403, 'ASSIGNMENT_SCOPE_REQUIRED', 'Changing owners or assignment links requires actions:assign.');
    }

    const validationErrors = [
      ...validateActionFields(body),
      ...(await validateActionReferences(supabase, body)),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) return c.json({ error: validationErrors.join('; ') }, 400);

    const now = new Date().toISOString();
    const actor = getActor(c);
    const { title, description, status, business, priority, due_date, owners, source_transcript_id, source_label, tags, notes, append_note, recurrence, work_mode, estimate_points } = body as Record<string, unknown>;

    if (notes !== undefined && append_note !== undefined) return c.json({ error: 'notes and append_note are mutually exclusive' }, 400);

    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (business !== undefined) updates.business = business;
    if (priority !== undefined) updates.priority = priority;
    if (due_date !== undefined) updates.due_date = due_date;
    if (owners !== undefined) updates.owners = serializeJsonArray(owners);
    if (source_transcript_id !== undefined) updates.source_transcript_id = source_transcript_id;
    if (source_label !== undefined) updates.source_label = source_label;
    if (tags !== undefined) updates.tags = serializeJsonArray(tags);
    if (notes !== undefined) updates.notes = notes;
    if (append_note !== undefined) updates.notes = existing.notes ? `${existing.notes}\n\n${append_note}` : append_note;
    if (recurrence !== undefined) updates.recurrence = recurrence;
    if (work_mode !== undefined) updates.work_mode = work_mode;
    if (estimate_points !== undefined) updates.estimate_points = estimate_points;
    if (body.workflow_status_id !== undefined) updates.workflow_status_id = body.workflow_status_id || null;
    applyProtocolFields(updates, body);

    const mutableKeys = Object.keys(updates);
    if (mutableKeys.length === 0) return c.json({ error: 'No fields to update' }, 400);

    updates.updated_at = now;

    const { data: action, error: updateErr } = await supabase.from('atlas_actions').update(updates).eq('id', c.req.param('id')).select(ACTION_SELECT).single();
    if (updateErr) throw updateErr;

    if (status !== undefined && status !== existing.status) {
      await supabase.from('atlas_activity_log').insert({ action_id: c.req.param('id'), event: 'status_changed', old_value: existing.status, new_value: status, actor });
    }
    if (priority !== undefined && priority !== existing.priority) {
      await supabase.from('atlas_activity_log').insert({ action_id: c.req.param('id'), event: 'priority_changed', old_value: existing.priority, new_value: priority, actor });
    }
    if ((status === undefined || status === existing.status) && (priority === undefined || priority === existing.priority)) {
      await supabase.from('atlas_activity_log').insert({ action_id: c.req.param('id'), event: 'updated', new_value: JSON.stringify(mutableKeys), actor });
    }

    const automationRuns: unknown[] = [];
    const updatedRun = await executeWorkflowRules(supabase, action, 'action_updated', actor, `action-updated:${action.id}:${now}`, false);
    if (updatedRun) automationRuns.push(updatedRun);
    if ((status !== undefined && status !== existing.status) || (body.workflow_status_id !== undefined && body.workflow_status_id !== existing.workflow_status_id)) {
      const statusRun = await executeWorkflowRules(supabase, await loadWorkflowAction(supabase, action.id), 'status_changed', actor, `status-changed:${action.id}:${now}`, false);
      if (statusRun) automationRuns.push(statusRun);
    }
    if (priority !== undefined && priority !== existing.priority) {
      const priorityRun = await executeWorkflowRules(supabase, await loadWorkflowAction(supabase, action.id), 'priority_changed', actor, `priority-changed:${action.id}:${now}`, false);
      if (priorityRun) automationRuns.push(priorityRun);
    }
    const latest = await loadWorkflowAction(supabase, action.id);
    return c.json({ ...latest, workflow_automation_runs: automationRuns });
  } catch (err) {
    console.error(`[actions] PUT/:id error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/:id/complete', async (c) => {
  try {
    const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const revision = parseExpectedRevision(body.expected_revision);
    if (revision.error) return apiError(c, 400, 'INVALID_REVISION', revision.error);

    const actor = getActor(c);
    const validated = buildCompletionEvidence(body.evidence, actor, getAuthKind(c));
    if (validated.error) return apiError(c, 400, 'INVALID_EVIDENCE', validated.error);

    const supabase = getDb(c.env);
    const { data, error } = await supabase.rpc('complete_atlas_action', {
      p_action_id: c.req.param('id'),
      p_evidence: validated.evidence,
      p_actor: actor,
      p_expected_revision: revision.value,
    });
    if (error) return rpcErrorResponse(c, error, 'complete');
    return c.json(data);
  } catch (err) {
    console.error(`[actions] complete error: ${(err as Error).message}`);
    return apiError(c, 500, 'ACTION_TRANSITION_FAILED', 'Unable to complete the action.');
  }
});

router.post('/:id/archive', async (c) => {
  try {
    const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const revision = parseExpectedRevision(body.expected_revision);
    if (revision.error) return apiError(c, 400, 'INVALID_REVISION', revision.error);

    const supabase = getDb(c.env);
    const { data, error } = await supabase.rpc('archive_atlas_action', {
      p_action_id: c.req.param('id'),
      p_actor: getActor(c),
      p_expected_revision: revision.value,
    });
    if (error) return rpcErrorResponse(c, error, 'archive');
    return c.json(data);
  } catch (err) {
    console.error(`[actions] archive error: ${(err as Error).message}`);
    return apiError(c, 500, 'ACTION_TRANSITION_FAILED', 'Unable to archive the action.');
  }
});

router.post('/:id/restore', async (c) => {
  try {
    const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const revision = parseExpectedRevision(body.expected_revision);
    if (revision.error) return apiError(c, 400, 'INVALID_REVISION', revision.error);

    const supabase = getDb(c.env);
    const { data, error } = await supabase.rpc('restore_atlas_action', {
      p_action_id: c.req.param('id'),
      p_actor: getActor(c),
      p_expected_revision: revision.value,
    });
    if (error) return rpcErrorResponse(c, error, 'restore');
    return c.json(data);
  } catch (err) {
    console.error(`[actions] restore error: ${(err as Error).message}`);
    return apiError(c, 500, 'ACTION_TRANSITION_FAILED', 'Unable to restore the action.');
  }
});

router.delete('/:id', async (c) => {
  c.header('Allow', 'GET, PUT, POST');
  return apiError(c, 405, 'HARD_DELETE_DISABLED', 'Actions cannot be deleted. Use POST /api/actions/:id/archive.');
});

export default router;
