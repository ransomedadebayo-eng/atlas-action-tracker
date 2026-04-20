export const VALID_STATUSES = ['not_started', 'in_progress', 'waiting', 'blocked', 'done'];
export const VALID_PRIORITIES = ['p0', 'p1', 'p2', 'p3'];
export const VALID_RECURRENCES = ['none', 'daily', 'weekly', 'biweekly', 'monthly'];
export const ACTION_TEXT_FIELDS = ['title', 'description', 'notes', 'append_note', 'source_label'];

const PRIORITY_COERCE: Record<string, string> = {
  critical: 'p0', high: 'p1', medium: 'p2', low: 'p3',
  p0: 'p0', p1: 'p1', p2: 'p2', p3: 'p3',
};
const STATUS_COERCE: Record<string, string> = {
  completed: 'done', frozen: 'done', todo: 'not_started',
  open: 'not_started', cancelled: 'done',
};

export function coercePriority(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  return PRIORITY_COERCE[v.toLowerCase()] ?? v;
}
export function coerceStatus(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  return STATUS_COERCE[v] ?? v;
}

export function coerceActionBody(body: Record<string, unknown>): Record<string, unknown> {
  if (body.priority !== undefined) body.priority = coercePriority(body.priority);
  if (body.status !== undefined) body.status = coerceStatus(body.status);
  return body;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function computeNextDueDate(currentDueDate: string | null | undefined, recurrence: string): string | null {
  if (!currentDueDate || recurrence === 'none') return null;
  const d = new Date(`${currentDueDate}T00:00:00`);
  switch (recurrence) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'biweekly': d.setDate(d.getDate() + 14); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    default: return null;
  }
  return d.toISOString().split('T')[0];
}

export function validateActionFields(body: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (body.status !== undefined && !VALID_STATUSES.includes(body.status as string)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }
  if (body.priority !== undefined && !VALID_PRIORITIES.includes(body.priority as string)) {
    errors.push(`priority must be one of: ${VALID_PRIORITIES.join(', ')}`);
  }
  if (body.due_date !== undefined && body.due_date !== null) {
    if (typeof body.due_date !== 'string' || !DATE_REGEX.test(body.due_date)) {
      errors.push('due_date must be in YYYY-MM-DD format or null');
    }
  }
  if (body.owners !== undefined) {
    if (!Array.isArray(body.owners) || !(body.owners as unknown[]).every(o => typeof o === 'string')) {
      errors.push('owners must be an array of strings');
    }
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || !(body.tags as unknown[]).every(t => typeof t === 'string')) {
      errors.push('tags must be an array of strings');
    }
  }
  if (body.recurrence !== undefined && !VALID_RECURRENCES.includes(body.recurrence as string)) {
    errors.push(`recurrence must be one of: ${VALID_RECURRENCES.join(', ')}`);
  }
  return errors;
}
