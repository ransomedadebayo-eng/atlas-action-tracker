import { Hono } from 'hono';
import { Env, getDb } from '../db';
import { validateMemberId, validateStringLengths, sanitizeBody } from '../middleware/validate';
import { coerceJsonArray, serializeJsonArray } from '../utils/json';

const router = new Hono<{ Bindings: Env }>();

const TEXT_FIELDS = ['name', 'full_name', 'email', 'role'];
const PRIORITY_ORDER: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };
const VISIBLE_PRINCIPAL_TYPES = new Set(['owner', 'human', 'agent']);
const CLOSED_STATUSES = new Set(['done', 'completed', 'closed', 'cancelled', 'canceled', 'archived']);

type PrincipalRow = {
  id: string;
  principal_type?: string | null;
  is_active?: boolean | null;
};

export function isMutablePrincipal(member: PrincipalRow): { ok: true } | { ok: false; status: 403; code: string; message: string } {
  const id = String(member.id || '').trim();
  const type = String(member.principal_type || '').trim().toLowerCase();
  const active = member.is_active === true;

  if (!active || type === 'historical' || !VISIBLE_PRINCIPAL_TYPES.has(type)) {
    return {
      ok: false,
      status: 403,
      code: 'HISTORICAL_PRINCIPAL_IMMUTABLE',
      message: 'Historical principals are read-only provenance.',
    };
  }
  if ((type === 'owner' && id !== 'ransomed') || (id === 'ransomed' && type !== 'owner')) {
    return {
      ok: false,
      status: 403,
      code: 'ATLAS_OWNER_PRINCIPAL_REQUIRED',
      message: 'Only ransomed can be the active owner principal.',
    };
  }
  if ((type === 'human' && id !== 'nicole') || (id === 'nicole' && type !== 'human')) {
    return {
      ok: false,
      status: 403,
      code: 'ATLAS_HUMAN_PRINCIPAL_REQUIRED',
      message: 'Only nicole can be the active human principal.',
    };
  }
  return { ok: true };
}

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

function emptyStats(member: PrincipalRow) {
  return {
    member_id: member.id,
    principal_type: String(member.principal_type || ''),
    is_active: member.is_active === true,
    not_started: 0,
    in_progress: 0,
    waiting: 0,
    blocked: 0,
    done: 0,
    active: 0,
    overdue: 0,
    total: 0,
  };
}

export function computeActivePrincipalStats(
  actions: Record<string, unknown>[],
  today: string,
  principals: PrincipalRow[] = [],
) {
  const stats = new Map<string, ReturnType<typeof emptyStats>>();
  for (const principal of principals) {
    if (!principal?.id || isMutablePrincipal(principal).ok !== true) continue;
    stats.set(principal.id, emptyStats(principal));
  }

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
    const [{ data: principals, error: principalError }, { data: actions, error: actionError }] = await Promise.all([
      supabase
        .from('atlas_members')
        .select('id,principal_type,is_active')
        .eq('is_active', true)
        .in('principal_type', ['owner', 'human', 'agent']),
      supabase
        .from('atlas_actions')
        .select('status,due_date,owners'),
    ]);
    if (principalError) throw principalError;
    if (actionError) throw actionError;

    return c.json(computeActivePrincipalStats(actions || [], atlasLocalDate(), principals || []));
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
      .filter('owners', 'cs', JSON.stringify([id]));

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
  try {
    let raw: unknown;
    try { raw = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const body = sanitizeBody(raw as Record<string, unknown>, TEXT_FIELDS);
    const id = String((body as Record<string, unknown>).id || '').trim();
    const idError = validateMemberId(id);
    if (idError) return c.json({ error: idError }, 400);

    const principal_type = String((body as Record<string, unknown>).principal_type || 'historical').trim().toLowerCase();
    const is_active = (body as Record<string, unknown>).is_active === undefined
      ? principal_type !== 'historical'
      : (body as Record<string, unknown>).is_active === true;

    const gate = isMutablePrincipal({ id, principal_type, is_active });
    if (gate.ok !== true) {
      return c.json({ error: { code: gate.code, message: gate.message } }, gate.status);
    }

    const validationErrors = [
      ...validateMemberArrays(body),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return c.json({ error: validationErrors.join('; ') }, 400);
    }

    const { name, full_name, email, businesses, role, aliases } = body as Record<string, unknown>;
    if (!name || typeof name !== 'string') {
      return c.json({ error: 'name is required' }, 400);
    }

    const { data: member, error } = await getDb(c.env)
      .from('atlas_members')
      .insert({
        id,
        name,
        full_name: full_name ?? null,
        email: email ?? null,
        businesses: serializeJsonArray(businesses),
        role: role ?? null,
        aliases: serializeJsonArray(aliases),
        is_active,
        principal_type,
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

    const gate = isMutablePrincipal(existing as PrincipalRow);
    if (gate.ok !== true) {
      return c.json({ error: { code: gate.code, message: gate.message } }, gate.status);
    }

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

    const nextState = {
      id,
      principal_type: existing.principal_type,
      is_active: updates.is_active === undefined ? existing.is_active : updates.is_active === true,
    };
    const nextGate = isMutablePrincipal(nextState);
    if (nextGate.ok !== true) {
      return c.json({ error: { code: nextGate.code, message: nextGate.message } }, nextGate.status);
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
