import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, getDb } from '../db';
import { validateStringLengths, sanitizeBody, parsePagination } from '../middleware/validate';
import { getActor } from '../utils/actors';
import { computeNextDueDate, validateActionFields, ACTION_TEXT_FIELDS } from '../utils/actionUtils';
import { coerceJsonArray, serializeJsonArray } from '../utils/json';
import { validateKnownBusinessId, validateKnownMemberIds } from '../utils/referenceData';

const router = new Hono<{ Bindings: Env }>();
const BULK_MAX = 50;
const PRIORITY_ORDER: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

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

// GET /
router.get('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { status, business, priority, owner_id, due_before, due_after, search, source_id, sort_by, sort_dir, show_blocked } = c.req.query() as Record<string, string>;

    let query = supabase.from('atlas_actions').select('*');

    if (status) query = query.in('status', status.split(','));
    if (business) query = query.eq('business', business);
    if (priority) query = query.in('priority', priority.split(','));
    if (owner_id) query = query.contains('owners', [owner_id]);
    if (due_before) query = query.lte('due_date', due_before);
    if (due_after) query = query.gte('due_date', due_after);
    if (search) {
      const term = `%${search}%`;
      query = query.or(`title.ilike.${term},description.ilike.${term},notes.ilike.${term}`);
    }
    if (source_id) query = query.eq('source_transcript_id', source_id);

    const validSorts = ['priority', 'due_date', 'status', 'title', 'business', 'created_at', 'updated_at'];
    const sortField = validSorts.includes(sort_by) ? sort_by : 'priority';
    const direction = sort_dir === 'desc' ? 'DESC' : 'ASC';
    const { limit, offset } = parsePagination(c.req.query() as Record<string, string>);
    const hideBlocked = show_blocked !== 'true';

    if (sortField === 'priority') {
      const { data, error } = await query;
      if (error) throw error;
      let results = annotateBlocked((data || []) as Record<string, unknown>[]);
      if (hideBlocked) results = results.filter(a => !a.is_blocked);
      const sorted = sortByPriority(results, direction);
      return c.json(sorted.slice(offset, offset + limit));
    } else {
      query = query.order(sortField, { ascending: direction === 'ASC', nullsFirst: false });
      const { data, error } = await query;
      if (error) throw error;
      let results = annotateBlocked((data || []) as Record<string, unknown>[]);
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

// POST /
router.post('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    const rawBody = await c.req.json();
    const body = sanitizeBody(rawBody, ACTION_TEXT_FIELDS);
    const actor = getActor(c);
    const {
      title, description = '', status = 'not_started', business, priority = 'p2',
      due_date = null, owners = [], source_transcript_id = null, source_label = null,
      tags = [], notes = '', recurrence = 'none',
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

    const { data: action, error } = await supabase
      .from('atlas_actions')
      .insert({ id, title, description, status, business, priority, due_date, owners: serializeJsonArray(owners), source_transcript_id, source_label, tags: serializeJsonArray(tags), notes, recurrence, created_at: now, updated_at: now })
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

    const actionsList = rawActions.map((item: unknown) => sanitizeBody(item as Record<string, unknown>, ACTION_TEXT_FIELDS));
    for (let i = 0; i < actionsList.length; i++) {
      const action = actionsList[i];
      if (!action.title || !action.business) return c.json({ error: `Item ${i}: title and business are required` }, 400);
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
      owners: serializeJsonArray(action.owners),
      source_transcript_id: action.source_transcript_id || null,
      source_label: action.source_label || null,
      tags: serializeJsonArray(action.tags),
      notes: action.notes || '',
      recurrence: action.recurrence || 'none',
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

    const updates = rawUpdates.map((item: unknown) => sanitizeBody(item as Record<string, unknown>, ACTION_TEXT_FIELDS));
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

      if (Object.keys(fields).length === 0) continue;

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
      if (update.notes !== undefined || appendNote !== undefined || update.description !== undefined || update.tags !== undefined || update.owners !== undefined) {
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
    const body = sanitizeBody(rawBody, ACTION_TEXT_FIELDS);

    const validationErrors = [
      ...validateActionFields(body),
      ...(await validateActionReferences(supabase, body)),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) return c.json({ error: validationErrors.join('; ') }, 400);

    const now = new Date().toISOString();
    const actor = getActor(c);
    const { title, description, status, business, priority, due_date, owners, source_transcript_id, source_label, tags, notes, append_note, recurrence } = body as Record<string, unknown>;

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

    const mutableKeys = Object.keys(updates);
    if (mutableKeys.length === 0) return c.json({ error: 'No fields to update' }, 400);

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
