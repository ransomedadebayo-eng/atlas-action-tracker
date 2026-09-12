import { Hono } from 'hono';
import { Env, getDb } from '../db';
import { getActor, getAuthKind } from '../utils/actors';
import { apiError } from '../utils/http';

const router = new Hono<{ Bindings: Env }>();
const WEEK_START_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ITEM_KINDS = new Set(['must_win', 'day_focus', 'risk', 'deferred', 'carryover', 'context']);

function isMonday(value: string): boolean {
  if (!WEEK_START_PATTERN.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.getUTCDay() === 1 && date.toISOString().slice(0, 10) === value;
}

function weekDates(weekStart: string): string[] {
  const start = new Date(`${weekStart}T12:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function pacificDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const parsed = Object.fromEntries(parts.map(part => [part.type, part.value]));
  if (!parsed.year || !parsed.month || !parsed.day) return null;
  return `${parsed.year}-${parsed.month}-${parsed.day}`;
}

function parseExpectedRevision(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('expected_revision must be a non-negative integer.');
  }
  return value;
}

function validateItems(items: unknown): Record<string, unknown>[] {
  if (!Array.isArray(items)) throw new Error('items must be an array.');
  return items.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`items[${index}] must be an object.`);
    const item = value as Record<string, unknown>;
    if (typeof item.kind !== 'string' || !ITEM_KINDS.has(item.kind)) throw new Error(`items[${index}].kind is invalid.`);
    if (typeof item.title !== 'string' || item.title.trim().length === 0) throw new Error(`items[${index}].title is required.`);
    if (['must_win', 'day_focus', 'deferred', 'carryover'].includes(item.kind)
      && (typeof item.source_action_id !== 'string' || item.source_action_id.trim().length === 0)) {
      throw new Error(`items[${index}] must link a canonical action.`);
    }
    return {
      kind: item.kind,
      plan_date: typeof item.plan_date === 'string' ? item.plan_date : null,
      rank: typeof item.rank === 'number' && Number.isSafeInteger(item.rank) ? item.rank : index,
      source_action_id: typeof item.source_action_id === 'string' ? item.source_action_id : null,
      title: item.title.trim().slice(0, 500),
      notes: typeof item.notes === 'string' ? item.notes.slice(0, 4000) : '',
      rationale: typeof item.rationale === 'string' ? item.rationale.slice(0, 4000) : '',
    };
  });
}

function validateCommitments(commitments: unknown): Record<string, unknown>[] {
  if (!Array.isArray(commitments)) throw new Error('commitments must be an array.');
  return commitments.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`commitments[${index}] must be an object.`);
    const item = value as Record<string, unknown>;
    if (typeof item.title !== 'string' || item.title.trim().length === 0) throw new Error(`commitments[${index}].title is required.`);
    return {
      source_ref: typeof item.source_ref === 'string' ? item.source_ref.slice(0, 500) : crypto.randomUUID(),
      source_label: typeof item.source_label === 'string' ? item.source_label.slice(0, 120) : 'calendar',
      title: item.title.trim().slice(0, 500),
      starts_at: typeof item.starts_at === 'string' ? item.starts_at : null,
      ends_at: typeof item.ends_at === 'string' ? item.ends_at : null,
      all_day: item.all_day === true,
      captured_at: typeof item.captured_at === 'string' ? item.captured_at : new Date().toISOString(),
      source_as_of: typeof item.source_as_of === 'string' ? item.source_as_of : null,
      coverage_status: ['complete', 'partial', 'stale', 'unavailable'].includes(String(item.coverage_status))
        ? item.coverage_status : 'complete',
    };
  });
}

function rpcError(c: Parameters<typeof apiError>[0], error: { code?: string; message?: string }, operation: string) {
  const message = error.message || '';
  if (error.code === '40001' || message.includes('ATLAS_WEEKLY_REVISION_CONFLICT')) {
    return apiError(c, 409, 'REVISION_CONFLICT', 'This weekly plan changed since it was loaded. Refresh it and retry.');
  }
  if (error.code === 'P0002' || message.includes('ATLAS_WEEKLY_NOT_FOUND')) {
    return apiError(c, 404, 'WEEK_NOT_FOUND', 'Weekly plan not found.');
  }
  if (error.code === '42501' || message.includes('ATLAS_WEEKLY_OWNER_REQUIRED')) {
    return apiError(c, 403, 'OWNER_REQUIRED', 'Only the ATLAS owner can publish a weekly plan.');
  }
  if (error.code === '22023' || error.code === '23503' || error.code === '23505') {
    return apiError(c, 400, 'INVALID_WEEKLY_PLAN', message || `Unable to ${operation} the weekly plan.`);
  }
  console.error(`[weeks] ${operation} RPC error: ${message || error.code || 'unknown error'}`);
  return apiError(c, 500, 'WEEKLY_PLAN_FAILED', `Unable to ${operation} the weekly plan.`);
}

async function hydrateRevision(supabase: ReturnType<typeof getDb>, revision: Record<string, unknown> | null) {
  if (!revision) return null;
  const revisionId = String(revision.id);
  const [{ data: items, error: itemsError }, { data: commitments, error: commitmentsError }] = await Promise.all([
    supabase.from('atlas_weekly_plan_items').select('*').eq('weekly_revision_id', revisionId).order('plan_date', { ascending: true, nullsFirst: true }).order('rank', { ascending: true }),
    supabase.from('atlas_weekly_plan_commitments').select('*').eq('weekly_revision_id', revisionId).order('starts_at', { ascending: true, nullsFirst: true }),
  ]);
  if (itemsError) throw itemsError;
  if (commitmentsError) throw commitmentsError;

  const rows = (items || []) as Record<string, unknown>[];
  const actionIds = Array.from(new Set(rows.map(item => item.source_action_id).filter(Boolean).map(String)));
  let actions: Record<string, unknown>[] = [];
  if (actionIds.length > 0) {
    const { data, error } = await supabase.from('atlas_actions').select('*').in('id', actionIds);
    if (error) throw error;
    actions = (data || []) as Record<string, unknown>[];
  }
  const actionById = new Map(actions.map(action => [String(action.id), action]));
  const hydratedItems: Record<string, unknown>[] = rows.map(item => ({
    ...item,
    action: item.source_action_id ? actionById.get(String(item.source_action_id)) || null : null,
    action_current_as_of: new Date().toISOString(),
  }));
  return {
    ...revision,
    items: hydratedItems,
    commitments: commitments || [],
    diagnostics: {
      stale_calendar: (commitments || []).some((item: Record<string, unknown>) => ['stale', 'unavailable', 'partial'].includes(String(item.coverage_status))),
      missing_actions: hydratedItems.filter(item => item.source_action_id && !item.action).map(item => item.source_action_id),
    },
  };
}

async function getWeekPayload(supabase: ReturnType<typeof getDb>, weekStart: string, revisionId: string | null = null) {
  const { data: revisions, error } = await supabase
    .from('atlas_weekly_plan_revisions')
    .select('*')
    .eq('week_start', weekStart)
    .order('version', { ascending: false });
  if (error) throw error;
  const rows = (revisions || []) as Record<string, unknown>[];
  const published = rows.find(row => row.status === 'published') || null;
  const draft = rows.find(row => row.status === 'draft' || row.status === 'review_requested') || null;
  const selected = revisionId ? rows.find(row => String(row.id) === revisionId) || null : null;
  const hydratedPublished = await hydrateRevision(supabase, published);
  const hydratedDraft = await hydrateRevision(supabase, draft);
  const hydratedSelected = selected ? await hydrateRevision(supabase, selected) : null;
  const dates = weekDates(weekStart);
  const selectedPlan = hydratedSelected || hydratedDraft || hydratedPublished;
  const days = dates.map(date => ({
    date,
    items: selectedPlan?.items?.filter((item: Record<string, unknown>) => item.plan_date === date) || [],
    commitments: selectedPlan?.commitments?.filter((item: Record<string, unknown>) => pacificDate(item.starts_at as string) === date) || [],
  }));
  return {
    week_start: weekStart,
    week_end: dates[6],
    published: hydratedPublished,
    draft: hydratedDraft,
    selected_revision: hydratedSelected,
    history: rows.map(row => ({
      id: row.id,
      version: row.version,
      status: row.status,
      title: row.title,
      summary: row.summary,
      revision: row.revision,
      created_at: row.created_at,
      published_at: row.published_at,
    })),
    days,
    diagnostics: selectedPlan?.diagnostics || { stale_calendar: false, missing_actions: [] },
  };
}

router.get('/review', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data, error } = await supabase
      .from('atlas_weekly_plan_revisions')
      .select('id,week_start,version,status,title,summary,revision,updated_at')
      .eq('status', 'review_requested')
      .order('week_start', { ascending: true });
    if (error) throw error;
    return c.json({ weeks: data || [] });
  } catch (error) {
    console.error(`[weeks] review error: ${(error as Error).message}`);
    return c.json({ error: 'Unable to load weekly plans for review.' }, 500);
  }
});

router.post('/drafts', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const weekStart = typeof body.week_start === 'string' ? body.week_start : '';
    if (!isMonday(weekStart)) return apiError(c, 400, 'INVALID_WEEK_START', 'week_start must be a valid Pacific Monday.');
    const supabase = getDb(c.env);
    const { data, error } = await supabase.rpc('create_atlas_weekly_plan_draft', {
      p_week_start: weekStart,
      p_title: typeof body.title === 'string' ? body.title.slice(0, 500) : '',
      p_summary: typeof body.summary === 'string' ? body.summary.slice(0, 4000) : '',
      p_source_coverage: body.source_coverage && typeof body.source_coverage === 'object' ? body.source_coverage : {},
      p_source_fingerprint: typeof body.source_fingerprint === 'string' ? body.source_fingerprint : null,
      p_actor: getActor(c, 'system'),
      p_idempotency_key: typeof body.idempotency_key === 'string' ? body.idempotency_key : null,
    });
    if (error) return rpcError(c, error, 'create');
    return c.json(data, 201);
  } catch (error) {
    return apiError(c, 400, 'INVALID_WEEKLY_PLAN', (error as Error).message);
  }
});

router.get('/:weekStart', async (c) => {
  const weekStart = c.req.param('weekStart');
  if (!isMonday(weekStart)) return apiError(c, 400, 'INVALID_WEEK_START', 'week_start must be a valid Pacific Monday.');
  try {
    return c.json(await getWeekPayload(getDb(c.env), weekStart, c.req.query('revision_id') || null));
  } catch (error) {
    console.error(`[weeks] GET error: ${(error as Error).message}`);
    return c.json({ error: 'Unable to load the weekly plan.' }, 500);
  }
});

router.put('/revisions/:id', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const items = validateItems(body.items);
    const commitments = validateCommitments(body.commitments || []);
    const expectedRevision = parseExpectedRevision(body.expected_revision);
    const supabase = getDb(c.env);
    const { data, error } = await supabase.rpc('save_atlas_weekly_plan_revision', {
      p_revision_id: c.req.param('id'),
      p_expected_revision: expectedRevision,
      p_payload: {
        title: typeof body.title === 'string' ? body.title.slice(0, 500) : '',
        summary: typeof body.summary === 'string' ? body.summary.slice(0, 4000) : '',
        source_coverage: body.source_coverage && typeof body.source_coverage === 'object' ? body.source_coverage : {},
        calendar_acknowledged: body.calendar_acknowledged === true,
        items,
        commitments,
      },
      p_actor: getActor(c),
      p_idempotency_key: typeof body.idempotency_key === 'string' ? body.idempotency_key : null,
    });
    if (error) return rpcError(c, error, 'save');
    return c.json(data);
  } catch (error) {
    return apiError(c, 400, 'INVALID_WEEKLY_PLAN', (error as Error).message);
  }
});

router.post('/revisions/:id/request-review', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const expectedRevision = parseExpectedRevision(body.expected_revision);
    const { data, error } = await getDb(c.env).rpc('request_atlas_weekly_plan_review', {
      p_revision_id: c.req.param('id'),
      p_expected_revision: expectedRevision,
      p_actor: getActor(c),
      p_idempotency_key: typeof body.idempotency_key === 'string' ? body.idempotency_key : null,
    });
    if (error) return rpcError(c, error, 'request review');
    return c.json(data);
  } catch (error) {
    return apiError(c, 400, 'INVALID_WEEKLY_PLAN', (error as Error).message);
  }
});

router.post('/revisions/:id/publish', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const expectedRevision = parseExpectedRevision(body.expected_revision);
    const { data, error } = await getDb(c.env).rpc('publish_atlas_weekly_plan', {
      p_revision_id: c.req.param('id'),
      p_expected_revision: expectedRevision,
      p_actor: getActor(c),
      p_calendar_acknowledged: body.calendar_acknowledged === true,
      p_idempotency_key: typeof body.idempotency_key === 'string' ? body.idempotency_key : null,
    });
    if (error) return rpcError(c, error, 'publish');
    return c.json(data);
  } catch (error) {
    return apiError(c, 400, 'INVALID_WEEKLY_PLAN', (error as Error).message);
  }
});

router.post('/revisions/:id/fork', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { data, error } = await getDb(c.env).rpc('fork_atlas_weekly_plan', {
      p_revision_id: c.req.param('id'),
      p_actor: getActor(c),
      p_idempotency_key: typeof body.idempotency_key === 'string' ? body.idempotency_key : null,
    });
    if (error) return rpcError(c, error, 'fork');
    return c.json(data, 201);
  } catch (error) {
    return apiError(c, 400, 'INVALID_WEEKLY_PLAN', (error as Error).message);
  }
});

export default router;
