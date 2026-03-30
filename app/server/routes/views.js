import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import supabase from '../db.js';
import { serializeJsonObject } from '../utils/json.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('atlas_saved_views')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error('[views] GET error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const id = uuidv4();
    const { name, filters = {}, sort_by = 'priority', sort_dir = 'asc' } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
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

    res.status(201).json(view);
  } catch (err) {
    console.error('[views] POST error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('atlas_saved_views')
      .select('id')
      .eq('id', req.params.id)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'View not found' });

    const { name, filters, sort_by, sort_dir } = req.body;
    const now = new Date().toISOString();

    const updates = { updated_at: now };
    if (name !== undefined) updates.name = name;
    if (filters !== undefined) updates.filters = serializeJsonObject(filters);
    if (sort_by !== undefined) updates.sort_by = sort_by;
    if (sort_dir !== undefined) updates.sort_dir = sort_dir;

    const { data: view, error } = await supabase
      .from('atlas_saved_views')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;

    res.json(view);
  } catch (err) {
    console.error('[views] PUT/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('atlas_saved_views')
      .select('id')
      .eq('id', req.params.id)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'View not found' });

    const { error } = await supabase.from('atlas_saved_views').delete().eq('id', req.params.id);
    if (error) throw error;

    res.json({ deleted: true });
  } catch (err) {
    console.error('[views] DELETE error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
