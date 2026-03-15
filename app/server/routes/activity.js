import { Router } from 'express';
import db from '../db.js';

const router = Router();

// GET /api/activity/:action_id — Activity log for an action
router.get('/:action_id', (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT * FROM activity_log
      WHERE action_id = ?
      ORDER BY created_at DESC
    `).all(req.params.action_id);

    res.json(logs);
  } catch (err) {
    console.error('[activity] GET error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
