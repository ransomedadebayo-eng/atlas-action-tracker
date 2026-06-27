import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import supabase from '../db.js';
import { getActor } from '../utils/actors.js';
import { buildSafeIlikePattern } from '../utils/search.js';
import { coerceJsonArray, coerceJsonObject } from '../utils/json.js';

const router = Router();
const VALID_KINDS = new Set(['thought', 'idea', 'journal', 'reflection', 'question']);
const VALID_REVIEW_STATES = new Set(['unreviewed', 'reviewed', 'promoted', 'archived']);

function normalizeTags(value) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]/) : [];
  return Array.from(new Set(raw
    .map(tag => String(tag).trim().toLowerCase())
    .filter(Boolean)
    .map(tag => tag.replace(/[^a-z0-9_-]+/g, '-').replace(/(^-|-$)/g, ''))
    .filter(Boolean)))
    .slice(0, 12);
}

function cleanTitle(value) {
  const title = typeof value === 'string' ? value.trim() : '';
  return title ? title.slice(0, 160) : null;
}

function fallbackTitle(entry) {
  const title = cleanTitle(entry.title);
  if (title) return title;
  const body = typeof entry.body === 'string' ? entry.body : '';
  return body.split(/\s+/).filter(Boolean).slice(0, 10).join(' ') || 'Journal promotion';
}

router.get('/', async (req, res) => {
  try {
    const {
      kind = 'all',
      review_state = 'all',
      source = 'all',
      search = '',
      include_archived = 'false',
      limit = '100',
    } = req.query;

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
    res.json({ entries: data || [] });
  } catch (err) {
    console.error(`[journal] GET error: ${err.message}`);
    res.status(500).json({ error: 'Could not load journal entries.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const text = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    if (!text) return res.status(400).json({ error: 'Journal body is required.' });
    if (text.length > 20000) return res.status(400).json({ error: 'Journal body is too long.' });

    const kind = VALID_KINDS.has(String(req.body.kind)) ? String(req.body.kind) : 'thought';
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('peos_journal_entries')
      .insert({
        kind,
        title: cleanTitle(req.body.title),
        body: text,
        tags: normalizeTags(req.body.tags),
        captured_at: typeof req.body.captured_at === 'string' ? req.body.captured_at : now,
        source: 'site',
        source_ref: cleanTitle(req.body.source_ref),
        review_state: 'unreviewed',
        promoted_targets: [],
        metadata: { captured_from: 'atlas_journal' },
      })
      .select('*')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error(`[journal] POST error: ${err.message}`);
    res.status(500).json({ error: 'Could not save journal entry.' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const patch = {};
    if (req.body.kind !== undefined && VALID_KINDS.has(String(req.body.kind))) patch.kind = req.body.kind;
    if (req.body.title !== undefined) patch.title = cleanTitle(req.body.title);
    if (req.body.body !== undefined) {
      const text = typeof req.body.body === 'string' ? req.body.body.trim() : '';
      if (!text) return res.status(400).json({ error: 'Journal body is required.' });
      patch.body = text;
    }
    if (req.body.tags !== undefined) patch.tags = normalizeTags(req.body.tags);
    if (req.body.review_state !== undefined && VALID_REVIEW_STATES.has(String(req.body.review_state))) {
      patch.review_state = req.body.review_state;
      if (req.body.review_state === 'archived') patch.archived_at = new Date().toISOString();
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields to update.' });

    const { data, error } = await supabase
      .from('peos_journal_entries')
      .update(patch)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(`[journal] PUT error: ${err.message}`);
    res.status(500).json({ error: 'Could not update journal entry.' });
  }
});

router.post('/:id/archive', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('peos_journal_entries')
      .update({ review_state: 'archived', archived_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(`[journal] archive error: ${err.message}`);
    res.status(500).json({ error: 'Could not archive journal entry.' });
  }
});

router.post('/:id/promote', async (req, res) => {
  try {
    const actor = getActor(req);
    const { data: entry, error: fetchError } = await supabase
      .from('peos_journal_entries')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchError || !entry) return res.status(404).json({ error: 'Journal entry not found.' });
    if (!['reviewed', 'promoted'].includes(String(entry.review_state))) {
      return res.status(400).json({ error: 'Review the journal entry before promotion.' });
    }

    const actionId = uuidv4();
    const title = cleanTitle(req.body.title) || fallbackTitle(entry);
    const description = typeof req.body.description === 'string' && req.body.description.trim()
      ? req.body.description.trim()
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
        business: typeof req.body.business === 'string' && req.body.business ? req.body.business : 'personal',
        priority: typeof req.body.priority === 'string' && req.body.priority ? req.body.priority : 'p2',
        status: 'not_started',
        owners: [],
        tags: coerceJsonArray(entry.tags),
        notes: 'Promoted from Atlas Journal.',
        source_label: 'Atlas Journal',
        work_mode: 'review_required',
        next_action: typeof req.body.next_action === 'string' && req.body.next_action.trim()
          ? req.body.next_action.trim()
          : 'Review promoted journal item and decide the execution path.',
        definition_of_done: typeof req.body.definition_of_done === 'string' && req.body.definition_of_done.trim()
          ? req.body.definition_of_done.trim()
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

    res.status(201).json({ entry: updated, action });
  } catch (err) {
    console.error(`[journal] promote error: ${err.message}`);
    res.status(500).json({ error: 'Could not promote journal entry.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('peos_journal_entries').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error(`[journal] DELETE error: ${err.message}`);
    res.status(500).json({ error: 'Could not delete journal entry.' });
  }
});

export default router;
