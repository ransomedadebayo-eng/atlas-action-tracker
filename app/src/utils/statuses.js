// Keep values and aliases aligned with worker/src/utils/statuses.ts.
export const STATUS_LIST = [
  { id: 'open', label: 'Needs triage', color: '#8cb8ff' },
  { id: 'not_started', label: 'To do', color: '#71717a' },
  { id: 'in_progress', label: 'In progress', color: '#3b82f6' },
  { id: 'waiting', label: 'Waiting', color: '#f59e0b' },
  { id: 'blocked', label: 'Blocked', color: '#ef4444' },
  { id: 'done', label: 'Done', color: '#f4b860' },
  { id: 'canceled', label: 'Canceled', color: '#a1a1aa' },
  { id: 'archived', label: 'Archived', color: '#71717a' },
].map((status, order) => ({ ...status, order }));

export const STATUS_ALIASES = {
  triage: 'open', todo: 'not_started', backlog: 'not_started',
  completed: 'done', closed: 'done', cancelled: 'canceled',
};
export const STATUSES = Object.fromEntries(STATUS_LIST.map(status => [status.id, status]));
export function canonicalStatus(status) {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  const value = STATUS_ALIASES[normalized] || normalized;
  return STATUSES[value] ? value : 'unknown';
}
export const KANBAN_COLUMNS = STATUS_LIST.filter(status => status.id !== 'archived').map(status => status.id);
