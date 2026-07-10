import { describe, expect, it } from 'vitest';
import { includesAssignmentFields } from './actions';

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
