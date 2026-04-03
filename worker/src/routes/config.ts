import { Hono } from 'hono';
import { Env, getDb } from '../db';

const router = new Hono<{ Bindings: Env }>();

router.get('/businesses', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data, error } = await supabase
      .from('atlas_config')
      .select('value')
      .eq('key', 'businesses')
      .single();

    if (error || !data) return c.json([]);

    const parsed = data.value;
    return c.json(Array.isArray(parsed) ? parsed : []);
  } catch (err: unknown) {
    console.error(`[config] GET businesses error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.put('/businesses', async (c) => {
  try {
    const supabase = getDb(c.env);
    let businesses: unknown;
    try { businesses = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    if (!Array.isArray(businesses)) return c.json({ error: 'Expected array' }, 400);

    const { error } = await supabase
      .from('atlas_config')
      .upsert({ key: 'businesses', value: businesses });
    if (error) throw error;

    return c.json(businesses);
  } catch (err: unknown) {
    console.error(`[config] PUT businesses error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default router;
