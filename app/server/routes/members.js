import { Router } from 'express';
import db from '../db.js';
import {
  validateStringLengths,
  sanitizeBody,
  validateMemberId,
} from '../middleware/validate.js';
import { coerceJsonArray, serializeJsonArray, sqlJsonArray } from '../utils/json.js';

const router = Router();
const TEXT_FIELDS = ['name', 'full_name', 'email', 'role'];
const BUSINESSES_JSON_SQL = sqlJsonArray('businesses');
const OWNERS_JSON_SQL = sqlJsonArray('owners');

function validateMemberArrays(body) {
  const errors = [];

  if (body.businesses !== undefined) {
    if (!Array.isArray(body.businesses) || !body.businesses.every(item => typeof item === 'string')) {
      errors.push('businesses must be an array of strings');
    }
  }

  if (body.aliases !== undefined) {
    if (!Array.isArray(body.aliases) || !body.aliases.every(item => typeof item === 'string')) {
      errors.push('aliases must be an array of strings');
    }
  }

  return errors;
}

function toMemberResponse(member) {
  return {
    ...member,
    businesses: coerceJsonArray(member.businesses),
    aliases: coerceJsonArray(member.aliases),
  };
}

router.get('/', (req, res) => {
  try {
    const { business, is_active } = req.query;
    let sql = 'SELECT * FROM members WHERE 1=1';
    const params = [];

    if (business) {
      sql += ` AND EXISTS (SELECT 1 FROM json_each(${BUSINESSES_JSON_SQL}) WHERE value = ?)`;
      params.push(business);
    }
    if (is_active !== undefined) {
      sql += ' AND is_active = ?';
      params.push(parseInt(is_active, 10));
    }

    sql += ' ORDER BY name ASC';

    const members = db.prepare(sql).all(...params);
    res.json(members.map(toMemberResponse));
  } catch (err) {
    console.error(`[members] GET error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/stats', (req, res) => {
  try {
    const workload = db.prepare(`
      SELECT j.value AS member_id,
             SUM(CASE WHEN status = 'not_started' THEN 1 ELSE 0 END) AS not_started,
             SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
             SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting,
             SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
             SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
             COUNT(*) AS total
      FROM actions, json_each(${OWNERS_JSON_SQL}) j
      GROUP BY j.value
      ORDER BY total DESC
    `).all();

    const overdue = db.prepare(`
      SELECT j.value AS member_id, COUNT(*) AS count
      FROM actions, json_each(${OWNERS_JSON_SQL}) j
      WHERE due_date < date('now') AND status NOT IN ('done','blocked')
      GROUP BY j.value
    `).all();

    const overdueMap = {};
    for (const row of overdue) {
      overdueMap[row.member_id] = row.count;
    }

    const enriched = workload.map(row => ({
      ...row,
      overdue: overdueMap[row.member_id] || 0,
      active: row.not_started + row.in_progress + row.waiting,
    }));

    res.json(enriched);
  } catch (err) {
    console.error(`[members] stats error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const stats = db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM actions
      WHERE EXISTS (SELECT 1 FROM json_each(${OWNERS_JSON_SQL}) WHERE value = ?)
      GROUP BY status
    `).all(req.params.id);

    const overdue = db.prepare(`
      SELECT COUNT(*) AS count
      FROM actions
      WHERE EXISTS (SELECT 1 FROM json_each(${OWNERS_JSON_SQL}) WHERE value = ?)
        AND due_date < date('now')
        AND status NOT IN ('done','blocked')
    `).get(req.params.id);

    const response = toMemberResponse(member);
    response.actionStats = stats;
    response.overdueCount = overdue.count;

    res.json(response);
  } catch (err) {
    console.error(`[members] GET/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/actions', (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT * FROM actions
      WHERE EXISTS (SELECT 1 FROM json_each(${OWNERS_JSON_SQL}) WHERE value = ?)
    `;
    const params = [req.params.id];

    if (status) {
      const statuses = status.split(',');
      sql += ` AND status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }

    sql += ' ORDER BY CASE priority WHEN \'p0\' THEN 0 WHEN \'p1\' THEN 1 WHEN \'p2\' THEN 2 ELSE 3 END, due_date ASC';

    const actions = db.prepare(sql).all(...params);
    res.json(actions.map(action => ({
      ...action,
      owners: coerceJsonArray(action.owners),
      tags: coerceJsonArray(action.tags),
    })));
  } catch (err) {
    console.error(`[members] /:id/actions error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', (req, res) => {
  try {
    const body = sanitizeBody(req.body, TEXT_FIELDS);
    const {
      id,
      name,
      full_name = null,
      email = null,
      businesses = [],
      role = null,
      aliases = [],
    } = body;

    if (!id || !name) {
      return res.status(400).json({ error: 'id and name are required' });
    }

    const idErr = validateMemberId(id);
    if (idErr) return res.status(400).json({ error: idErr });

    const validationErrors = [
      ...validateMemberArrays(body),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
    }

    const existing = db.prepare('SELECT id FROM members WHERE id = ?').get(id);
    if (existing) {
      return res.status(409).json({ error: 'Member ID already exists' });
    }

    db.prepare(`
      INSERT INTO members (id, name, full_name, email, businesses, role, aliases)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, full_name, email, serializeJsonArray(businesses), role, serializeJsonArray(aliases));

    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
    res.status(201).json(toMemberResponse(member));
  } catch (err) {
    console.error(`[members] POST error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Member not found' });

    const body = sanitizeBody(req.body, TEXT_FIELDS);
    const {
      name, full_name, email, businesses, role, aliases, is_active,
    } = body;

    const validationErrors = [
      ...validateMemberArrays(body),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (full_name !== undefined) updates.full_name = full_name;
    if (email !== undefined) updates.email = email;
    if (businesses !== undefined) updates.businesses = serializeJsonArray(businesses);
    if (role !== undefined) updates.role = role;
    if (aliases !== undefined) updates.aliases = serializeJsonArray(aliases);
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    db.prepare(`UPDATE members SET ${fields} WHERE id = ?`).run(...Object.values(updates), req.params.id);

    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
    res.json(toMemberResponse(member));
  } catch (err) {
    console.error(`[members] PUT/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
