import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { coerceJsonObject, serializeJsonObject } from '../utils/json.js';

const router = Router();

function toViewResponse(view) {
  return {
    ...view,
    filters: coerceJsonObject(view.filters),
  };
}

router.get('/', (req, res) => {
  try {
    const views = db.prepare('SELECT * FROM saved_views ORDER BY name ASC').all();
    res.json(views.map(toViewResponse));
  } catch (err) {
    console.error('[views] GET error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
    `).run(id, name, serializeJsonObject(filters), sort_by, sort_dir, now, now);

    const view = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id);
    res.status(201).json(toViewResponse(view));
  } catch (err) {
    console.error('[views] POST error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'View not found' });

    const { name, filters, sort_by, sort_dir } = req.body;
    const now = new Date().toISOString().replace('T', ' ').split('.')[0];

    const updates = { updated_at: now };
    if (name !== undefined) updates.name = name;
    if (filters !== undefined) updates.filters = serializeJsonObject(filters);
    if (sort_by !== undefined) updates.sort_by = sort_by;
    if (sort_dir !== undefined) updates.sort_dir = sort_dir;

    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    db.prepare(`UPDATE saved_views SET ${fields} WHERE id = ?`).run(...Object.values(updates), req.params.id);

    const view = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(req.params.id);
    res.json(toViewResponse(view));
  } catch (err) {
    console.error('[views] PUT/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
