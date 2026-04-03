import { Hono } from 'hono';
import { Env, getDb } from '../db';

const router = new Hono<{ Bindings: Env }>();

router.get('/:action_id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const action_id = c.req.param('action_id');

    const { data, error } = await supabase
      .from('atlas_activity_log')
      .select('*')
      .eq('action_id', action_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return c.json(data || []);
  } catch (err: unknown) {
    console.error('[activity] GET error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default router;
