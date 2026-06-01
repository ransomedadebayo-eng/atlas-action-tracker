export const VALID_STATUSES = ['not_started', 'in_progress', 'waiting', 'blocked', 'done'];
export const VALID_PRIORITIES = ['p0', 'p1', 'p2', 'p3'];
export const VALID_RECURRENCES = ['none', 'daily', 'weekly', 'biweekly', 'monthly'];
export const VALID_WORK_MODES = ['autonomous', 'review_required', 'user_only'];
export const VALID_APPROVAL_STATES = ['not_required', 'needs_review', 'approved', 'rejected', 'deferred', 'user_only'];
export const ACTION_TEXT_FIELDS = [
  'title',
  'description',
  'notes',
  'append_note',
  'source_label',
  'next_action',
  'definition_of_done',
  'review_date',
  'approval_state',
  'agent_assignment_id',
];

const PRIORITY_COERCE = {
  critical: 'p0', high: 'p1', medium: 'p2', low: 'p3',
  p0: 'p0', p1: 'p1', p2: 'p2', p3: 'p3',
};
const STATUS_COERCE = {
  completed: 'done', frozen: 'done', todo: 'not_started',
  open: 'not_started', cancelled: 'done',
};
const WORK_MODE_COERCE = {
  auto: 'autonomous',
  autonomous: 'autonomous',
  codex: 'autonomous',
  review: 'review_required',
  approval: 'review_required',
  review_required: 'review_required',
  'review-required': 'review_required',
  user: 'user_only',
  user_only: 'user_only',
  'user-only': 'user_only',
};
const APPROVAL_STATE_COERCE = {
  review: 'needs_review',
  approval: 'needs_review',
  needs_review: 'needs_review',
  approved: 'approved',
  rejected: 'rejected',
  deferred: 'deferred',
  user_only: 'user_only',
  'user-only': 'user_only',
  none: 'not_required',
  not_required: 'not_required',
};

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function coercePriority(v) {
  if (typeof v !== 'string') return v;
  return PRIORITY_COERCE[v.toLowerCase()] ?? v;
}

export function coerceStatus(v) {
  if (typeof v !== 'string') return v;
  return STATUS_COERCE[v] ?? v;
}

export function coerceActionBody(body) {
  if (body.priority !== undefined) body.priority = coercePriority(body.priority);
  if (body.status !== undefined) body.status = coerceStatus(body.status);
  if (body.work_mode === '') body.work_mode = null;
  if (typeof body.work_mode === 'string') {
    body.work_mode = WORK_MODE_COERCE[body.work_mode.toLowerCase()] ?? body.work_mode;
  }
  if (body.approval_state === '') body.approval_state = 'not_required';
  if (typeof body.approval_state === 'string') {
    body.approval_state = APPROVAL_STATE_COERCE[body.approval_state.toLowerCase()] ?? body.approval_state;
  }
  if (body.agent_assignment_id === '') body.agent_assignment_id = null;
  if (body.review_date === '') body.review_date = null;
  return body;
}

export function computeNextDueDate(currentDueDate, recurrence) {
  if (!currentDueDate || recurrence === 'none') return null;

  const d = new Date(`${currentDueDate}T00:00:00`);
  switch (recurrence) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    default:
      return null;
  }

  return d.toISOString().split('T')[0];
}

export function validateActionFields(body) {
  const errors = [];

  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  if (body.priority !== undefined && !VALID_PRIORITIES.includes(body.priority)) {
    errors.push(`priority must be one of: ${VALID_PRIORITIES.join(', ')}`);
  }

  if (body.due_date !== undefined && body.due_date !== null) {
    if (typeof body.due_date !== 'string' || !DATE_REGEX.test(body.due_date)) {
      errors.push('due_date must be in YYYY-MM-DD format or null');
    }
  }

  if (body.review_date !== undefined && body.review_date !== null) {
    if (typeof body.review_date !== 'string' || !DATE_REGEX.test(body.review_date)) {
      errors.push('review_date must be in YYYY-MM-DD format or null');
    }
  }

  if (body.owners !== undefined) {
    if (!Array.isArray(body.owners) || !body.owners.every(owner => typeof owner === 'string')) {
      errors.push('owners must be an array of strings');
    }
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || !body.tags.every(tag => typeof tag === 'string')) {
      errors.push('tags must be an array of strings');
    }
  }

  if (body.recurrence !== undefined && !VALID_RECURRENCES.includes(body.recurrence)) {
    errors.push(`recurrence must be one of: ${VALID_RECURRENCES.join(', ')}`);
  }

  if (body.work_mode !== undefined && body.work_mode !== null && !VALID_WORK_MODES.includes(body.work_mode)) {
    errors.push(`work_mode must be one of: ${VALID_WORK_MODES.join(', ')}`);
  }

  if (body.approval_state !== undefined && body.approval_state !== null && !VALID_APPROVAL_STATES.includes(body.approval_state)) {
    errors.push(`approval_state must be one of: ${VALID_APPROVAL_STATES.join(', ')}`);
  }

  if (body.evidence_json !== undefined && body.evidence_json !== null) {
    if (typeof body.evidence_json !== 'object' || Array.isArray(body.evidence_json)) {
      errors.push('evidence_json must be an object');
    }
  }

  return errors;
}
