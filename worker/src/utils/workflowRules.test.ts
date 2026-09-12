import { describe, expect, it } from 'vitest';
import {
  evaluateWorkflowRules,
  matchesWorkflowCondition,
  matchesWorkflowRule,
  validateWorkflowRuleInput,
} from './workflowRules';

const action = {
  id: 'a1', title: 'Fix mobile login', description: 'OAuth fails on iOS',
  source_label: 'support', priority: 'p1', status: 'not_started', business: 'personal',
  tags: ['ios', 'customer'], owners: ['ransomed'], project_id: 'p1', work_mode: 'review_required',
  workflow_status: { category: 'unstarted' },
};

describe('workflow condition evaluation', () => {
  it('matches scalar equality case-insensitively', () => {
    expect(matchesWorkflowCondition(action, { field: 'priority', operator: 'eq', value: 'P1' })).toBe(true);
  });
  it('matches text and array containment', () => {
    expect(matchesWorkflowCondition(action, { field: 'title', operator: 'contains', value: 'MOBILE' })).toBe(true);
    expect(matchesWorkflowCondition(action, { field: 'tags', operator: 'contains', value: 'ios' })).toBe(true);
  });
  it('matches one-of and not-one-of conditions', () => {
    expect(matchesWorkflowCondition(action, { field: 'priority', operator: 'in', value: ['p0', 'p1'] })).toBe(true);
    expect(matchesWorkflowCondition(action, { field: 'owners', operator: 'not_in', value: ['codex'] })).toBe(true);
  });
  it('reads the hydrated workflow category', () => {
    expect(matchesWorkflowCondition(action, { field: 'workflow_category', operator: 'eq', value: 'unstarted' })).toBe(true);
  });
  it('supports empty and non-empty checks', () => {
    expect(matchesWorkflowCondition({ ...action, project_id: null }, { field: 'project_id', operator: 'is_empty' })).toBe(true);
    expect(matchesWorkflowCondition(action, { field: 'tags', operator: 'not_empty' })).toBe(true);
  });
  it('honors all and any groups', () => {
    expect(matchesWorkflowRule(action, { id: 'r1', conditions: { mode: 'all', items: [{ field: 'priority', operator: 'eq', value: 'p1' }, { field: 'tags', operator: 'contains', value: 'ios' }] } })).toBe(true);
    expect(matchesWorkflowRule(action, { id: 'r2', conditions: { mode: 'any', items: [{ field: 'priority', operator: 'eq', value: 'p3' }, { field: 'tags', operator: 'contains', value: 'ios' }] } })).toBe(true);
  });
});

describe('workflow rule validation and merging', () => {
  it('accepts a safe deterministic rule', () => {
    expect(validateWorkflowRuleInput({ name: 'Route support', trigger_type: 'triage_entered', conditions: { mode: 'all', items: [{ field: 'source_label', operator: 'eq', value: 'support' }] }, effects: { priority: 'p1', add_tags: ['triaged'] } })).toEqual([]);
  });
  it('rejects terminal, external, and unknown effects', () => {
    expect(validateWorkflowRuleInput({ name: 'Unsafe', trigger_type: 'triage_entered', conditions: { mode: 'all', items: [] }, effects: { complete: true, send_email: true } })).toEqual(expect.arrayContaining([expect.stringContaining('forbidden fields')]));
  });
  it('applies earlier scalar effects and reports later conflicts', () => {
    const result = evaluateWorkflowRules(action, [
      { id: 'r1', enabled: true, trigger_type: 'triage_entered', position: 0, conditions: { mode: 'all', items: [] }, effects: { priority: 'p0' } },
      { id: 'r2', enabled: true, trigger_type: 'triage_entered', position: 1, conditions: { mode: 'all', items: [] }, effects: { priority: 'p2' } },
    ], 'triage_entered');
    expect(result.proposed_effects.priority).toBe('p0');
    expect(result.conflicts).toMatchObject([{ field: 'priority', kept_rule_id: 'r1', ignored_rule_id: 'r2' }]);
  });
  it('merges labels deterministically and reports add/remove conflicts', () => {
    const result = evaluateWorkflowRules(action, [
      { id: 'r1', enabled: true, trigger_type: 'action_updated', position: 0, conditions: { mode: 'all', items: [] }, effects: { add_tags: ['urgent'] } },
      { id: 'r2', enabled: true, trigger_type: 'action_updated', position: 1, conditions: { mode: 'all', items: [] }, effects: { remove_tags: ['urgent', 'customer'] } },
    ], 'action_updated');
    expect(result.proposed_effects.tags).toEqual(['ios', 'urgent']);
    expect(result.conflicts).toHaveLength(1);
  });
  it('ignores paused rules and rules for other triggers', () => {
    const result = evaluateWorkflowRules(action, [
      { id: 'paused', enabled: false, trigger_type: 'triage_entered', effects: { priority: 'p0' } },
      { id: 'other', enabled: true, trigger_type: 'manual', effects: { priority: 'p0' } },
    ], 'triage_entered');
    expect(result).toEqual({ matched_rule_ids: [], proposed_effects: {}, conflicts: [] });
  });
});
