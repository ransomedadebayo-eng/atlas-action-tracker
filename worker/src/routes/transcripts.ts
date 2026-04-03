import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, getDb } from '../db';
import {
  validateStringLengths,
  sanitizeBody,
  validateTranscriptStatus,
  parsePagination,
} from '../middleware/validate';
import { getActor } from '../utils/actors';
import { ACTION_TEXT_FIELDS, validateActionFields } from '../utils/actionUtils';
import { serializeJsonArray } from '../utils/json';
import { validateKnownBusinessId, validateKnownMemberIds } from '../utils/referenceData';
import { SupabaseClient } from '@supabase/supabase-js';

const router = new Hono<{ Bindings: Env }>();
const TRANSCRIPT_TEXT_FIELDS = ['title', 'raw_text', 'summary', 'summary_file'];
const COMMIT_MAX_ACTIONS = 100;

function validateTranscriptArrays(body: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (body.participants !== undefined) {
    if (!Array.isArray(body.participants) || !(body.participants as unknown[]).every(item => typeof item === 'string')) {
      errors.push('participants must be an array of strings');
    }
  }
  if (body.decisions !== undefined) {
    if (!Array.isArray(body.decisions) || !(body.decisions as unknown[]).every(item => typeof item === 'string')) {
      errors.push('decisions must be an array of strings');
    }
  }
  if (body.open_questions !== undefined) {
    if (!Array.isArray(body.open_questions) || !(body.open_questions as unknown[]).every(item => typeof item === 'string')) {
      errors.push('open_questions must be an array of strings');
    }
  }
  if (body.action_count !== undefined) {
    if (!Number.isInteger(body.action_count) || (body.action_count as number) < 0) {
      errors.push('action_count must be a non-negative integer');
    }
  }

  return errors;
}

async function validateTranscriptReferences(supabase: SupabaseClient, body: Record<string, unknown>): Promise<string[]> {
  const errors: string[] = [];

  const businessError = await validateKnownBusinessId(supabase, body.business);
  if (businessError) errors.push(businessError);

  errors.push(...(await validateKnownMemberIds(supabase, body.participants, 'participants')));

  return errors;
}

router.get('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    const status = c.req.query('status');
    const business = c.req.query('business');
    const search = c.req.query('search');

    let query = supabase
      .from('atlas_transcripts')
      .select('id, title, date, business, participants, summary, decisions, open_questions, action_count, status, summary_file, created_at');

    if (status) query = query.eq('status', status);
    if (business) query = query.eq('business', business);
    if (search) {
      const term = `%${search}%`;
      query = query.or(`title.ilike.${term},summary.ilike.${term}`);
    }

    query = query.order('created_at', { ascending: false });

    const { limit, offset } = parsePagination(Object.fromEntries(new URL(c.req.url).searchParams));
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;
    if (error) throw error;

    return c.json(data || []);
  } catch (err: unknown) {
    console.error(`[transcripts] GET error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.get('/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const id = c.req.param('id');

    const { data: transcript, error } = await supabase
      .from('atlas_transcripts')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !transcript) return c.json({ error: 'Transcript not found' }, 404);

    const { data: actions } = await supabase
      .from('atlas_actions')
      .select('id, title, status, priority, owners, business, due_date')
      .eq('source_transcript_id', id);

    transcript.actions = actions || [];
    return c.json(transcript);
  } catch (err: unknown) {
    console.error(`[transcripts] GET/:id error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    let raw: unknown;
    try { raw = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const id = `t-${uuidv4().split('-')[0]}`;
    const body = sanitizeBody(raw as Record<string, unknown>, TRANSCRIPT_TEXT_FIELDS);
    const {
      title,
      date = null,
      business = null,
      participants = [],
      raw_text = '',
      summary = null,
      decisions = [],
      open_questions = [],
    } = body as Record<string, unknown>;

    if (!title) {
      return c.json({ error: 'title is required' }, 400);
    }

    const validationErrors = [
      ...validateTranscriptArrays(body),
      ...(await validateTranscriptReferences(supabase, body)),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return c.json({ error: validationErrors.join('; ') }, 400);
    }

    const { data: transcript, error } = await supabase
      .from('atlas_transcripts')
      .insert({
        id,
        title,
        date,
        business,
        participants: serializeJsonArray(participants),
        raw_text,
        summary,
        decisions: serializeJsonArray(decisions),
        open_questions: serializeJsonArray(open_questions),
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;

    return c.json(transcript, 201);
  } catch (err: unknown) {
    console.error(`[transcripts] POST error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/:id/commit', async (c) => {
  try {
    const supabase = getDb(c.env);
    const id = c.req.param('id');

    const { data: existing, error: fetchErr } = await supabase
      .from('atlas_transcripts')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr || !existing) return c.json({ error: 'Transcript not found' }, 404);

    if (existing.status !== 'pending') {
      return c.json({ error: 'Transcript is not pending' }, 409);
    }

    const { count: linkedActionCount } = await supabase
      .from('atlas_actions')
      .select('id', { count: 'exact', head: true })
      .eq('source_transcript_id', id);
    if ((linkedActionCount ?? 0) > 0) {
      return c.json({ error: 'Transcript already has committed actions' }, 409);
    }

    let raw: unknown;
    try { raw = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const body = sanitizeBody(raw as Record<string, unknown>, TRANSCRIPT_TEXT_FIELDS);
    const rawActions = Array.isArray(body.actions) ? body.actions as Record<string, unknown>[] : null;
    if (!rawActions) return c.json({ error: 'actions array required' }, 400);
    if (rawActions.length === 0) return c.json({ error: 'actions array must contain at least one action' }, 400);
    if (rawActions.length > COMMIT_MAX_ACTIONS) {
      return c.json({ error: `Commit operations limited to ${COMMIT_MAX_ACTIONS} actions` }, 400);
    }

    const nextBusiness = body.business !== undefined ? body.business : existing.business;
    const actions: Record<string, unknown>[] = rawActions.map(action => {
      const sanitized = sanitizeBody(action, ACTION_TEXT_FIELDS);
      return {
        ...sanitized,
        business: sanitized.business || nextBusiness,
        source_transcript_id: id,
        source_label: sanitized.source_label || body.title || existing.title,
      };
    });

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      if (!action.title || !action.business) {
        return c.json({ error: `Action ${i}: title and business are required` }, 400);
      }

      const businessErr = await validateKnownBusinessId(supabase, action.business, `Action ${i} business`);
      const fieldErrors = [
        ...validateActionFields(action),
        ...(await validateKnownMemberIds(supabase, action.owners)),
        ...(businessErr ? [businessErr] : []),
        ...validateStringLengths(action),
      ];
      if (fieldErrors.length > 0) {
        return c.json({ error: `Action ${i}: ${fieldErrors.join('; ')}` }, 400);
      }
    }

    const transcriptValidationErrors = [
      ...validateTranscriptArrays(body),
      ...(await validateTranscriptReferences(supabase, body)),
      ...validateStringLengths(body),
    ];
    if (transcriptValidationErrors.length > 0) {
      return c.json({ error: transcriptValidationErrors.join('; ') }, 400);
    }

    const nextStatus = (body.status as string) ?? 'reviewed';
    if (nextStatus === 'pending') {
      return c.json({ error: 'Committed transcripts cannot remain pending' }, 400);
    }
    const statusErr = validateTranscriptStatus(nextStatus);
    if (statusErr) return c.json({ error: statusErr }, 400);

    const actor = getActor(c, 'claude');
    const createdActionIds: string[] = [];

    const actionRows = actions.map(action => {
      const actionId = uuidv4();
      createdActionIds.push(actionId);
      return {
        id: actionId,
        title: action.title,
        description: action.description || '',
        status: action.status || 'not_started',
        business: action.business,
        priority: action.priority || 'p2',
        due_date: action.due_date || null,
        owners: serializeJsonArray(action.owners),
        source_transcript_id: id,
        source_label: action.source_label,
        tags: serializeJsonArray(action.tags),
        notes: action.notes || '',
        recurrence: action.recurrence || 'none',
      };
    });

    const { error: insertErr } = await supabase.from('atlas_actions').insert(actionRows);
    if (insertErr) throw insertErr;

    const logRows = actionRows.map(row => ({
      action_id: row.id,
      event: 'created',
      new_value: `Parsed from transcript ${id}`,
      actor,
    }));
    await supabase.from('atlas_activity_log').insert(logRows);

    const transcriptUpdates: Record<string, unknown> = {
      action_count: createdActionIds.length,
      status: nextStatus,
    };
    if (body.title !== undefined) transcriptUpdates.title = body.title;
    if (body.date !== undefined) transcriptUpdates.date = body.date;
    if (body.business !== undefined) transcriptUpdates.business = body.business;
    if (body.participants !== undefined) transcriptUpdates.participants = serializeJsonArray(body.participants);
    if (body.raw_text !== undefined) transcriptUpdates.raw_text = body.raw_text;
    if (body.clear_raw_text === true) transcriptUpdates.raw_text = null;
    if (body.summary !== undefined) transcriptUpdates.summary = body.summary;
    if (body.decisions !== undefined) transcriptUpdates.decisions = serializeJsonArray(body.decisions);
    if (body.open_questions !== undefined) transcriptUpdates.open_questions = serializeJsonArray(body.open_questions);
    if (body.summary_file !== undefined) transcriptUpdates.summary_file = body.summary_file;

    const { data: transcript, error: updateErr } = await supabase
      .from('atlas_transcripts')
      .update(transcriptUpdates)
      .eq('id', id)
      .select()
      .single();
    if (updateErr) throw updateErr;

    transcript.created_action_ids = createdActionIds;
    return c.json(transcript);
  } catch (err: unknown) {
    console.error(`[transcripts] POST/:id/commit error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.put('/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const id = c.req.param('id');

    const { data: existing, error: fetchErr } = await supabase
      .from('atlas_transcripts')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr || !existing) return c.json({ error: 'Transcript not found' }, 404);

    let raw: unknown;
    try { raw = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const body = sanitizeBody(raw as Record<string, unknown>, TRANSCRIPT_TEXT_FIELDS);
    const {
      title, date, business, participants, raw_text, summary,
      decisions, open_questions, action_count, status, summary_file,
    } = body as Record<string, unknown>;

    const statusErr = validateTranscriptStatus(status as string | undefined);
    if (statusErr) return c.json({ error: statusErr }, 400);

    const validationErrors = [
      ...validateTranscriptArrays(body),
      ...(await validateTranscriptReferences(supabase, body)),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return c.json({ error: validationErrors.join('; ') }, 400);
    }

    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (date !== undefined) updates.date = date;
    if (business !== undefined) updates.business = business;
    if (participants !== undefined) updates.participants = serializeJsonArray(participants);
    if (raw_text !== undefined) updates.raw_text = raw_text;
    if (summary !== undefined) updates.summary = summary;
    if (decisions !== undefined) updates.decisions = serializeJsonArray(decisions);
    if (open_questions !== undefined) updates.open_questions = serializeJsonArray(open_questions);
    if (action_count !== undefined) updates.action_count = action_count;
    if (status !== undefined) updates.status = status;
    if (summary_file !== undefined) updates.summary_file = summary_file;

    if (Object.keys(updates).length === 0) {
      return c.json({ error: 'No fields to update' }, 400);
    }

    const { data: transcript, error } = await supabase
      .from('atlas_transcripts')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    return c.json(transcript);
  } catch (err: unknown) {
    console.error(`[transcripts] PUT/:id error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default router;
