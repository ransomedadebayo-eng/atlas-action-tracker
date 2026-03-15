import { Router } from 'express';
import db from '../db.js';
import { validateStringLengths, sanitizeBody, validateMemberId, parsePagination } from '../middleware/validate.js';

const router = Router();
const TEXT_FIELDS = ['name', 'full_name', 'email', 'role'];

// GET /api/members — List members
router.get('/', (req, res) => {
  try {
    const { business, is_active } = req.query;
    let sql = 'SELECT * FROM members WHERE 1=1';
    const params = [];

    if (business) {
      sql += ` AND EXISTS (SELECT 1 FROM json_each(businesses) WHERE value = ?)`;
      params.push(business);
    }
    if (is_active !== undefined) {
      sql += ' AND is_active = ?';
      params.push(parseInt(is_active));
    }

    sql += ' ORDER BY name ASC';

    const members = db.prepare(sql).all(...params);
    const parsed = members.map(m => ({
      ...m,
      businesses: JSON.parse(m.businesses || '[]'),
      aliases: JSON.parse(m.aliases || '[]'),
    }));

    res.json(parsed);
  } catch (err) {
    console.error(`[members] GET error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/members/stats — Workload overview
router.get('/stats', (req, res) => {
  try {
    const workload = db.prepare(`
      SELECT j.value AS member_id,
             SUM(CASE WHEN status = 'not_started' THEN 1 ELSE 0 END) as not_started,
             SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
             SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) as waiting,
             SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked,
             SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
             COUNT(*) as total
      FROM actions, json_each(owners) j
      GROUP BY j.value
      ORDER BY total DESC
    `).all();

    const overdue = db.prepare(`
      SELECT j.value AS member_id, COUNT(*) as count
      FROM actions, json_each(owners) j
      WHERE due_date < date('now') AND status NOT IN ('done','blocked')
      GROUP BY j.value
    `).all();

    const overdueMap = {};
    for (const o of overdue) {
      overdueMap[o.member_id] = o.count;
    }

    const enriched = workload.map(w => ({
      ...w,
      overdue: overdueMap[w.member_id] || 0,
      active: w.not_started + w.in_progress + w.waiting,
    }));

    res.json(enriched);
  } catch (err) {
    console.error(`[members] stats error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/members/:id — Get member with stats
router.get('/:id', (req, res) => {
  try {
    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    member.businesses = JSON.parse(member.businesses || '[]');
    member.aliases = JSON.parse(member.aliases || '[]');

    // Get action stats for this member
    const stats = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM actions
      WHERE EXISTS (SELECT 1 FROM json_each(owners) WHERE value = ?)
      GROUP BY status
    `).all(req.params.id);

    const overdue = db.prepare(`
      SELECT COUNT(*) as count FROM actions
      WHERE EXISTS (SELECT 1 FROM json_each(owners) WHERE value = ?)
      AND due_date < date('now') AND status NOT IN ('done','blocked')
    `).get(req.params.id);

    member.actionStats = stats;
    member.overdueCount = overdue.count;

    res.json(member);
  } catch (err) {
    console.error(`[members] GET/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/members/:id/actions — All actions for a member
router.get('/:id/actions', (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT * FROM actions
      WHERE EXISTS (SELECT 1 FROM json_each(owners) WHERE value = ?)
    `;
    const params = [req.params.id];

    if (status) {
      const statuses = status.split(',');
      sql += ` AND status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }

    sql += ` ORDER BY CASE priority WHEN 'p0' THEN 0 WHEN 'p1' THEN 1 WHEN 'p2' THEN 2 ELSE 3 END, due_date ASC`;

    const actions = db.prepare(sql).all(...params);
    const parsed = actions.map(a => ({
      ...a,
      owners: JSON.parse(a.owners || '[]'),
      tags: JSON.parse(a.tags || '[]'),
    }));

    res.json(parsed);
  } catch (err) {
    console.error(`[members] /:id/actions error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/members — Add member
router.post('/', (req, res) => {
  try {
    const body = sanitizeBody(req.body, TEXT_FIELDS);
    const { id, name, full_name = null, email = null, businesses = [], role = null, aliases = [] } = body;

    if (!id || !name) {
      return res.status(400).json({ error: 'id and name are required' });
    }

    const idErr = validateMemberId(id);
    if (idErr) return res.status(400).json({ error: idErr });

    const lengthErrors = validateStringLengths(body);
    if (lengthErrors.length > 0) {
      return res.status(400).json({ error: lengthErrors.join('; ') });
    }

    const existing = db.prepare('SELECT id FROM members WHERE id = ?').get(id);
    if (existing) {
      return res.status(409).json({ error: 'Member ID already exists' });
    }

    db.prepare(`
      INSERT INTO members (id, name, full_name, email, businesses, role, aliases)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, full_name, email, JSON.stringify(businesses), role, JSON.stringify(aliases));

    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
    member.businesses = JSON.parse(member.businesses || '[]');
    member.aliases = JSON.parse(member.aliases || '[]');

    res.status(201).json(member);
  } catch (err) {
    console.error(`[members] POST error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/members/:id — Update member
router.put('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Member not found' });

    const { name, full_name, email, businesses, role, aliases, is_active } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (full_name !== undefined) updates.full_name = full_name;
    if (email !== undefined) updates.email = email;
    if (businesses !== undefined) updates.businesses = JSON.stringify(businesses);
    if (role !== undefined) updates.role = role;
    if (aliases !== undefined) updates.aliases = JSON.stringify(aliases);
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const vals = [...Object.values(updates), req.params.id];

    db.prepare(`UPDATE members SET ${fields} WHERE id = ?`).run(...vals);

    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
    member.businesses = JSON.parse(member.businesses || '[]');
    member.aliases = JSON.parse(member.aliases || '[]');

    res.json(member);
  } catch (err) {
    console.error(`[members] PUT/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
