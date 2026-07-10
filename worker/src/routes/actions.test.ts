import { describe, expect, it } from 'vitest';
import { filterByOwner, includesAssignmentFields } from './actions';

describe('action assignment field protection', () => {
  it('detects owner and agent assignment changes', () => {
    expect(includesAssignmentFields({ owners: ['codex'] })).toBe(true);
    expect(includesAssignmentFields({ agent_assignment_id: 'assignment-1' })).toBe(true);
    expect(includesAssignmentFields({ title: 'Safe content update' })).toBe(false);
  });

  it('treats explicit null assignment changes as protected', () => {
    expect(includesAssignmentFields({ agent_assignment_id: null })).toBe(true);
    expect(includesAssignmentFields({ owners: undefined })).toBe(true);
  });
});

describe('action owner filtering', () => {
  it('filters decoded JSON owner arrays after complete loading', () => {
    const actions = [
      { id: 'a1', owners: ['codex'] },
      { id: 'a2', owners: ['ransomed', 'claude'] },
      { id: 'a3', owners: null },
    ];

    expect(filterByOwner(actions, 'claude').map(action => action.id)).toEqual(['a2']);
    expect(filterByOwner(actions)).toEqual(actions);
  });
});
