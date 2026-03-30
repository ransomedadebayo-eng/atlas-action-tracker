import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import supabase from '../db.js';
import {
  validateStringLengths,
  sanitizeBody,
  validateTranscriptStatus,
  parsePagination,
} from '../middleware/validate.js';
import { getActor } from '../utils/actors.js';
import { ACTION_TEXT_FIELDS, validateActionFields } from '../utils/actionUtils.js';
import { serializeJsonArray } from '../utils/json.js';
import { validateKnownBusinessId, validateKnownMemberIds } from '../utils/referenceData.js';

const router = Router();
const TRANSCRIPT_TEXT_FIELDS = ['title', 'raw_text', 'summary', 'summary_file'];
const COMMIT_MAX_ACTIONS = 100;

function validateTranscriptArrays(body) {
  const errors = [];

  if (body.participants !== undefined) {
    if (!Array.isArray(body.participants) || !body.participants.every(item => typeof item === 'string')) {
      errors.push('participants must be an array of strings');
    }
  }

  if (body.decisions !== undefined) {
    if (!Array.isArray(body.decisions) || !body.decisions.every(item => typeof item === 'string')) {
      errors.push('decisions must be an array of strings');
    }
  }

  if (body.open_questions !== undefined) {
    if (!Array.isArray(body.open_questions) || !body.open_questions.every(item => typeof item === 'string')) {
      errors.push('open_questions must be an array of strings');
    }
  }

  if (body.action_count !== undefined) {
    if (!Number.isInteger(body.action_count) || body.action_count < 0) {
      errors.push('action_count must be a non-negative integer');
    }
  }

  return errors;
}

async function validateTranscriptReferences(body) {
  const errors = [];

  const businessError = await validateKnownBusinessId(body.business);
  if (businessError) errors.push(businessError);

  errors.push(...(await validateKnownMemberIds(body.participants, 'participants')));

  return errors;
}

router.get('/', async (req, res) => {
  try {
    const { status, business, search } = req.query;
    let query = supabase
      .from('atlas_transcripts')
      .select('id, title, date, business, participants, summary, decisions, open_questions, action_count, status, summary_file, created_at');

    if (status) {
      query = query.eq('status', status);
    }
    if (business) {
      query = query.eq('business', business);
    }
    if (search) {
      const term = `%${search}%`;
      query = query.or(`title.ilike.${term},summary.ilike.${term}`);
    }

    query = query.order('created_at', { ascending: false });

    const { limit, offset } = parsePagination(req.query);
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error(`[transcripts] GET error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { data: transcript, error } = await supabase
      .from('atlas_transcripts')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !transcript) return res.status(404).json({ error: 'Transcript not found' });

    const { data: actions } = await supabase
      .from('atlas_actions')
      .select('id, title, status, priority, owners, business, due_date')
      .eq('source_transcript_id', req.params.id);

    transcript.actions = actions || [];
    res.json(transcript);
  } catch (err) {
    console.error(`[transcripts] GET/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const id = `t-${uuidv4().split('-')[0]}`;
    const body = sanitizeBody(req.body, TRANSCRIPT_TEXT_FIELDS);
    const {
      title,
      date = null,
      business = null,
      participants = [],
      raw_text = '',
      summary = null,
      decisions = [],
      open_questions = [],
    } = body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const validationErrors = [
      ...validateTranscriptArrays(body),
      ...(await validateTranscriptReferences(body)),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
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

    res.status(201).json(transcript);
  } catch (err) {
    console.error(`[transcripts] POST error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/commit', async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('atlas_transcripts')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Transcript not found' });

    if (existing.status !== 'pending') {
      return res.status(409).json({ error: 'Transcript is not pending' });
    }

    const { count: linkedActionCount } = await supabase
      .from('atlas_actions')
      .select('id', { count: 'exact', head: true })
      .eq('source_transcript_id', req.params.id);
    if (linkedActionCount > 0) {
      return res.status(409).json({ error: 'Transcript already has committed actions' });
    }

    const body = sanitizeBody(req.body, TRANSCRIPT_TEXT_FIELDS);
    const rawActions = Array.isArray(body.actions) ? body.actions : null;
    if (!rawActions) {
      return res.status(400).json({ error: 'actions array required' });
    }
    if (rawActions.length === 0) {
      return res.status(400).json({ error: 'actions array must contain at least one action' });
    }
    if (rawActions.length > COMMIT_MAX_ACTIONS) {
      return res.status(400).json({ error: `Commit operations limited to ${COMMIT_MAX_ACTIONS} actions` });
    }

    const nextBusiness = body.business !== undefined ? body.business : existing.business;
    const actions = rawActions.map(action => {
      const sanitized = sanitizeBody(action, ACTION_TEXT_FIELDS);
      return {
        ...sanitized,
        business: sanitized.business || nextBusiness,
        source_transcript_id: req.params.id,
        source_label: sanitized.source_label || body.title || existing.title,
      };
    });

    for (let i = 0; i < actions.length; i += 1) {
      const action = actions[i];
      if (!action.title || !action.business) {
        return res.status(400).json({ error: `Action ${i}: title and business are required` });
      }

      const fieldErrors = [
        ...validateActionFields(action),
        ...(await validateKnownMemberIds(action.owners)),
        ...((await validateKnownBusinessId(action.business, `Action ${i} business`)) ? [await validateKnownBusinessId(action.business, `Action ${i} business`)] : []),
        ...validateStringLengths(action),
      ];
      if (fieldErrors.length > 0) {
        return res.status(400).json({ error: `Action ${i}: ${fieldErrors.join('; ')}` });
      }
    }

    const transcriptValidationErrors = [
      ...validateTranscriptArrays(body),
      ...(await validateTranscriptReferences(body)),
      ...validateStringLengths(body),
    ];
    if (transcriptValidationErrors.length > 0) {
      return res.status(400).json({ error: transcriptValidationErrors.join('; ') });
    }

    const nextStatus = body.status ?? 'reviewed';
    if (nextStatus === 'pending') {
      return res.status(400).json({ error: 'Committed transcripts cannot remain pending' });
    }
    const statusErr = validateTranscriptStatus(nextStatus);
    if (statusErr) return res.status(400).json({ error: statusErr });

    const actor = getActor(req, 'claude');
    const createdActionIds = [];

    // Insert actions
    const actionRows = actions.map(action => {
      const id = uuidv4();
      createdActionIds.push(id);
      return {
        id,
        title: action.title,
        description: action.description || '',
        status: action.status || 'not_started',
        business: action.business,
        priority: action.priority || 'p2',
        due_date: action.due_date || null,
        owners: serializeJsonArray(action.owners),
        source_transcript_id: req.params.id,
        source_label: action.source_label,
        tags: serializeJsonArray(action.tags),
        notes: action.notes || '',
        recurrence: action.recurrence || 'none',
      };
    });

    const { error: insertErr } = await supabase.from('atlas_actions').insert(actionRows);
    if (insertErr) throw insertErr;

    // Log action creation
    const logRows = actionRows.map(row => ({
      action_id: row.id,
      event: 'created',
      new_value: `Parsed from transcript ${req.params.id}`,
      actor,
    }));
    await supabase.from('atlas_activity_log').insert(logRows);

    // Update transcript
    const transcriptUpdates = {
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
      .eq('id', req.params.id)
      .select()
      .single();
    if (updateErr) throw updateErr;

    transcript.created_action_ids = createdActionIds;
    res.json(transcript);
  } catch (err) {
    console.error(`[transcripts] POST/:id/commit error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('atlas_transcripts')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Transcript not found' });

    const body = sanitizeBody(req.body, TRANSCRIPT_TEXT_FIELDS);
    const {
      title, date, business, participants, raw_text, summary, decisions, open_questions, action_count, status, summary_file,
    } = body;

    const statusErr = validateTranscriptStatus(status);
    if (statusErr) return res.status(400).json({ error: statusErr });

    const validationErrors = [
      ...validateTranscriptArrays(body),
      ...(await validateTranscriptReferences(body)),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
    }

    const updates = {};
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
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data: transcript, error } = await supabase
      .from('atlas_transcripts')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;

    res.json(transcript);
  } catch (err) {
    console.error(`[transcripts] PUT/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
