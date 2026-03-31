import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, getDb } from '../db';
import { serializeJsonObject } from '../utils/json';

const router = new Hono<{ Bindings: Env }>();

router.get('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data, error } = await supabase
      .from('atlas_saved_views')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw error;

    return c.json(data || []);
  } catch (err: unknown) {
    console.error('[views] GET error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    let raw: unknown;
    try { raw = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const body = raw as Record<string, unknown>;
    const id = uuidv4();
    const { name, filters = {}, sort_by = 'priority', sort_dir = 'asc' } = body;

    if (!name) {
      return c.json({ error: 'name is required' }, 400);
    }

    const now = new Date().toISOString();

    const { data: view, error } = await supabase
      .from('atlas_saved_views')
      .insert({
        id,
        name,
        filters: serializeJsonObject(filters),
        sort_by,
        sort_dir,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) throw error;

    return c.json(view, 201);
  } catch (err: unknown) {
    console.error('[views] POST error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.put('/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const id = c.req.param('id');

    const { data: existing, error: fetchErr } = await supabase
      .from('atlas_saved_views')
      .select('id')
      .eq('id', id)
      .single();
    if (fetchErr || !existing) return c.json({ error: 'View not found' }, 404);

    let raw: unknown;
    try { raw = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const body = raw as Record<string, unknown>;
    const { name, filters, sort_by, sort_dir } = body;
    const now = new Date().toISOString();

    const updates: Record<string, unknown> = { updated_at: now };
    if (name !== undefined) updates.name = name;
    if (filters !== undefined) updates.filters = serializeJsonObject(filters);
    if (sort_by !== undefined) updates.sort_by = sort_by;
    if (sort_dir !== undefined) updates.sort_dir = sort_dir;

    const { data: view, error } = await supabase
      .from('atlas_saved_views')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    return c.json(view);
  } catch (err: unknown) {
    console.error('[views] PUT/:id error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.delete('/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const id = c.req.param('id');

    const { data: existing, error: fetchErr } = await supabase
      .from('atlas_saved_views')
      .select('id')
      .eq('id', id)
      .single();
    if (fetchErr || !existing) return c.json({ error: 'View not found' }, 404);

    const { error } = await supabase.from('atlas_saved_views').delete().eq('id', id);
    if (error) throw error;

    return c.json({ deleted: true });
  } catch (err: unknown) {
    console.error('[views] DELETE error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default router;
