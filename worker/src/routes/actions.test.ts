import { describe, expect, it } from 'vitest';
import { calculateActionChildProgress, filterByOwner, includesAssignmentFields, normalizeActionRelation } from './actions';

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

describe('action hierarchy and relation helpers', () => {
  it('rolls up child count and effort with one point for unestimated work', () => {
    expect(calculateActionChildProgress([
      { status: 'done', estimate_points: 3 },
      { status: 'in_progress', estimate_points: null },
      { status: 'done', estimate_points: 0 },
    ])).toEqual({
      total_children: 3,
      completed_children: 2,
      total_effort: 4,
      completed_effort: 3,
      progress_percent: 75,
    });
  });

  it('normalizes symmetric and directional relations', () => {
    expect(normalizeActionRelation('b', 'a', 'related')).toEqual({ source_action_id: 'a', target_action_id: 'b', relation_type: 'related' });
    expect(normalizeActionRelation('a', 'b', 'blocks')).toEqual({ source_action_id: 'a', target_action_id: 'b', relation_type: 'blocks' });
    expect(normalizeActionRelation('a', 'b', 'blocked_by')).toEqual({ source_action_id: 'b', target_action_id: 'a', relation_type: 'blocks' });
    expect(normalizeActionRelation('a', 'a', 'related')).toBeNull();
    expect(normalizeActionRelation('a', 'b', 'duplicate')).toBeNull();
  });
});
