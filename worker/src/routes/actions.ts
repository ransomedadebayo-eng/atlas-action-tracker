import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, getDb } from '../db';
import { validateStringLengths, sanitizeBody, parsePagination } from '../middleware/validate';
import { getActor } from '../utils/actors';
import { computeNextDueDate, validateActionFields, ACTION_TEXT_FIELDS, coerceActionBody } from '../utils/actionUtils';
import { coerceJsonArray, serializeJsonArray, serializeJsonObject } from '../utils/json';
import { validateKnownBusinessId, validateKnownMemberIds } from '../utils/referenceData';
import { buildSafeIlikePattern } from '../utils/search';

const router = new Hono<{ Bindings: Env }>();
const BULK_MAX = 50;
const COMPLETION_EVIDENCE_ERROR = 'Add a completion note or proof before marking an action done.';
const PRIORITY_ORDER: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };
const PROTOCOL_FIELDS = [
  'next_action',
  'definition_of_done',
  'review_date',
  'evidence_json',
  'agent_assignment_id',
  'approval_state',
];

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

function hasEvidence(action: Record<string, unknown>): boolean {
  const evidence = action.evidence_json;
  return !!evidence && typeof evidence === 'object' && !Array.isArray(evidence) && Object.keys(evidence).length > 0;
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
  const workModes = workMode.split(',').filter(Boolean);
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

function buildNextRecurringAction(existing: Record<string, unknown>, incoming: Record<string, unknown>, now: string) {
  const recurrence = incoming.recurrence !== undefined ? incoming.recurrence : existing.recurrence;
  if (incoming.status !== 'done' || existing.status === 'done' || !recurrence || recurrence === 'none') return null;

  const baseDueDate = incoming.due_date !== undefined ? incoming.due_date as string : existing.due_date as string;
  const nextDueDate = computeNextDueDate(baseDueDate, recurrence as string);
  if (!nextDueDate) return null;

  return {
    id: uuidv4(),
    title: incoming.title !== undefined ? incoming.title : existing.title,
    description: incoming.description !== undefined ? incoming.description : (existing.description || ''),
    business: incoming.business !== undefined ? incoming.business : existing.business,
    priority: incoming.priority !== undefined ? incoming.priority : existing.priority,
    due_date: nextDueDate,
    owners: incoming.owners !== undefined ? serializeJsonArray(incoming.owners) : coerceJsonArray(existing.owners),
    source_transcript_id: incoming.source_transcript_id !== undefined ? incoming.source_transcript_id : existing.source_transcript_id,
    source_label: incoming.source_label !== undefined ? incoming.source_label : existing.source_label,
    tags: incoming.tags !== undefined ? serializeJsonArray(incoming.tags) : coerceJsonArray(existing.tags),
    notes: '',
    recurrence,
    work_mode: incoming.work_mode !== undefined ? incoming.work_mode : existing.work_mode,
    status: 'not_started',
    created_at: now,
    updated_at: now,
  };
}

async function insertRecurringAction(supabase: ReturnType<typeof getDb>, action: Record<string, unknown>) {
  await supabase.from('atlas_actions').insert(action);
  await supabase.from('atlas_activity_log').insert({
    action_id: action.id,
    event: 'created',
    new_value: action.title,
    actor: 'system',
  });
}

function isBlocked(action: Record<string, unknown>): boolean {
  const deps = action.blocked_by;
  if (!deps || !Array.isArray(deps)) return false;
  return deps.length > 0;
}

function annotateBlocked(actions: Record<string, unknown>[]): Record<string, unknown>[] {
  return actions.map(a => ({ ...a, is_blocked: isBlocked(a) }));
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
    if (owner_id) query = query.contains('owners', [owner_id]);
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
    const hideBlocked = show_blocked !== 'true';

    if (sortField === 'priority') {
      const { data, error } = await query;
      if (error) throw error;
      let results = annotateBlocked((data || []) as Record<string, unknown>[]);
      if (stewardship === 'stale') results = results.filter(action => isProtocolStale(action, new Date().toISOString().slice(0, 10)));
      if (hideBlocked) results = results.filter(a => !a.is_blocked);
      const sorted = sortByPriority(results, direction);
      return c.json(sorted.slice(offset, offset + limit));
    } else {
      query = query.order(sortField, { ascending: direction === 'ASC', nullsFirst: false });
      const { data, error } = await query;
      if (error) throw error;
      let results = annotateBlocked((data || []) as Record<string, unknown>[]);
      if (stewardship === 'stale') results = results.filter(action => isProtocolStale(action, new Date().toISOString().slice(0, 10)));
      if (hideBlocked) results = results.filter(a => !a.is_blocked);
      return c.json(results.slice(offset, offset + limit));
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
    const { data, error } = await supabase.rpc('atlas_action_stats', { business_filter: business || null });
    if (error) throw error;
    return c.json(data);
  } catch (err) {
    console.error(`[actions] stats error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /by-owner/:id
router.get('/by-owner/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data, error } = await supabase.from('atlas_actions').select('*').contains('owners', [c.req.param('id')]);
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
      due_date = null, owners = [], source_transcript_id = null, source_label = null,
      tags = [], notes = '', recurrence = 'none', work_mode = null,
    } = body as Record<string, unknown>;

    if (!title || !business) return c.json({ error: 'title and business are required' }, 400);

    const validationErrors = [
      ...validateActionFields(body),
      ...(await validateActionReferences(supabase, body)),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) return c.json({ error: validationErrors.join('; ') }, 400);

    const id = uuidv4();
    const now = new Date().toISOString();

    if (status === 'done' && !hasEvidence(body)) {
      return c.json({ error: COMPLETION_EVIDENCE_ERROR }, 400);
    }

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
      const fieldErrors = [
        ...validateActionFields(action),
        ...(await validateActionReferences(supabase, action)),
        ...validateStringLengths(action),
      ];
      if (fieldErrors.length > 0) return c.json({ error: `Item ${i}: ${fieldErrors.join('; ')}` }, 400);
      if (action.status === 'done' && !hasEvidence(action)) {
        return c.json({ error: `Item ${i}: ${COMPLETION_EVIDENCE_ERROR}` }, 400);
      }
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
      owners: serializeJsonArray(action.owners),
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

      if (update.status === 'done' && existing.status !== 'done') {
        const merged = { ...existing, ...fields };
        if (!hasEvidence(merged)) {
          return c.json({ error: `Item ${update.id}: ${COMPLETION_EVIDENCE_ERROR}` }, 400);
        }
      }

      if (update.status === 'done' && existing.status !== 'done') fields.completed_at = now;
      else if (update.status !== undefined && update.status !== 'done' && existing.status === 'done') fields.completed_at = null;

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

      const recurringAction = buildNextRecurringAction(existing, update, now);
      if (recurringAction) {
        await insertRecurringAction(supabase, recurringAction);
        await supabase.from('atlas_activity_log').insert({ action_id: update.id, event: 'recurrence_spawned', new_value: recurringAction.id, actor: 'system' });
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

    if (status === 'done' && existing.status !== 'done') {
      const merged = { ...existing, ...updates };
      if (!hasEvidence(merged)) {
        return c.json({ error: COMPLETION_EVIDENCE_ERROR }, 400);
      }
    }

    if (status === 'done' && existing.status !== 'done') updates.completed_at = now;
    if (status && status !== 'done' && existing.status === 'done') updates.completed_at = null;
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

    const recurringAction = buildNextRecurringAction(existing, body, now);
    if (recurringAction) {
      await insertRecurringAction(supabase, recurringAction);
      await supabase.from('atlas_activity_log').insert({ action_id: c.req.param('id'), event: 'recurrence_spawned', new_value: recurringAction.id, actor: 'system' });
    }

    return c.json(action);
  } catch (err) {
    console.error(`[actions] PUT/:id error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// DELETE /:id
router.delete('/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data: existing, error: fetchErr } = await supabase.from('atlas_actions').select('id').eq('id', c.req.param('id')).single();
    if (fetchErr || !existing) return c.json({ error: 'Action not found' }, 404);

    await supabase.from('atlas_activity_log').delete().eq('action_id', c.req.param('id'));
    await supabase.from('atlas_actions').delete().eq('id', c.req.param('id'));

    return c.json({ deleted: true });
  } catch (err) {
    console.error(`[actions] DELETE error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default router;
