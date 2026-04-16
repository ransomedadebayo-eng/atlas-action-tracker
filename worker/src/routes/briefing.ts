import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { Env } from '../db';

const router = new Hono<{ Bindings: Env }>();

router.get('/today', async (c) => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY);
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('daily_briefings')
    .select('health_snapshot, atlas_priorities, generated_at, summary_markdown')
    .eq('briefing_date', today)
    .single();

  if (error || !data) {
    return c.json({ briefing: null });
  }

  return c.json({ briefing: data });
});

export default router;
