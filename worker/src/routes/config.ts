import { Hono } from 'hono';
import { Env, getDb } from '../db';

const router = new Hono<{ Bindings: Env }>();

const FALLBACK_COLORS = [
  '#f4b860', '#10b981', '#8cb8ff', '#f0a6c4', '#ee7d77',
  '#ff9993', '#a855f7', '#06b6d4', '#84cc16', '#14b8a6',
  '#f97316', '#8b5cf6', '#ec4899', '#0ea5e9', '#d946ef',
];

function colorForId(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

function titleizeId(id: string) {
  return id
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

router.get('/businesses', async (c) => {
  try {
    const supabase = getDb(c.env);
    const includeEmpty = c.req.query('include_empty') === 'true';

    const [configResult, actionsResult] = await Promise.all([
      supabase.from('atlas_config').select('value').eq('key', 'businesses').maybeSingle(),
      supabase.from('atlas_actions').select('business'),
    ]);

    if (actionsResult.error) throw actionsResult.error;

    const configured = Array.isArray(configResult.data?.value)
      ? (configResult.data!.value as Array<Record<string, unknown>>)
      : [];
    const configById = new Map<string, Record<string, unknown>>();
    for (const entry of configured) {
      const id = typeof entry.id === 'string' ? entry.id : '';
      if (id) configById.set(id, entry);
    }

    const counts = new Map<string, number>();
    for (const row of actionsResult.data || []) {
      const raw = (row as { business?: unknown }).business;
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const id = raw.trim();
      counts.set(id, (counts.get(id) || 0) + 1);
    }

    const ids = new Set<string>();
    for (const id of counts.keys()) ids.add(id);
    if (includeEmpty) for (const id of configById.keys()) ids.add(id);

    const result = Array.from(ids).map(id => {
      const meta = configById.get(id) || {};
      const name = typeof meta.name === 'string' && meta.name ? meta.name : titleizeId(id);
      const color = typeof meta.color === 'string' && meta.color ? meta.color : colorForId(id);
      return {
        ...meta,
        id,
        name,
        color,
        active: meta.active !== false,
        count: counts.get(id) || 0,
      };
    });

    result.sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
    return c.json(result);
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
