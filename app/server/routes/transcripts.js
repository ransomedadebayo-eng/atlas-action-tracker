import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { validateStringLengths, sanitizeBody, validateTranscriptStatus, parsePagination } from '../middleware/validate.js';

const router = Router();
const TEXT_FIELDS = ['title', 'raw_text', 'summary', 'summary_file'];

// GET /api/transcripts — List all transcripts (excludes raw_text for performance)
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

    // Pagination
    const { limit, offset } = parsePagination(req.query);
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const transcripts = db.prepare(sql).all(...params);

    const parsed = transcripts.map(t => ({
      ...t,
      participants: JSON.parse(t.participants || '[]'),
      decisions: JSON.parse(t.decisions || '[]'),
      open_questions: JSON.parse(t.open_questions || '[]'),
    }));

    res.json(parsed);
  } catch (err) {
    console.error(`[transcripts] GET error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/transcripts/:id — Get transcript with linked actions
router.get('/:id', (req, res) => {
  try {
    const transcript = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(req.params.id);
    if (!transcript) return res.status(404).json({ error: 'Transcript not found' });

    transcript.participants = JSON.parse(transcript.participants || '[]');
    transcript.decisions = JSON.parse(transcript.decisions || '[]');
    transcript.open_questions = JSON.parse(transcript.open_questions || '[]');

    // Get linked actions
    const actions = db.prepare(`
      SELECT id, title, status, priority, owners, business, due_date
      FROM actions WHERE source_transcript_id = ?
    `).all(req.params.id);

    transcript.actions = actions.map(a => ({
      ...a,
      owners: JSON.parse(a.owners || '[]'),
    }));

    res.json(transcript);
  } catch (err) {
    console.error(`[transcripts] GET/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/transcripts — Upload transcript
router.post('/', (req, res) => {
  try {
    // Always generate server-side ID; ignore any client-supplied id
    const id = `t-${uuidv4().split('-')[0]}`;
    const body = sanitizeBody(req.body, TEXT_FIELDS);
    const {
      title, date = null, business = null,
      participants = [], raw_text = '', summary = null,
      decisions = [], open_questions = []
    } = body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const lengthErrors = validateStringLengths(body);
    if (lengthErrors.length > 0) {
      return res.status(400).json({ error: lengthErrors.join('; ') });
    }

    db.prepare(`
      INSERT INTO transcripts (id, title, date, business, participants, raw_text, summary, decisions, open_questions, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      id, title, date, business,
      JSON.stringify(participants), raw_text, summary,
      JSON.stringify(decisions), JSON.stringify(open_questions)
    );

    const transcript = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(id);
    transcript.participants = JSON.parse(transcript.participants || '[]');
    transcript.decisions = JSON.parse(transcript.decisions || '[]');
    transcript.open_questions = JSON.parse(transcript.open_questions || '[]');

    res.status(201).json(transcript);
  } catch (err) {
    console.error(`[transcripts] POST error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/transcripts/:id — Update transcript
router.put('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Transcript not found' });

    const { title, date, business, participants, raw_text, summary, decisions, open_questions, action_count, status, summary_file } = req.body;

    // Validate transcript status
    const statusErr = validateTranscriptStatus(status);
    if (statusErr) return res.status(400).json({ error: statusErr });

    const lengthErrors = validateStringLengths(req.body);
    if (lengthErrors.length > 0) {
      return res.status(400).json({ error: lengthErrors.join('; ') });
    }

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (date !== undefined) updates.date = date;
    if (business !== undefined) updates.business = business;
    if (participants !== undefined) updates.participants = JSON.stringify(participants);
    if (raw_text !== undefined) updates.raw_text = raw_text;
    if (summary !== undefined) updates.summary = summary;
    if (decisions !== undefined) updates.decisions = JSON.stringify(decisions);
    if (open_questions !== undefined) updates.open_questions = JSON.stringify(open_questions);
    if (action_count !== undefined) updates.action_count = action_count;
    if (status !== undefined) updates.status = status;
    if (summary_file !== undefined) updates.summary_file = summary_file;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const vals = [...Object.values(updates), req.params.id];

    db.prepare(`UPDATE transcripts SET ${fields} WHERE id = ?`).run(...vals);

    const transcript = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(req.params.id);
    transcript.participants = JSON.parse(transcript.participants || '[]');
    transcript.decisions = JSON.parse(transcript.decisions || '[]');
    transcript.open_questions = JSON.parse(transcript.open_questions || '[]');

    res.json(transcript);
  } catch (err) {
    console.error(`[transcripts] PUT/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
