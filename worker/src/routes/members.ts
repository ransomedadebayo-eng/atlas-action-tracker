import { Hono } from 'hono';
import { Env, getDb } from '../db';
import { validateStringLengths, sanitizeBody } from '../middleware/validate';
import { coerceJsonArray, serializeJsonArray } from '../utils/json';

const router = new Hono<{ Bindings: Env }>();

const TEXT_FIELDS = ['name', 'full_name', 'email', 'role'];
const PRIORITY_ORDER: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };
const ACTIVE_PRINCIPALS = new Set(['ransomed', 'codex', 'claude']);
const CLOSED_STATUSES = new Set(['done', 'completed', 'closed', 'cancelled', 'canceled', 'archived']);

function atlasLocalDate(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function computeActivePrincipalStats(actions: Record<string, unknown>[], today: string) {
  const stats = new Map(Array.from(ACTIVE_PRINCIPALS, memberId => [memberId, {
    member_id: memberId,
    not_started: 0,
    in_progress: 0,
    waiting: 0,
    blocked: 0,
    done: 0,
    active: 0,
    overdue: 0,
    total: 0,
  }]));

  for (const action of actions) {
    const status = String(action.status || 'not_started').toLowerCase();
    const owners = coerceJsonArray(action.owners).filter((owner): owner is string => typeof owner === 'string');
    for (const owner of new Set(owners)) {
      const member = stats.get(owner);
      if (!member) continue;
      member.total += 1;
      if (status === 'done' || status === 'completed' || status === 'closed') member.done += 1;
      else if (Object.prototype.hasOwnProperty.call(member, status)) member[status as 'not_started' | 'in_progress' | 'waiting' | 'blocked'] += 1;
      if (!CLOSED_STATUSES.has(status)) {
        member.active += 1;
        if (typeof action.due_date === 'string' && action.due_date < today) member.overdue += 1;
      }
    }
  }

  return Array.from(stats.values());
}

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
    query = query.eq('is_active', is_active === undefined ? true : parseInt(is_active, 10) === 1);

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
    const { data: actions, error } = await supabase
      .from('atlas_actions')
      .select('status,due_date,owners');
    if (error) throw error;

    return c.json(computeActivePrincipalStats(actions || [], atlasLocalDate()));
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

    return c.json(member);
  } catch (err: unknown) {
    console.error(`[members] GET/:id error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/', async (c) => {
  c.header('Allow', 'GET, PUT');
  return c.json({
    error: {
      code: 'PRINCIPAL_ROSTER_FIXED',
      message: 'ATLAS is owner-only. New principals cannot be created.',
    },
  }, 405);
});

router.put('/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const id = c.req.param('id');

    if (!['ransomed', 'codex', 'claude'].includes(id)) {
      return c.json({
        error: {
          code: 'HISTORICAL_PRINCIPAL_IMMUTABLE',
          message: 'Historical principals are read-only provenance.',
        },
      }, 403);
    }

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
