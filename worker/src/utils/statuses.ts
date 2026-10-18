// Fixed action statuses. Keep values and order aligned with app/src/utils/statuses.js.
export const ACTION_STATUSES = [
  { value: 'open', label: 'Needs triage' },
  { value: 'not_started', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'archived', label: 'Archived' },
];
export const STATUS_VALUES = ACTION_STATUSES.map(status => status.value);
export const STATUS_ALIASES: Record<string, string> = {
  triage: 'open', todo: 'not_started', backlog: 'not_started',
  completed: 'done', closed: 'done', cancelled: 'canceled',
};
export function canonicalStatus(value: unknown): unknown {
  return typeof value === 'string' ? STATUS_ALIASES[value] ?? value : value;
}

/** Expand a read filter to every stored spelling without rewriting historical rows. */
export function storedStatusValues(values: readonly string[]): string[] {
  const canonical = Array.from(new Set(values.map(value => String(canonicalStatus(value.trim().toLowerCase())))));
  return Array.from(new Set(canonical.flatMap(value => [
    value, ...Object.keys(STATUS_ALIASES).filter(alias => STATUS_ALIASES[alias] === value),
  ])));
}
