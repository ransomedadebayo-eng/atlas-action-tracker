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
  if (error.code === 'P0002' || error.message?.includes('ATLAS_ACTION_NOT_FOUND')) {
    return apiError(c, 404, 'ACTION_NOT_FOUND', 'Action not found.');
  }
  if (error.code === '22023') {
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

export function filterByOwner(actions: Record<string, unknown>[], ownerId?: string) {
  if (!ownerId) return actions;
  return actions.filter(action => Array.isArray(action.owners) && action.owners.includes(ownerId));
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
    const { status, business, priority, owner_id, due_before, due_after, search, source_id, work_mode, sort_by, sort_dir, show_blocked, stewardship } = c.req.query() as Record<string, string>;

    let query = supabase.from('atlas_actions').select('*');

    if (status) query = query.in('status', status.split(','));
    if (business) query = query.eq('business', business);
    if (priority) query = query.in('priority', priority.split(','));
    query = filterProtocolSpecialModes(query, work_mode);
    if (due_before) query = query.lte('due_date', due_before);
    if (due_after) query = query.gte('due_date', due_after);
    const searchTerm = buildSafeIlikePattern(search);
    if (searchTerm) {
      const term = searchTerm;
      query = query.or(`title.ilike.${term},description.ilike.${term},notes.ilike.${term}`);
    }
    if (source_id) query = query.eq('source_transcript_id', source_id);

    const validSorts = ['priority', 'due_date', 'review_date', 'status', 'title', 'business', 'work_mode', 'approval_state', 'created_at', 'updated_at'];
    const sortField = validSorts.includes(sort_by) ? sort_by : 'priority';
    const direction = sort_dir === 'desc' ? 'DESC' : 'ASC';
    const { limit, offset } = parsePagination(c.req.query() as Record<string, string>);
    const hideBlocked = show_blocked === 'false';
    const asOf = new Date().toISOString();

    if (sortField === 'priority') {
      let results = filterByOwner(annotateBlocked(await loadAllRows(query)), owner_id);
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
      let results = filterByOwner(annotateBlocked(await loadAllRows(query)), owner_id);
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

// GET /:id
router.get('/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data, error } = await supabase.from('atlas_actions').select('*').eq('id', c.req.param('id')).single();
    if (error || !data) return c.json({ error: 'Action not found' }, 404);
    return c.json(data);
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
      tags = [], notes = '', recurrence = 'none', work_mode = null,
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
      .insert({ id, title, description, status, business, priority, due_date, owners: serializeJsonArray(owners), source_transcript_id, source_label, tags: serializeJsonArray(tags), notes, recurrence, work_mode, ...protocolFields, created_at: now, updated_at: now })
      .select().single();

    if (error) throw error;

    await supabase.from('atlas_activity_log').insert({ action_id: id, event: 'created', new_value: title, actor });

    return c.json(action, 201);
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
      if (update.notes !== undefined || appendNote !== undefined || update.description !== undefined || update.tags !== undefined || update.owners !== undefined || update.work_mode !== undefined || PROTOCOL_FIELDS.some(field => update[field] !== undefined)) {
        await supabase.from('atlas_activity_log').insert({ action_id: update.id, event: 'updated', new_value: JSON.stringify(Object.keys(update).filter(k => k !== 'id')), actor });
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
    const { title, description, status, business, priority, due_date, owners, source_transcript_id, source_label, tags, notes, append_note, recurrence, work_mode } = body as Record<string, unknown>;

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
    applyProtocolFields(updates, body);

    const mutableKeys = Object.keys(updates);
    if (mutableKeys.length === 0) return c.json({ error: 'No fields to update' }, 400);

    updates.updated_at = now;

    const { data: action, error: updateErr } = await supabase.from('atlas_actions').update(updates).eq('id', c.req.param('id')).select().single();
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

    return c.json(action);
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
