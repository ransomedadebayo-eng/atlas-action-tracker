import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, getDb } from '../db';
import { getActor } from '../utils/actors';
import { buildSafeIlikePattern } from '../utils/search';
import { coerceJsonArray, coerceJsonObject } from '../utils/json';

const router = new Hono<{ Bindings: Env }>();

const VALID_KINDS = new Set(['thought', 'idea', 'journal', 'reflection', 'question']);
const VALID_REVIEW_STATES = new Set(['unreviewed', 'reviewed', 'promoted', 'archived']);

function normalizeTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]/) : [];
  return Array.from(new Set(raw
    .map((tag) => String(tag).trim().toLowerCase())
    .filter(Boolean)
    .map((tag) => tag.replace(/[^a-z0-9_-]+/g, '-').replace(/(^-|-$)/g, ''))
    .filter(Boolean)))
    .slice(0, 12);
}

function cleanTitle(value: unknown) {
  const title = typeof value === 'string' ? value.trim() : '';
  return title ? title.slice(0, 160) : null;
}

function fallbackTitle(entry: Record<string, unknown>) {
  const title = cleanTitle(entry.title);
  if (title) return title;
  const body = typeof entry.body === 'string' ? entry.body : '';
  return body.split(/\s+/).filter(Boolean).slice(0, 10).join(' ') || 'Journal promotion';
}

router.get('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    const {
      kind = 'all',
      review_state = 'all',
      source = 'all',
      search = '',
      include_archived = 'false',
      limit = '100',
    } = c.req.query() as Record<string, string>;

    let query = supabase
      .from('peos_journal_entries')
      .select('*')
      .order('captured_at', { ascending: false })
      .limit(Math.min(Number(limit) || 100, 200));

    if (review_state !== 'all' && VALID_REVIEW_STATES.has(review_state)) {
      query = query.eq('review_state', review_state);
    } else if (include_archived !== 'true') {
      query = query.is('archived_at', null);
    }
    if (kind !== 'all' && VALID_KINDS.has(kind)) query = query.eq('kind', kind);
    if (source !== 'all') query = query.eq('source', source);

    const searchTerm = buildSafeIlikePattern(search);
    if (searchTerm) query = query.or(`title.ilike.${searchTerm},body.ilike.${searchTerm}`);

    const { data, error } = await query;
    if (error) throw error;
    return c.json({ entries: data || [] });
  } catch (err) {
    console.error(`[journal] GET error: ${(err as Error).message}`);
    return c.json({ error: 'Could not load journal entries.' }, 500);
  }
});

router.post('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!text) return c.json({ error: 'Journal body is required.' }, 400);
    if (text.length > 20000) return c.json({ error: 'Journal body is too long.' }, 400);

    const kind = VALID_KINDS.has(String(body.kind)) ? String(body.kind) : 'thought';
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('peos_journal_entries')
      .insert({
        kind,
        title: cleanTitle(body.title),
        body: text,
        tags: normalizeTags(body.tags),
        captured_at: typeof body.captured_at === 'string' ? body.captured_at : now,
        source: 'site',
        source_ref: cleanTitle(body.source_ref),
        review_state: 'unreviewed',
        promoted_targets: [],
        metadata: { captured_from: 'atlas_journal' },
      })
      .select('*')
      .single();

    if (error) throw error;
    return c.json(data, 201);
  } catch (err) {
    console.error(`[journal] POST error: ${(err as Error).message}`);
    return c.json({ error: 'Could not save journal entry.' }, 500);
  }
});

router.put('/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const patch: Record<string, unknown> = {};
    if (body.kind !== undefined && VALID_KINDS.has(String(body.kind))) patch.kind = body.kind;
    if (body.title !== undefined) patch.title = cleanTitle(body.title);
    if (body.body !== undefined) {
      const text = typeof body.body === 'string' ? body.body.trim() : '';
      if (!text) return c.json({ error: 'Journal body is required.' }, 400);
      patch.body = text;
    }
    if (body.tags !== undefined) patch.tags = normalizeTags(body.tags);
    if (body.review_state !== undefined && VALID_REVIEW_STATES.has(String(body.review_state))) {
      patch.review_state = body.review_state;
      if (body.review_state === 'archived') patch.archived_at = new Date().toISOString();
    }
    if (Object.keys(patch).length === 0) return c.json({ error: 'No valid fields to update.' }, 400);

    const { data, error } = await supabase
      .from('peos_journal_entries')
      .update(patch)
      .eq('id', c.req.param('id'))
      .select('*')
      .single();
    if (error) throw error;
    return c.json(data);
  } catch (err) {
    console.error(`[journal] PUT error: ${(err as Error).message}`);
    return c.json({ error: 'Could not update journal entry.' }, 500);
  }
});

router.post('/:id/archive', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data, error } = await supabase
      .from('peos_journal_entries')
      .update({ review_state: 'archived', archived_at: new Date().toISOString() })
      .eq('id', c.req.param('id'))
      .select('*')
      .single();
    if (error) throw error;
    return c.json(data);
  } catch (err) {
    console.error(`[journal] archive error: ${(err as Error).message}`);
    return c.json({ error: 'Could not archive journal entry.' }, 500);
  }
});

router.post('/:id/promote', async (c) => {
  try {
    const supabase = getDb(c.env);
    const actor = getActor(c);
    const body = await c.req.json<Record<string, unknown>>();
    const { data: entry, error: fetchError } = await supabase
      .from('peos_journal_entries')
      .select('*')
      .eq('id', c.req.param('id'))
      .single();
    if (fetchError || !entry) return c.json({ error: 'Journal entry not found.' }, 404);
    if (!['reviewed', 'promoted'].includes(String(entry.review_state))) {
      return c.json({ error: 'Review the journal entry before promotion.' }, 400);
    }

    const actionId = uuidv4();
    const title = cleanTitle(body.title) || fallbackTitle(entry);
    const description = typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : String(entry.body || '');
    const now = new Date().toISOString();
    const evidence = {
      promoted_from_journal: entry.id,
      journal_captured_at: entry.captured_at,
      actor_id: actor,
    };

    const { data: action, error: actionError } = await supabase
      .from('atlas_actions')
      .insert({
        id: actionId,
        title,
        description,
        business: typeof body.business === 'string' && body.business ? body.business : 'personal',
        priority: typeof body.priority === 'string' && body.priority ? body.priority : 'p2',
        status: 'not_started',
        owners: [],
        tags: coerceJsonArray(entry.tags),
        notes: 'Promoted from Atlas Journal.',
        source_label: 'Atlas Journal',
        work_mode: 'review_required',
        next_action: typeof body.next_action === 'string' && body.next_action.trim()
          ? body.next_action.trim()
          : 'Review promoted journal item and decide the execution path.',
        definition_of_done: typeof body.definition_of_done === 'string' && body.definition_of_done.trim()
          ? body.definition_of_done.trim()
          : 'Journal entry has been turned into a tracked Atlas action.',
        evidence_json: evidence,
        approval_state: 'needs_review',
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    if (actionError) throw actionError;

    const promotedTargets = coerceJsonArray(entry.promoted_targets);
    const metadata = coerceJsonObject(entry.metadata);
    const { data: updated, error: updateError } = await supabase
      .from('peos_journal_entries')
      .update({
        review_state: 'promoted',
        promoted_targets: [
          ...promotedTargets,
          { target_type: 'atlas_action', target_id: action.id, promoted_at: now },
        ],
        metadata: { ...metadata, last_promotion: { target_type: 'atlas_action', target_id: action.id } },
      })
      .eq('id', entry.id)
      .select('*')
      .single();
    if (updateError) throw updateError;

    await supabase.from('atlas_activity_log').insert({
      action_id: action.id,
      event: 'created',
      new_value: title,
      actor,
    });

    return c.json({ entry: updated, action }, 201);
  } catch (err) {
    console.error(`[journal] promote error: ${(err as Error).message}`);
    return c.json({ error: 'Could not promote journal entry.' }, 500);
  }
});

router.delete('/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { error } = await supabase.from('peos_journal_entries').delete().eq('id', c.req.param('id'));
    if (error) throw error;
    return c.json({ ok: true });
  } catch (err) {
    console.error(`[journal] DELETE error: ${(err as Error).message}`);
    return c.json({ error: 'Could not delete journal entry.' }, 500);
  }
});

export default router;
