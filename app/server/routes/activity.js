import { Router } from 'express';
import supabase from '../db.js';

const router = Router();

// GET /api/activity/:action_id — Activity log for an action
router.get('/:action_id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('atlas_activity_log')
      .select('*')
      .eq('action_id', req.params.action_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error('[activity] GET error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
