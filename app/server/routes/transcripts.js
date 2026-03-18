import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import {
  validateStringLengths,
  sanitizeBody,
  validateTranscriptStatus,
  parsePagination,
} from '../middleware/validate.js';
import { getActor } from '../utils/actors.js';
import { ACTION_TEXT_FIELDS, validateActionFields } from '../utils/actionUtils.js';
import { coerceJsonArray, serializeJsonArray } from '../utils/json.js';
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

function validateTranscriptReferences(body) {
  const errors = [];

  const businessError = validateKnownBusinessId(body.business);
  if (businessError) errors.push(businessError);

  errors.push(...validateKnownMemberIds(body.participants, 'participants'));

  return errors;
}

function toTranscriptResponse(transcript) {
  return {
    ...transcript,
    participants: coerceJsonArray(transcript.participants),
    decisions: coerceJsonArray(transcript.decisions),
    open_questions: coerceJsonArray(transcript.open_questions),
  };
}

router.get('/', (req, res) => {
  try {
    const { status, business, search } = req.query;
    let sql = 'SELECT id, title, date, business, participants, summary, decisions, open_questions, action_count, status, summary_file, created_at FROM transcripts WHERE 1=1';
    const params = [];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (business) {
      sql += ' AND business = ?';
      params.push(business);
    }
    if (search) {
      sql += ' AND (title LIKE ? OR summary LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term);
    }

    sql += ' ORDER BY created_at DESC';

    const { limit, offset } = parsePagination(req.query);
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const transcripts = db.prepare(sql).all(...params);
    res.json(transcripts.map(toTranscriptResponse));
  } catch (err) {
    console.error(`[transcripts] GET error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const transcript = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(req.params.id);
    if (!transcript) return res.status(404).json({ error: 'Transcript not found' });

    const actions = db.prepare(`
      SELECT id, title, status, priority, owners, business, due_date
      FROM actions
      WHERE source_transcript_id = ?
    `).all(req.params.id);

    const response = toTranscriptResponse(transcript);
    response.actions = actions.map(action => ({
      ...action,
      owners: coerceJsonArray(action.owners),
    }));

    res.json(response);
  } catch (err) {
    console.error(`[transcripts] GET/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', (req, res) => {
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
      ...validateTranscriptReferences(body),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
    }

    db.prepare(`
      INSERT INTO transcripts (id, title, date, business, participants, raw_text, summary, decisions, open_questions, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      id,
      title,
      date,
      business,
      serializeJsonArray(participants),
      raw_text,
      summary,
      serializeJsonArray(decisions),
      serializeJsonArray(open_questions),
    );

    const transcript = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(id);
    res.status(201).json(toTranscriptResponse(transcript));
  } catch (err) {
    console.error(`[transcripts] POST error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/commit', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Transcript not found' });

    if (existing.status !== 'pending') {
      return res.status(409).json({ error: 'Transcript is not pending' });
    }

    const linkedActionCount = db.prepare('SELECT COUNT(*) AS count FROM actions WHERE source_transcript_id = ?').get(req.params.id).count;
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
        ...validateKnownMemberIds(action.owners),
        ...(validateKnownBusinessId(action.business, `Action ${i} business`) ? [validateKnownBusinessId(action.business, `Action ${i} business`)] : []),
        ...validateStringLengths(action),
      ];
      if (fieldErrors.length > 0) {
        return res.status(400).json({ error: `Action ${i}: ${fieldErrors.join('; ')}` });
      }
    }

    const transcriptValidationErrors = [
      ...validateTranscriptArrays(body),
      ...validateTranscriptReferences(body),
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

    const commitTx = db.transaction(() => {
      const insertAction = db.prepare(`
        INSERT INTO actions (id, title, description, status, business, priority, due_date, owners, source_transcript_id, source_label, tags, notes, recurrence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const logAction = db.prepare(`
        INSERT INTO activity_log (action_id, event, new_value, actor)
        VALUES (?, 'created', ?, ?)
      `);

      for (const action of actions) {
        const id = uuidv4();
        insertAction.run(
          id,
          action.title,
          action.description || '',
          action.status || 'not_started',
          action.business,
          action.priority || 'p2',
          action.due_date || null,
          serializeJsonArray(action.owners),
          req.params.id,
          action.source_label,
          serializeJsonArray(action.tags),
          action.notes || '',
          action.recurrence || 'none',
        );
        logAction.run(id, `Parsed from transcript ${req.params.id}`, actor);
        createdActionIds.push(id);
      }

      const updates = {
        action_count: createdActionIds.length,
        status: nextStatus,
      };
      if (body.title !== undefined) updates.title = body.title;
      if (body.date !== undefined) updates.date = body.date;
      if (body.business !== undefined) updates.business = body.business;
      if (body.participants !== undefined) updates.participants = serializeJsonArray(body.participants);
      if (body.raw_text !== undefined) updates.raw_text = body.raw_text;
      if (body.clear_raw_text === true) updates.raw_text = null;
      if (body.summary !== undefined) updates.summary = body.summary;
      if (body.decisions !== undefined) updates.decisions = serializeJsonArray(body.decisions);
      if (body.open_questions !== undefined) updates.open_questions = serializeJsonArray(body.open_questions);
      if (body.summary_file !== undefined) updates.summary_file = body.summary_file;

      const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      db.prepare(`UPDATE transcripts SET ${fields} WHERE id = ?`).run(...Object.values(updates), req.params.id);
    });
    commitTx();

    const transcript = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(req.params.id);
    const response = toTranscriptResponse(transcript);
    response.created_action_ids = createdActionIds;
    res.json(response);
  } catch (err) {
    console.error(`[transcripts] POST/:id/commit error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Transcript not found' });

    const body = sanitizeBody(req.body, TRANSCRIPT_TEXT_FIELDS);
    const {
      title, date, business, participants, raw_text, summary, decisions, open_questions, action_count, status, summary_file,
    } = body;

    const statusErr = validateTranscriptStatus(status);
    if (statusErr) return res.status(400).json({ error: statusErr });

    const validationErrors = [
      ...validateTranscriptArrays(body),
      ...validateTranscriptReferences(body),
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

    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    db.prepare(`UPDATE transcripts SET ${fields} WHERE id = ?`).run(...Object.values(updates), req.params.id);

    const transcript = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(req.params.id);
    res.json(toTranscriptResponse(transcript));
  } catch (err) {
    console.error(`[transcripts] PUT/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
