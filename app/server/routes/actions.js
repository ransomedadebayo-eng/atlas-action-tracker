import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { validateStringLengths, sanitizeBody, parsePagination } from '../middleware/validate.js';
import { getActor } from '../utils/actors.js';
import { computeNextDueDate, validateActionFields, ACTION_TEXT_FIELDS } from '../utils/actionUtils.js';
import { coerceJsonArray, serializeJsonArray, sqlJsonArray } from '../utils/json.js';
import { validateKnownBusinessId, validateKnownMemberIds } from '../utils/referenceData.js';

const router = Router();
const BULK_MAX = 50;
const OWNERS_JSON_SQL = sqlJsonArray('owners');

function toActionResponse(action) {
  return {
    ...action,
    owners: coerceJsonArray(action.owners),
    tags: coerceJsonArray(action.tags),
  };
}

function parseBulkPayload(body, key) {
  if (Array.isArray(body)) return body;
  return body?.[key];
}

function validateActionReferences(action) {
  const errors = [];
  const businessError = validateKnownBusinessId(action.business);
  if (businessError) errors.push(businessError);
  errors.push(...validateKnownMemberIds(action.owners));
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
    owners: incoming.owners !== undefined ? incoming.owners : coerceJsonArray(existing.owners),
    source_transcript_id: incoming.source_transcript_id !== undefined ? incoming.source_transcript_id : existing.source_transcript_id,
    source_label: incoming.source_label !== undefined ? incoming.source_label : existing.source_label,
    tags: incoming.tags !== undefined ? incoming.tags : coerceJsonArray(existing.tags),
    notes: '',
    recurrence,
    created_at: now,
    updated_at: now,
  };
}

function insertRecurringAction(action) {
  db.prepare(`
    INSERT INTO actions (id, title, description, status, business, priority, due_date, owners, source_transcript_id, source_label, tags, notes, recurrence, created_at, updated_at)
    VALUES (?, ?, ?, 'not_started', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    action.id,
    action.title,
    action.description,
    action.business,
    action.priority,
    action.due_date,
    serializeJsonArray(action.owners),
    action.source_transcript_id,
    action.source_label,
    serializeJsonArray(action.tags),
    action.notes,
    action.recurrence,
    action.created_at,
    action.updated_at,
  );

  db.prepare(`
    INSERT INTO activity_log (action_id, event, new_value, actor)
    VALUES (?, 'created', ?, 'system')
  `).run(action.id, action.title);
}

router.get('/', (req, res) => {
  try {
    const {
      status, business, priority, owner_id, due_before, due_after, search, source_id, sort_by, sort_dir,
    } = req.query;

    let sql = 'SELECT * FROM actions WHERE 1=1';
    const params = [];

    if (status) {
      const statuses = status.split(',');
      sql += ` AND status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }
    if (business) {
      sql += ' AND business = ?';
      params.push(business);
    }
    if (priority) {
      const priorities = priority.split(',');
      sql += ` AND priority IN (${priorities.map(() => '?').join(',')})`;
      params.push(...priorities);
    }
    if (owner_id) {
      sql += ` AND EXISTS (SELECT 1 FROM json_each(${OWNERS_JSON_SQL}) WHERE value = ?)`;
      params.push(owner_id);
    }
    if (due_before) {
      sql += ' AND due_date <= ?';
      params.push(due_before);
    }
    if (due_after) {
      sql += ' AND due_date >= ?';
      params.push(due_after);
    }
    if (search) {
      sql += ' AND (title LIKE ? OR description LIKE ? OR notes LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term);
    }
    if (source_id) {
      sql += ' AND source_transcript_id = ?';
      params.push(source_id);
    }

    const validSorts = ['priority', 'due_date', 'status', 'title', 'business', 'created_at', 'updated_at'];
    const sortField = validSorts.includes(sort_by) ? sort_by : 'priority';
    const direction = sort_dir === 'desc' ? 'DESC' : 'ASC';

    if (sortField === 'priority') {
      sql += ` ORDER BY CASE priority WHEN 'p0' THEN 0 WHEN 'p1' THEN 1 WHEN 'p2' THEN 2 ELSE 3 END ${direction}, due_date ASC NULLS LAST`;
    } else {
      sql += ` ORDER BY ${sortField} ${direction} NULLS LAST`;
    }

    const { limit, offset } = parsePagination(req.query);
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const actions = db.prepare(sql).all(...params);
    res.json(actions.map(toActionResponse));
  } catch (err) {
    console.error(`[actions] GET error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/stats', (req, res) => {
  try {
    const { business } = req.query;
    let whereClause = '';
    const params = [];
    if (business) {
      whereClause = ' WHERE business = ?';
      params.push(business);
    }

    const byStatus = db.prepare(`SELECT status, COUNT(*) AS count FROM actions${whereClause} GROUP BY status`).all(...params);

    const filteredParams = business ? [business] : [];
    const filteredWhere = business ? ' AND business = ?' : '';
    const overdue = db.prepare(`SELECT COUNT(*) AS count FROM actions WHERE due_date < date('now') AND status NOT IN ('done','blocked')${filteredWhere}`).get(...filteredParams);
    const completedThisWeek = db.prepare(`SELECT COUNT(*) AS count FROM actions WHERE status = 'done' AND completed_at >= date('now', '-7 days')${filteredWhere}`).get(...filteredParams);
    const pendingTranscripts = db.prepare(`SELECT COUNT(*) AS count FROM transcripts WHERE status = 'pending'`).get();
    const byBusiness = db.prepare(`SELECT business, COUNT(*) AS count FROM actions WHERE status != 'done' GROUP BY business`).all();
    const byPriority = db.prepare(`SELECT priority, COUNT(*) AS count FROM actions WHERE status != 'done'${filteredWhere} GROUP BY priority`).all(...filteredParams);
    const totalActive = db.prepare(`SELECT COUNT(*) AS count FROM actions WHERE status NOT IN ('done')${filteredWhere}`).get(...filteredParams);
    const blocked = db.prepare(`SELECT COUNT(*) AS count FROM actions WHERE status = 'blocked'${filteredWhere}`).get(...filteredParams);

    res.json({
      totalActive: totalActive.count,
      overdue: overdue.count,
      completedThisWeek: completedThisWeek.count,
      blocked: blocked.count,
      pendingReview: pendingTranscripts.count,
      byStatus,
      byBusiness,
      byPriority,
    });
  } catch (err) {
    console.error(`[actions] stats error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/by-owner/:id', (req, res) => {
  try {
    const actions = db.prepare(`
      SELECT * FROM actions
      WHERE EXISTS (SELECT 1 FROM json_each(${OWNERS_JSON_SQL}) WHERE value = ?)
      ORDER BY CASE priority WHEN 'p0' THEN 0 WHEN 'p1' THEN 1 WHEN 'p2' THEN 2 ELSE 3 END, due_date ASC
    `).all(req.params.id);

    res.json(actions.map(toActionResponse));
  } catch (err) {
    console.error(`[actions] by-owner error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(req.params.id);
    if (!action) return res.status(404).json({ error: 'Action not found' });

    res.json(toActionResponse(action));
  } catch (err) {
    console.error(`[actions] GET/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', (req, res) => {
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
      ...validateActionReferences(body),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
    }

    const id = uuidv4();
    const now = new Date().toISOString().replace('T', ' ').split('.')[0];

    db.prepare(`
      INSERT INTO actions (id, title, description, status, business, priority, due_date, owners, source_transcript_id, source_label, tags, notes, recurrence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      title,
      description,
      status,
      business,
      priority,
      due_date,
      serializeJsonArray(owners),
      source_transcript_id,
      source_label,
      serializeJsonArray(tags),
      notes,
      recurrence,
      now,
      now,
    );

    db.prepare(`
      INSERT INTO activity_log (action_id, event, new_value, actor)
      VALUES (?, 'created', ?, ?)
    `).run(id, title, actor);

    const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(id);
    res.status(201).json(toActionResponse(action));
  } catch (err) {
    console.error(`[actions] POST error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/bulk', (req, res) => {
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
        ...validateActionReferences(action),
        ...validateStringLengths(action),
      ];
      if (fieldErrors.length > 0) {
        return res.status(400).json({ error: `Item ${i}: ${fieldErrors.join('; ')}` });
      }
    }

    const actor = getActor(req);
    const insertStmt = db.prepare(`
      INSERT INTO actions (id, title, description, status, business, priority, due_date, owners, source_transcript_id, source_label, tags, notes, recurrence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const logStmt = db.prepare(`
      INSERT INTO activity_log (action_id, event, new_value, actor)
      VALUES (?, 'created', ?, ?)
    `);

    const created = [];
    const bulkInsert = db.transaction(() => {
      for (const action of actionsList) {
        const id = uuidv4();
        insertStmt.run(
          id,
          action.title,
          action.description || '',
          action.status || 'not_started',
          action.business,
          action.priority || 'p2',
          action.due_date || null,
          serializeJsonArray(action.owners),
          action.source_transcript_id || null,
          action.source_label || null,
          serializeJsonArray(action.tags),
          action.notes || '',
          action.recurrence || 'none',
        );
        logStmt.run(id, action.title, actor);
        created.push(id);
      }
    });
    bulkInsert();

    res.status(201).json({ created: created.length, ids: created });
  } catch (err) {
    console.error(`[actions] POST/bulk error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/bulk', (req, res) => {
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
        ...validateActionReferences(updates[i]),
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
    const now = new Date().toISOString().replace('T', ' ').split('.')[0];
    let updatedCount = 0;

    const bulkUpdate = db.transaction(() => {
      for (const update of updates) {
        const existing = db.prepare('SELECT * FROM actions WHERE id = ?').get(update.id);
        if (!existing) continue;

        const fields = [];
        const values = [];
        const appendNote = update.append_note;

        if (update.status !== undefined) { fields.push('status = ?'); values.push(update.status); }
        if (update.priority !== undefined) { fields.push('priority = ?'); values.push(update.priority); }
        if (update.title !== undefined) { fields.push('title = ?'); values.push(update.title); }
        if (update.description !== undefined) { fields.push('description = ?'); values.push(update.description); }
        if (update.due_date !== undefined) { fields.push('due_date = ?'); values.push(update.due_date); }
        if (update.owners !== undefined) { fields.push('owners = ?'); values.push(serializeJsonArray(update.owners)); }
        if (update.business !== undefined) { fields.push('business = ?'); values.push(update.business); }
        if (update.source_transcript_id !== undefined) { fields.push('source_transcript_id = ?'); values.push(update.source_transcript_id); }
        if (update.source_label !== undefined) { fields.push('source_label = ?'); values.push(update.source_label); }
        if (update.tags !== undefined) { fields.push('tags = ?'); values.push(serializeJsonArray(update.tags)); }
        if (update.notes !== undefined) { fields.push('notes = ?'); values.push(update.notes); }
        if (appendNote !== undefined) {
          fields.push('notes = ?');
          values.push(existing.notes ? `${existing.notes}\n\n${appendNote}` : appendNote);
        }
        if (update.recurrence !== undefined) { fields.push('recurrence = ?'); values.push(update.recurrence); }

        if (fields.length === 0) continue;

        if (update.status === 'done' && existing.status !== 'done') {
          fields.push('completed_at = ?');
          values.push(now);
        } else if (update.status !== undefined && update.status !== 'done' && existing.status === 'done') {
          fields.push('completed_at = ?');
          values.push(null);
        }

        fields.push('updated_at = ?');
        values.push(now, update.id);

        db.prepare(`UPDATE actions SET ${fields.join(', ')} WHERE id = ?`).run(...values);

        if (update.status !== undefined && update.status !== existing.status) {
          db.prepare(`
            INSERT INTO activity_log (action_id, event, old_value, new_value, actor)
            VALUES (?, 'status_changed', ?, ?, ?)
          `).run(update.id, existing.status, update.status, actor);
        }
        if (update.priority !== undefined && update.priority !== existing.priority) {
          db.prepare(`
            INSERT INTO activity_log (action_id, event, old_value, new_value, actor)
            VALUES (?, 'priority_changed', ?, ?, ?)
          `).run(update.id, existing.priority, update.priority, actor);
        }
        if (update.notes !== undefined || appendNote !== undefined || update.description !== undefined || update.tags !== undefined || update.owners !== undefined) {
          db.prepare(`
            INSERT INTO activity_log (action_id, event, new_value, actor)
            VALUES (?, 'updated', ?, ?)
          `).run(update.id, JSON.stringify(Object.keys(update).filter(key => key !== 'id')), actor);
        }

        const recurringAction = buildNextRecurringAction(existing, update, now);
        if (recurringAction) {
          insertRecurringAction(recurringAction);
          db.prepare(`
            INSERT INTO activity_log (action_id, event, new_value, actor)
            VALUES (?, 'recurrence_spawned', ?, 'system')
          `).run(update.id, recurringAction.id);
        }

        updatedCount += 1;
      }
    });
    bulkUpdate();

    res.json({ updated: updatedCount });
  } catch (err) {
    console.error(`[actions] PUT/bulk error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM actions WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Action not found' });

    const body = sanitizeBody(req.body, ACTION_TEXT_FIELDS);
    const validationErrors = [
      ...validateActionFields(body),
      ...validateActionReferences(body),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
    }

    const now = new Date().toISOString().replace('T', ' ').split('.')[0];
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

    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), req.params.id];

    const updateTx = db.transaction(() => {
      db.prepare(`UPDATE actions SET ${fields} WHERE id = ?`).run(...values);

      if (status !== undefined && status !== existing.status) {
        db.prepare(`
          INSERT INTO activity_log (action_id, event, old_value, new_value, actor)
          VALUES (?, 'status_changed', ?, ?, ?)
        `).run(req.params.id, existing.status, status, actor);
      }

      if (priority !== undefined && priority !== existing.priority) {
        db.prepare(`
          INSERT INTO activity_log (action_id, event, old_value, new_value, actor)
          VALUES (?, 'priority_changed', ?, ?, ?)
        `).run(req.params.id, existing.priority, priority, actor);
      }

      if ((status === undefined || status === existing.status) && (priority === undefined || priority === existing.priority)) {
        db.prepare(`
          INSERT INTO activity_log (action_id, event, new_value, actor)
          VALUES (?, 'updated', ?, ?)
        `).run(req.params.id, JSON.stringify(mutableKeys), actor);
      }

      const recurringAction = buildNextRecurringAction(existing, body, now);
      if (recurringAction) {
        insertRecurringAction(recurringAction);
        db.prepare(`
          INSERT INTO activity_log (action_id, event, new_value, actor)
          VALUES (?, 'recurrence_spawned', ?, 'system')
        `).run(req.params.id, recurringAction.id);
      }
    });
    updateTx();

    const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(req.params.id);
    res.json(toActionResponse(action));
  } catch (err) {
    console.error(`[actions] PUT/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM actions WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Action not found' });

    db.prepare('DELETE FROM activity_log WHERE action_id = ?').run(req.params.id);
    db.prepare('DELETE FROM actions WHERE id = ?').run(req.params.id);

    res.json({ deleted: true });
  } catch (err) {
    console.error(`[actions] DELETE error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
