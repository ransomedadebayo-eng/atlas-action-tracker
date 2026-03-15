import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { validateStringLengths, sanitizeBody, parsePagination } from '../middleware/validate.js';

const router = Router();
const TEXT_FIELDS = ['title', 'description', 'notes', 'source_label'];

// --- Validation helpers ---
const VALID_STATUSES = ['not_started', 'in_progress', 'waiting', 'blocked', 'done'];
const VALID_PRIORITIES = ['p0', 'p1', 'p2', 'p3'];
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const BULK_MAX = 50;

function validateActionFields(body, isUpdate = false) {
  const errors = [];

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) {
      errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    }
  }

  if (body.priority !== undefined) {
    if (!VALID_PRIORITIES.includes(body.priority)) {
      errors.push(`priority must be one of: ${VALID_PRIORITIES.join(', ')}`);
    }
  }

  if (body.due_date !== undefined && body.due_date !== null) {
    if (typeof body.due_date !== 'string' || !DATE_REGEX.test(body.due_date)) {
      errors.push('due_date must be in YYYY-MM-DD format or null');
    }
  }

  if (body.owners !== undefined) {
    if (!Array.isArray(body.owners) || !body.owners.every(o => typeof o === 'string')) {
      errors.push('owners must be an array of strings');
    }
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || !body.tags.every(t => typeof t === 'string')) {
      errors.push('tags must be an array of strings');
    }
  }

  return errors;
}

// GET /api/actions — List with filters
router.get('/', (req, res) => {
  try {
    const { status, business, priority, owner_id, due_before, due_after, search, source_id, sort_by, sort_dir } = req.query;

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
      sql += ` AND EXISTS (SELECT 1 FROM json_each(owners) WHERE value = ?)`;
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

    // Sorting
    const validSorts = ['priority', 'due_date', 'status', 'title', 'business', 'created_at', 'updated_at'];
    const sortField = validSorts.includes(sort_by) ? sort_by : 'priority';
    const direction = sort_dir === 'desc' ? 'DESC' : 'ASC';

    if (sortField === 'priority') {
      sql += ` ORDER BY CASE priority WHEN 'p0' THEN 0 WHEN 'p1' THEN 1 WHEN 'p2' THEN 2 ELSE 3 END ${direction}, due_date ASC NULLS LAST`;
    } else {
      sql += ` ORDER BY ${sortField} ${direction} NULLS LAST`;
    }

    // Pagination
    const { limit, offset } = parsePagination(req.query);
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const actions = db.prepare(sql).all(...params);

    // Parse JSON fields
    const parsed = actions.map(a => ({
      ...a,
      owners: JSON.parse(a.owners || '[]'),
      tags: JSON.parse(a.tags || '[]'),
    }));

    res.json(parsed);
  } catch (err) {
    console.error(`[actions] GET error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/actions/stats — Dashboard stats
router.get('/stats', (req, res) => {
  try {
    const { business } = req.query;
    let whereClause = '';
    const params = [];
    if (business) {
      whereClause = ' WHERE business = ?';
      params.push(business);
    }

    const byStatus = db.prepare(`SELECT status, COUNT(*) as count FROM actions${whereClause} GROUP BY status`).all(...params);

    const overdueParams = business ? [business] : [];
    const overdueWhere = business ? ' AND business = ?' : '';
    const overdue = db.prepare(`SELECT COUNT(*) as count FROM actions WHERE due_date < date('now') AND status NOT IN ('done','blocked')${overdueWhere}`).get(...overdueParams);

    const completedThisWeek = db.prepare(`SELECT COUNT(*) as count FROM actions WHERE status = 'done' AND completed_at >= date('now', '-7 days')${overdueWhere}`).get(...overdueParams);

    const pendingTranscripts = db.prepare(`SELECT COUNT(*) as count FROM transcripts WHERE status = 'pending'`).get();

    const byBusiness = db.prepare(`SELECT business, COUNT(*) as count FROM actions WHERE status != 'done' GROUP BY business`).all();

    const byPriority = db.prepare(`SELECT priority, COUNT(*) as count FROM actions WHERE status != 'done'${overdueWhere} GROUP BY priority`).all(...overdueParams);

    // Total active
    const totalActive = db.prepare(`SELECT COUNT(*) as count FROM actions WHERE status NOT IN ('done')${overdueWhere}`).get(...overdueParams);

    // Blocked count
    const blocked = db.prepare(`SELECT COUNT(*) as count FROM actions WHERE status = 'blocked'${overdueWhere}`).get(...overdueParams);

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

// GET /api/actions/by-owner/:id — Actions for a specific owner
router.get('/by-owner/:id', (req, res) => {
  try {
    const actions = db.prepare(`
      SELECT * FROM actions
      WHERE EXISTS (SELECT 1 FROM json_each(owners) WHERE value = ?)
      ORDER BY CASE priority WHEN 'p0' THEN 0 WHEN 'p1' THEN 1 WHEN 'p2' THEN 2 ELSE 3 END, due_date ASC
    `).all(req.params.id);

    const parsed = actions.map(a => ({
      ...a,
      owners: JSON.parse(a.owners || '[]'),
      tags: JSON.parse(a.tags || '[]'),
    }));

    res.json(parsed);
  } catch (err) {
    console.error(`[actions] by-owner error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/actions/:id — Single action
router.get('/:id', (req, res) => {
  try {
    const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(req.params.id);
    if (!action) return res.status(404).json({ error: 'Action not found' });

    action.owners = JSON.parse(action.owners || '[]');
    action.tags = JSON.parse(action.tags || '[]');

    res.json(action);
  } catch (err) {
    console.error(`[actions] GET/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions — Create action
router.post('/', (req, res) => {
  try {
    const body = sanitizeBody(req.body, TEXT_FIELDS);
    const {
      title, description = '', status = 'not_started', business,
      priority = 'p2', due_date = null, owners = [], source_transcript_id = null,
      source_label = null, tags = [], notes = ''
    } = body;

    if (!title || !business) {
      return res.status(400).json({ error: 'title and business are required' });
    }

    // Validate fields
    const validationErrors = [
      ...validateActionFields(body),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
    }

    const id = uuidv4();
    const now = new Date().toISOString().replace('T', ' ').split('.')[0];

    db.prepare(`
      INSERT INTO actions (id, title, description, status, business, priority, due_date, owners, source_transcript_id, source_label, tags, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, title, description, status, business, priority, due_date,
      JSON.stringify(owners), source_transcript_id, source_label,
      JSON.stringify(tags), notes, now, now);

    db.prepare(`
      INSERT INTO activity_log (action_id, event, new_value, actor) VALUES (?, 'created', ?, 'user')
    `).run(id, title);

    const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(id);
    action.owners = JSON.parse(action.owners || '[]');
    action.tags = JSON.parse(action.tags || '[]');

    res.status(201).json(action);
  } catch (err) {
    console.error(`[actions] POST error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/actions/bulk — Bulk create
router.post('/bulk', (req, res) => {
  try {
    const { actions: actionsList } = req.body;
    if (!Array.isArray(actionsList)) {
      return res.status(400).json({ error: 'actions array required' });
    }

    // Enforce array size limit
    if (actionsList.length > BULK_MAX) {
      return res.status(400).json({ error: `Bulk operations limited to ${BULK_MAX} items` });
    }

    // Validate each item
    for (let i = 0; i < actionsList.length; i++) {
      const a = actionsList[i];
      if (!a.title || !a.business) {
        return res.status(400).json({ error: `Item ${i}: title and business are required` });
      }
      const fieldErrors = validateActionFields(a);
      if (fieldErrors.length > 0) {
        return res.status(400).json({ error: `Item ${i}: ${fieldErrors.join('; ')}` });
      }
    }

    const insertStmt = db.prepare(`
      INSERT INTO actions (id, title, description, status, business, priority, due_date, owners, source_transcript_id, source_label, tags, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const logStmt = db.prepare(`
      INSERT INTO activity_log (action_id, event, new_value, actor) VALUES (?, 'created', ?, 'user')
    `);

    const created = [];
    const bulkInsert = db.transaction(() => {
      for (const a of actionsList) {
        // Always generate server-side UUID; ignore any client-supplied id
        const id = uuidv4();
        insertStmt.run(
          id, a.title, a.description || '', a.status || 'not_started',
          a.business, a.priority || 'p2', a.due_date || null,
          JSON.stringify(a.owners || []), a.source_transcript_id || null,
          a.source_label || null, JSON.stringify(a.tags || []), a.notes || ''
        );
        logStmt.run(id, a.title);
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

// PUT /api/actions/bulk — Bulk update
router.put('/bulk', (req, res) => {
  try {
    const { updates } = req.body;
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: 'updates array required' });
    }

    // Enforce array size limit
    if (updates.length > BULK_MAX) {
      return res.status(400).json({ error: `Bulk operations limited to ${BULK_MAX} items` });
    }

    // Validate each item
    for (let i = 0; i < updates.length; i++) {
      const fieldErrors = validateActionFields(updates[i], true);
      if (fieldErrors.length > 0) {
        return res.status(400).json({ error: `Item ${i}: ${fieldErrors.join('; ')}` });
      }
    }

    const now = new Date().toISOString().replace('T', ' ').split('.')[0];
    let updatedCount = 0;

    const bulkUpdate = db.transaction(() => {
      for (const u of updates) {
        const existing = db.prepare('SELECT * FROM actions WHERE id = ?').get(u.id);
        if (!existing) continue;

        const fields = [];
        const vals = [];

        if (u.status !== undefined) { fields.push('status = ?'); vals.push(u.status); }
        if (u.priority !== undefined) { fields.push('priority = ?'); vals.push(u.priority); }
        if (u.title !== undefined) { fields.push('title = ?'); vals.push(u.title); }
        if (u.due_date !== undefined) { fields.push('due_date = ?'); vals.push(u.due_date); }
        if (u.owners !== undefined) { fields.push('owners = ?'); vals.push(JSON.stringify(u.owners)); }
        if (u.business !== undefined) { fields.push('business = ?'); vals.push(u.business); }

        if (u.status === 'done') {
          fields.push('completed_at = ?');
          vals.push(now);
        }

        fields.push('updated_at = ?');
        vals.push(now);
        vals.push(u.id);

        db.prepare(`UPDATE actions SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
        updatedCount++;
      }
    });
    bulkUpdate();

    res.json({ updated: updatedCount });
  } catch (err) {
    console.error(`[actions] PUT/bulk error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/actions/:id — Update action
router.put('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM actions WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Action not found' });

    // Validate fields
    const validationErrors = validateActionFields(req.body, true);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
    }

    const now = new Date().toISOString().replace('T', ' ').split('.')[0];
    const {
      title, description, status, business, priority,
      due_date, owners, source_transcript_id, source_label,
      tags, notes
    } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (business !== undefined) updates.business = business;
    if (priority !== undefined) updates.priority = priority;
    if (due_date !== undefined) updates.due_date = due_date;
    if (owners !== undefined) updates.owners = JSON.stringify(owners);
    if (source_transcript_id !== undefined) updates.source_transcript_id = source_transcript_id;
    if (source_label !== undefined) updates.source_label = source_label;
    if (tags !== undefined) updates.tags = JSON.stringify(tags);
    if (notes !== undefined) updates.notes = notes;

    if (status === 'done' && existing.status !== 'done') {
      updates.completed_at = now;
    }
    if (status && status !== 'done' && existing.status === 'done') {
      updates.completed_at = null;
    }

    updates.updated_at = now;

    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const vals = Object.values(updates);
    vals.push(req.params.id);

    const updateTx = db.transaction(() => {
      db.prepare(`UPDATE actions SET ${fields} WHERE id = ?`).run(...vals);

      // Log status changes
      if (status && status !== existing.status) {
        db.prepare(`
          INSERT INTO activity_log (action_id, event, old_value, new_value, actor)
          VALUES (?, 'status_changed', ?, ?, 'user')
        `).run(req.params.id, existing.status, status);
      }
      // Log priority changes
      if (priority && priority !== existing.priority) {
        db.prepare(`
          INSERT INTO activity_log (action_id, event, old_value, new_value, actor)
          VALUES (?, 'priority_changed', ?, ?, 'user')
        `).run(req.params.id, existing.priority, priority);
      }
      // Log general update
      if (!status && !priority) {
        db.prepare(`
          INSERT INTO activity_log (action_id, event, new_value, actor)
          VALUES (?, 'updated', ?, 'user')
        `).run(req.params.id, JSON.stringify(Object.keys(req.body)));
      }
    });
    updateTx();

    const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(req.params.id);
    action.owners = JSON.parse(action.owners || '[]');
    action.tags = JSON.parse(action.tags || '[]');

    res.json(action);
  } catch (err) {
    console.error(`[actions] PUT/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/actions/:id — Delete action
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
