import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import supabase from '../db.js';
import { validateStringLengths, sanitizeBody, parsePagination } from '../middleware/validate.js';
import { getActor } from '../utils/actors.js';
import { computeNextDueDate, validateActionFields, ACTION_TEXT_FIELDS } from '../utils/actionUtils.js';
import { coerceJsonArray, serializeJsonArray } from '../utils/json.js';
import { validateKnownBusinessId, validateKnownMemberIds } from '../utils/referenceData.js';

const router = Router();
const BULK_MAX = 50;

const PRIORITY_ORDER = { p0: 0, p1: 1, p2: 2, p3: 3 };

function sortByPriority(actions, direction = 'ASC') {
  return actions.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 3;
    const pb = PRIORITY_ORDER[b.priority] ?? 3;
    const cmp = pa - pb;
    if (cmp !== 0) return direction === 'DESC' ? -cmp : cmp;
    // secondary sort by due_date ASC, nulls last
    if (a.due_date === b.due_date) return 0;
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  });
}

function parseBulkPayload(body, key) {
  if (Array.isArray(body)) return body;
  return body?.[key];
}

async function validateActionReferences(action) {
  const errors = [];
  const businessError = await validateKnownBusinessId(action.business);
  if (businessError) errors.push(businessError);
  errors.push(...(await validateKnownMemberIds(action.owners)));
  return errors;
}

function buildNextRecurringAction(existing, incoming, now) {
  const recurrence = incoming.recurrence !== undefined ? incoming.recurrence : existing.recurrence;
  if (incoming.status !== 'done' || existing.status === 'done' || !recurrence || recurrence === 'none') {
    return null;
  }

  const baseDueDate = incoming.due_date !== undefined ? incoming.due_date : existing.due_date;
  const nextDueDate = computeNextDueDate(baseDueDate, recurrence);
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

async function insertRecurringAction(action) {
  await supabase.from('atlas_actions').insert(action);
  await supabase.from('atlas_activity_log').insert({
    action_id: action.id,
    event: 'created',
    new_value: action.title,
    actor: 'system',
  });
}

router.get('/', async (req, res) => {
  try {
    const {
      status, business, priority, owner_id, due_before, due_after, search, source_id, sort_by, sort_dir,
    } = req.query;

    let query = supabase.from('atlas_actions').select('*');

    if (status) {
      const statuses = status.split(',');
      query = query.in('status', statuses);
    }
    if (business) {
      query = query.eq('business', business);
    }
    if (priority) {
      const priorities = priority.split(',');
      query = query.in('priority', priorities);
    }
    if (owner_id) {
      query = query.contains('owners', [owner_id]);
    }
    if (due_before) {
      query = query.lte('due_date', due_before);
    }
    if (due_after) {
      query = query.gte('due_date', due_after);
    }
    if (search) {
      const term = `%${search}%`;
      query = query.or(`title.ilike.${term},description.ilike.${term},notes.ilike.${term}`);
    }
    if (source_id) {
      query = query.eq('source_transcript_id', source_id);
    }

    const validSorts = ['priority', 'due_date', 'status', 'title', 'business', 'created_at', 'updated_at'];
    const sortField = validSorts.includes(sort_by) ? sort_by : 'priority';
    const direction = sort_dir === 'desc' ? 'DESC' : 'ASC';

    const { limit, offset } = parsePagination(req.query);

    if (sortField === 'priority') {
      // Fetch all matching, sort in app, then paginate
      const { data, error } = await query;
      if (error) throw error;
      const sorted = sortByPriority(data || [], direction);
      res.json(sorted.slice(offset, offset + limit));
    } else {
      query = query.order(sortField, { ascending: direction === 'ASC', nullsFirst: false });
      query = query.range(offset, offset + limit - 1);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data || []);
    }
  } catch (err) {
    console.error(`[actions] GET error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const { business } = req.query;
    const { data, error } = await supabase.rpc('atlas_action_stats', {
      business_filter: business || null,
    });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(`[actions] stats error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/by-owner/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('atlas_actions')
      .select('*')
      .contains('owners', [req.params.id]);
    if (error) throw error;

    const sorted = sortByPriority(data || []);
    res.json(sorted);
  } catch (err) {
    console.error(`[actions] by-owner error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('atlas_actions')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Action not found' });

    res.json(data);
  } catch (err) {
    console.error(`[actions] GET/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const body = sanitizeBody(req.body, ACTION_TEXT_FIELDS);
    const actor = getActor(req);
    const {
      title,
      description = '',
      status = 'not_started',
      business,
      priority = 'p2',
      due_date = null,
      owners = [],
      source_transcript_id = null,
      source_label = null,
      tags = [],
      notes = '',
      recurrence = 'none',
    } = body;

    if (!title || !business) {
      return res.status(400).json({ error: 'title and business are required' });
    }

    const validationErrors = [
      ...validateActionFields(body),
      ...(await validateActionReferences(body)),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    const { data: action, error } = await supabase
      .from('atlas_actions')
      .insert({
        id,
        title,
        description,
        status,
        business,
        priority,
        due_date,
        owners: serializeJsonArray(owners),
        source_transcript_id,
        source_label,
        tags: serializeJsonArray(tags),
        notes,
        recurrence,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) throw error;

    await supabase.from('atlas_activity_log').insert({
      action_id: id,
      event: 'created',
      new_value: title,
      actor,
    });

    res.status(201).json(action);
  } catch (err) {
    console.error(`[actions] POST error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/bulk', async (req, res) => {
  try {
    const rawActions = parseBulkPayload(req.body, 'actions');
    if (!Array.isArray(rawActions)) {
      return res.status(400).json({ error: 'actions array required' });
    }
    if (rawActions.length > BULK_MAX) {
      return res.status(400).json({ error: `Bulk operations limited to ${BULK_MAX} items` });
    }

    const actionsList = rawActions.map(item => sanitizeBody(item, ACTION_TEXT_FIELDS));
    for (let i = 0; i < actionsList.length; i += 1) {
      const action = actionsList[i];
      if (!action.title || !action.business) {
        return res.status(400).json({ error: `Item ${i}: title and business are required` });
      }

      const fieldErrors = [
        ...validateActionFields(action),
        ...(await validateActionReferences(action)),
        ...validateStringLengths(action),
      ];
      if (fieldErrors.length > 0) {
        return res.status(400).json({ error: `Item ${i}: ${fieldErrors.join('; ')}` });
      }
    }

    const actor = getActor(req);
    const rows = actionsList.map(action => {
      const id = uuidv4();
      return {
        id,
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
      };
    });

    const { error } = await supabase.from('atlas_actions').insert(rows);
    if (error) throw error;

    const logRows = rows.map(row => ({
      action_id: row.id,
      event: 'created',
      new_value: row.title,
      actor,
    }));
    await supabase.from('atlas_activity_log').insert(logRows);

    res.status(201).json({ created: rows.length, ids: rows.map(r => r.id) });
  } catch (err) {
    console.error(`[actions] POST/bulk error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/bulk', async (req, res) => {
  try {
    const rawUpdates = parseBulkPayload(req.body, 'updates');
    if (!Array.isArray(rawUpdates)) {
      return res.status(400).json({ error: 'updates array required' });
    }
    if (rawUpdates.length > BULK_MAX) {
      return res.status(400).json({ error: `Bulk operations limited to ${BULK_MAX} items` });
    }

    const updates = rawUpdates.map(item => sanitizeBody(item, ACTION_TEXT_FIELDS));
    for (let i = 0; i < updates.length; i += 1) {
      const fieldErrors = [
        ...validateActionFields(updates[i]),
        ...(await validateActionReferences(updates[i])),
        ...validateStringLengths(updates[i]),
      ];
      if (fieldErrors.length > 0) {
        return res.status(400).json({ error: `Item ${i}: ${fieldErrors.join('; ')}` });
      }
      if (updates[i].notes !== undefined && updates[i].append_note !== undefined) {
        return res.status(400).json({ error: `Item ${i}: notes and append_note are mutually exclusive` });
      }
    }

    const actor = getActor(req);
    const now = new Date().toISOString();
    let updatedCount = 0;

    for (const update of updates) {
      const { data: existing, error: fetchErr } = await supabase
        .from('atlas_actions')
        .select('*')
        .eq('id', update.id)
        .single();
      if (fetchErr || !existing) continue;

      const fields = {};
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
      if (appendNote !== undefined) {
        fields.notes = existing.notes ? `${existing.notes}\n\n${appendNote}` : appendNote;
      }
      if (update.recurrence !== undefined) fields.recurrence = update.recurrence;

      if (Object.keys(fields).length === 0) continue;

      if (update.status === 'done' && existing.status !== 'done') {
        fields.completed_at = now;
      } else if (update.status !== undefined && update.status !== 'done' && existing.status === 'done') {
        fields.completed_at = null;
      }

      fields.updated_at = now;

      const { error: updateErr } = await supabase
        .from('atlas_actions')
        .update(fields)
        .eq('id', update.id);
      if (updateErr) throw updateErr;

      if (update.status !== undefined && update.status !== existing.status) {
        await supabase.from('atlas_activity_log').insert({
          action_id: update.id,
          event: 'status_changed',
          old_value: existing.status,
          new_value: update.status,
          actor,
        });
      }
      if (update.priority !== undefined && update.priority !== existing.priority) {
        await supabase.from('atlas_activity_log').insert({
          action_id: update.id,
          event: 'priority_changed',
          old_value: existing.priority,
          new_value: update.priority,
          actor,
        });
      }
      if (update.notes !== undefined || appendNote !== undefined || update.description !== undefined || update.tags !== undefined || update.owners !== undefined) {
        await supabase.from('atlas_activity_log').insert({
          action_id: update.id,
          event: 'updated',
          new_value: JSON.stringify(Object.keys(update).filter(key => key !== 'id')),
          actor,
        });
      }

      const recurringAction = buildNextRecurringAction(existing, update, now);
      if (recurringAction) {
        await insertRecurringAction(recurringAction);
        await supabase.from('atlas_activity_log').insert({
          action_id: update.id,
          event: 'recurrence_spawned',
          new_value: recurringAction.id,
          actor: 'system',
        });
      }

      updatedCount += 1;
    }

    res.json({ updated: updatedCount });
  } catch (err) {
    console.error(`[actions] PUT/bulk error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('atlas_actions')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Action not found' });

    const body = sanitizeBody(req.body, ACTION_TEXT_FIELDS);
    const validationErrors = [
      ...validateActionFields(body),
      ...(await validateActionReferences(body)),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
    }

    const now = new Date().toISOString();
    const actor = getActor(req);
    const {
      title, description, status, business, priority,
      due_date, owners, source_transcript_id, source_label,
      tags, notes, append_note, recurrence,
    } = body;

    if (notes !== undefined && append_note !== undefined) {
      return res.status(400).json({ error: 'notes and append_note are mutually exclusive' });
    }

    const updates = {};
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
    if (mutableKeys.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    if (status === 'done' && existing.status !== 'done') {
      updates.completed_at = now;
    }
    if (status && status !== 'done' && existing.status === 'done') {
      updates.completed_at = null;
    }

    updates.updated_at = now;

    const { data: action, error: updateErr } = await supabase
      .from('atlas_actions')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (updateErr) throw updateErr;

    if (status !== undefined && status !== existing.status) {
      await supabase.from('atlas_activity_log').insert({
        action_id: req.params.id,
        event: 'status_changed',
        old_value: existing.status,
        new_value: status,
        actor,
      });
    }

    if (priority !== undefined && priority !== existing.priority) {
      await supabase.from('atlas_activity_log').insert({
        action_id: req.params.id,
        event: 'priority_changed',
        old_value: existing.priority,
        new_value: priority,
        actor,
      });
    }

    if ((status === undefined || status === existing.status) && (priority === undefined || priority === existing.priority)) {
      await supabase.from('atlas_activity_log').insert({
        action_id: req.params.id,
        event: 'updated',
        new_value: JSON.stringify(mutableKeys),
        actor,
      });
    }

    const recurringAction = buildNextRecurringAction(existing, body, now);
    if (recurringAction) {
      await insertRecurringAction(recurringAction);
      await supabase.from('atlas_activity_log').insert({
        action_id: req.params.id,
        event: 'recurrence_spawned',
        new_value: recurringAction.id,
        actor: 'system',
      });
    }

    res.json(action);
  } catch (err) {
    console.error(`[actions] PUT/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('atlas_actions')
      .select('id')
      .eq('id', req.params.id)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Action not found' });

    await supabase.from('atlas_activity_log').delete().eq('action_id', req.params.id);
    await supabase.from('atlas_actions').delete().eq('id', req.params.id);

    res.json({ deleted: true });
  } catch (err) {
    console.error(`[actions] DELETE error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
