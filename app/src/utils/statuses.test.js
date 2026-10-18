import { describe, expect, it } from 'vitest';
import { canonicalStatus, KANBAN_COLUMNS, STATUS_LIST } from './statuses.js';

describe('shared action statuses', () => {
  it('preserves the fixed values and labels in their display order', () => {
    expect(STATUS_LIST.map(({ id, label }) => [id, label])).toEqual([
      ['open', 'Needs triage'], ['not_started', 'To do'], ['in_progress', 'In progress'],
      ['waiting', 'Waiting'], ['blocked', 'Blocked'], ['done', 'Done'], ['canceled', 'Canceled'], ['archived', 'Archived'],
    ]);
    expect(KANBAN_COLUMNS).toEqual(['open', 'not_started', 'in_progress', 'waiting', 'blocked', 'done', 'canceled']);
  });
  it.each([
    ['triage', 'open'], ['todo', 'not_started'], ['backlog', 'not_started'],
    ['completed', 'done'], ['closed', 'done'], ['cancelled', 'canceled'],
    [' OPEN ', 'open'], ['canceled', 'canceled'], ['archived', 'archived'],
    ['unrecognized', 'unknown'], [null, 'unknown'],
  ])('maps %s to %s for display without changing stored data', (input, expected) => {
    expect(canonicalStatus(input)).toBe(expected);
  });
});
