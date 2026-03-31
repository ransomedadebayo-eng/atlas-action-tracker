import { Hono } from 'hono';
import { Env, getDb } from '../db';
import { validateStringLengths, sanitizeBody, validateMemberId } from '../middleware/validate';
import { coerceJsonArray, serializeJsonArray } from '../utils/json';

const router = new Hono<{ Bindings: Env }>();

const TEXT_FIELDS = ['name', 'full_name', 'email', 'role'];
const PRIORITY_ORDER: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

function validateMemberArrays(body: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (body.businesses !== undefined) {
    if (!Array.isArray(body.businesses) || !(body.businesses as unknown[]).every(item => typeof item === 'string')) {
      errors.push('businesses must be an array of strings');
    }
  }

  if (body.aliases !== undefined) {
    if (!Array.isArray(body.aliases) || !(body.aliases as unknown[]).every(item => typeof item === 'string')) {
      errors.push('aliases must be an array of strings');
    }
  }

  return errors;
}

router.get('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    const business = c.req.query('business');
    const is_active = c.req.query('is_active');

    let query = supabase.from('atlas_members').select('*');

    if (business) {
      query = query.contains('businesses', [business]);
    }
    if (is_active !== undefined) {
      query = query.eq('is_active', parseInt(is_active, 10) === 1);
    }

    query = query.order('name', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;

    return c.json(data || []);
  } catch (err: unknown) {
    console.error(`[members] GET error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.get('/stats', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data, error } = await supabase.rpc('atlas_member_stats');
    if (error) throw error;
    return c.json(data || []);
  } catch (err: unknown) {
    console.error(`[members] stats error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.get('/:id/actions', async (c) => {
  try {
    const supabase = getDb(c.env);
    const id = c.req.param('id');
    const status = c.req.query('status');

    let query = supabase
      .from('atlas_actions')
      .select('*')
      .contains('owners', [id]);

    if (status) {
      const statuses = status.split(',');
      query = query.in('status', statuses);
    }

    const { data, error } = await query;
    if (error) throw error;

    const sorted = (data || []).sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const pa = PRIORITY_ORDER[a.priority as string] ?? 3;
      const pb = PRIORITY_ORDER[b.priority as string] ?? 3;
      if (pa !== pb) return pa - pb;
      const da = a.due_date as string | null;
      const db = b.due_date as string | null;
      if (da === db) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return da < db ? -1 : 1;
    });

    return c.json(sorted);
  } catch (err: unknown) {
    console.error(`[members] /:id/actions error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.get('/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const id = c.req.param('id');

    const { data: member, error } = await supabase
      .from('atlas_members')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !member) return c.json({ error: 'Member not found' }, 404);

    const { data: statsData, error: statsErr } = await supabase.rpc('atlas_member_detail_stats', {
      member_id_param: id,
    });
    if (statsErr) throw statsErr;

    member.actionStats = (statsData as Record<string, unknown>)?.actionStats || [];
    member.overdueCount = (statsData as Record<string, unknown>)?.overdueCount || 0;

    return c.json(member);
  } catch (err: unknown) {
    console.error(`[members] GET/:id error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    let raw: unknown;
    try { raw = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const body = sanitizeBody(raw as Record<string, unknown>, TEXT_FIELDS);
    const {
      id,
      name,
      full_name = null,
      email = null,
      businesses = [],
      role = null,
      aliases = [],
    } = body as Record<string, unknown>;

    if (!id || !name) {
      return c.json({ error: 'id and name are required' }, 400);
    }

    const idErr = validateMemberId(id as string);
    if (idErr) return c.json({ error: idErr }, 400);

    const validationErrors = [
      ...validateMemberArrays(body),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return c.json({ error: validationErrors.join('; ') }, 400);
    }

    const { data: existingMember } = await supabase
      .from('atlas_members')
      .select('id')
      .eq('id', id)
      .single();
    if (existingMember) {
      return c.json({ error: 'Member ID already exists' }, 409);
    }

    const { data: member, error } = await supabase
      .from('atlas_members')
      .insert({
        id,
        name,
        full_name,
        email,
        businesses: serializeJsonArray(businesses),
        role,
        aliases: serializeJsonArray(aliases),
      })
      .select()
      .single();

    if (error) throw error;

    return c.json(member, 201);
  } catch (err: unknown) {
    console.error(`[members] POST error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.put('/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const id = c.req.param('id');

    const { data: existing, error: fetchErr } = await supabase
      .from('atlas_members')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr || !existing) return c.json({ error: 'Member not found' }, 404);

    let raw: unknown;
    try { raw = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const body = sanitizeBody(raw as Record<string, unknown>, TEXT_FIELDS);
    const { name, full_name, email, businesses, role, aliases, is_active } = body as Record<string, unknown>;

    const validationErrors = [
      ...validateMemberArrays(body),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return c.json({ error: validationErrors.join('; ') }, 400);
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (full_name !== undefined) updates.full_name = full_name;
    if (email !== undefined) updates.email = email;
    if (businesses !== undefined) updates.businesses = serializeJsonArray(businesses);
    if (role !== undefined) updates.role = role;
    if (aliases !== undefined) updates.aliases = serializeJsonArray(aliases);
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return c.json({ error: 'No fields to update' }, 400);
    }

    const { data: member, error } = await supabase
      .from('atlas_members')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    return c.json(member);
  } catch (err: unknown) {
    console.error(`[members] PUT/:id error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default router;
