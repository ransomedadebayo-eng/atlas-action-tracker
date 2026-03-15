import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const router = Router();

// GET /api/views — List saved views
router.get('/', (req, res) => {
  try {
    const views = db.prepare('SELECT * FROM saved_views ORDER BY name ASC').all();
    const parsed = views.map(v => ({
      ...v,
      filters: JSON.parse(v.filters || '{}'),
    }));
    res.json(parsed);
  } catch (err) {
    console.error('[views] GET error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/views — Create saved view
router.post('/', (req, res) => {
  try {
    const id = uuidv4();
    const { name, filters = {}, sort_by = 'priority', sort_dir = 'asc' } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const now = new Date().toISOString().replace('T', ' ').split('.')[0];

    db.prepare(`
      INSERT INTO saved_views (id, name, filters, sort_by, sort_dir, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, JSON.stringify(filters), sort_by, sort_dir, now, now);

    const view = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id);
    view.filters = JSON.parse(view.filters || '{}');

    res.status(201).json(view);
  } catch (err) {
    console.error('[views] POST error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/views/:id — Update saved view
router.put('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'View not found' });

    const { name, filters, sort_by, sort_dir } = req.body;
    const now = new Date().toISOString().replace('T', ' ').split('.')[0];

    const updates = { updated_at: now };
    if (name !== undefined) updates.name = name;
    if (filters !== undefined) updates.filters = JSON.stringify(filters);
    if (sort_by !== undefined) updates.sort_by = sort_by;
    if (sort_dir !== undefined) updates.sort_dir = sort_dir;

    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const vals = [...Object.values(updates), req.params.id];

    db.prepare(`UPDATE saved_views SET ${fields} WHERE id = ?`).run(...vals);

    const view = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(req.params.id);
    view.filters = JSON.parse(view.filters || '{}');

    res.json(view);
  } catch (err) {
    console.error('[views] PUT/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/views/:id — Delete saved view
router.delete('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'View not found' });

    db.prepare('DELETE FROM saved_views WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[views] DELETE error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
