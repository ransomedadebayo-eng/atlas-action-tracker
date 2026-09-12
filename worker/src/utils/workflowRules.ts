export type WorkflowAction = Record<string, unknown>;
export type WorkflowRule = {
  id: string;
  position?: number;
  enabled?: boolean;
  trigger_type?: string;
  conditions?: unknown;
  effects?: unknown;
};

export type RuleConflict = {
  field: string;
  kept_rule_id: string;
  ignored_rule_id: string;
  kept_value: unknown;
  ignored_value: unknown;
};

const CONDITION_FIELDS = new Set([
  'title', 'description', 'source_label', 'priority', 'status', 'workflow_category',
  'tags', 'owners', 'business', 'project_id', 'work_mode',
]);
const CONDITION_OPERATORS = new Set(['eq', 'neq', 'contains', 'in', 'not_in', 'is_empty', 'not_empty']);
const TRIGGERS = new Set([
  'triage_entered', 'action_created', 'action_updated', 'status_changed',
  'priority_changed', 'manual',
]);
const EFFECT_KEYS = new Set([
  'workflow_status_id', 'priority', 'owners', 'add_tags', 'remove_tags',
  'project_id', 'work_mode',
]);
const SCALAR_EFFECT_KEYS = ['workflow_status_id', 'priority', 'owners', 'project_id', 'work_mode'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function comparable(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim().toLowerCase();
  return JSON.stringify(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    const a = values(left).map(comparable).sort();
    const b = values(right).map(comparable).sort();
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return comparable(left) === comparable(right);
}

function actionValue(action: WorkflowAction, field: string): unknown {
  if (field === 'workflow_category') {
    const status = action.workflow_status;
    return isRecord(status) ? status.category : action.workflow_category;
  }
  return action[field];
}

export function matchesWorkflowCondition(action: WorkflowAction, condition: unknown): boolean {
  if (!isRecord(condition)) return false;
  const field = String(condition.field || '');
  const operator = String(condition.operator || '');
  if (!CONDITION_FIELDS.has(field) || !CONDITION_OPERATORS.has(operator)) return false;
  const actual = actionValue(action, field);
  const expected = condition.value;
  const actualValues = values(actual).map(comparable);
  const expectedValues = values(expected).map(comparable);
  const empty = actual === null || actual === undefined || actual === '' || (Array.isArray(actual) && actual.length === 0);

  if (operator === 'is_empty') return empty;
  if (operator === 'not_empty') return !empty;
  if (operator === 'eq') return sameValue(actual, expected);
  if (operator === 'neq') return !sameValue(actual, expected);
  if (operator === 'contains') {
    if (Array.isArray(actual)) return expectedValues.some(item => actualValues.includes(item));
    return comparable(actual).includes(comparable(expected));
  }
  const intersects = expectedValues.some(item => actualValues.includes(item));
  return operator === 'in' ? intersects : !intersects;
}

export function matchesWorkflowRule(action: WorkflowAction, rule: WorkflowRule): boolean {
  const conditions = isRecord(rule.conditions) ? rule.conditions : { mode: 'all', items: [] };
  const mode = conditions.mode === 'any' ? 'any' : 'all';
  const items = Array.isArray(conditions.items) ? conditions.items : [];
  if (items.length === 0) return true;
  return mode === 'any'
    ? items.some(condition => matchesWorkflowCondition(action, condition))
    : items.every(condition => matchesWorkflowCondition(action, condition));
}

export function validateWorkflowRuleInput(input: unknown): string[] {
  if (!isRecord(input)) return ['rule must be an object'];
  const errors: string[] = [];
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120) {
    errors.push('name must be 1-120 characters');
  }
  if (!TRIGGERS.has(String(input.trigger_type || ''))) errors.push('trigger_type is invalid');
  const conditions = input.conditions;
  if (!isRecord(conditions) || !['all', 'any'].includes(String(conditions.mode || ''))) {
    errors.push('conditions must use all or any mode');
  } else if (!Array.isArray(conditions.items)) {
    errors.push('conditions.items must be an array');
  } else {
    conditions.items.forEach((condition, index) => {
      if (!isRecord(condition)
        || !CONDITION_FIELDS.has(String(condition.field || ''))
        || !CONDITION_OPERATORS.has(String(condition.operator || ''))) {
        errors.push(`condition ${index + 1} is invalid`);
      }
    });
  }
  const effects = input.effects;
  if (!isRecord(effects) || Object.keys(effects).length === 0) {
    errors.push('effects must include at least one safe change');
  } else {
    const unknown = Object.keys(effects).filter(key => !EFFECT_KEYS.has(key));
    if (unknown.length) errors.push(`effects contain forbidden fields: ${unknown.join(', ')}`);
    if (effects.priority !== undefined && !['p0', 'p1', 'p2', 'p3'].includes(String(effects.priority))) {
      errors.push('priority effect is invalid');
    }
    if (effects.work_mode !== undefined && !['autonomous', 'review_required', 'user_only'].includes(String(effects.work_mode))) {
      errors.push('work_mode effect is invalid');
    }
    for (const key of ['owners', 'add_tags', 'remove_tags']) {
      if (effects[key] !== undefined && (!Array.isArray(effects[key]) || (effects[key] as unknown[]).some(value => typeof value !== 'string'))) {
        errors.push(`${key} effect must be an array of strings`);
      }
    }
  }
  return errors;
}

function normalizedStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean)));
}

export function evaluateWorkflowRules(
  action: WorkflowAction,
  rules: WorkflowRule[],
  triggerType: string,
): { matched_rule_ids: string[]; proposed_effects: Record<string, unknown>; conflicts: RuleConflict[] } {
  const ordered = rules
    .filter(rule => rule.enabled && rule.trigger_type === triggerType && matchesWorkflowRule(action, rule))
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0) || String(a.id).localeCompare(String(b.id)));
  const proposed: Record<string, unknown> = {};
  const sourceRule = new Map<string, string>();
  const conflicts: RuleConflict[] = [];

  for (const rule of ordered) {
    const effects = isRecord(rule.effects) ? rule.effects : {};
    for (const key of SCALAR_EFFECT_KEYS) {
      if (effects[key] === undefined) continue;
      if (!(key in proposed)) {
        proposed[key] = effects[key];
        sourceRule.set(key, rule.id);
      } else if (!sameValue(proposed[key], effects[key])) {
        conflicts.push({
          field: key,
          kept_rule_id: sourceRule.get(key) || '',
          ignored_rule_id: rule.id,
          kept_value: proposed[key],
          ignored_value: effects[key],
        });
      }
    }
  }

  const originalTags = normalizedStringArray(action.tags);
  const tagState = new Map(originalTags.map(tag => [tag.toLowerCase(), { value: tag, present: true, ruleId: '' }]));
  for (const rule of ordered) {
    const effects = isRecord(rule.effects) ? rule.effects : {};
    for (const tag of normalizedStringArray(effects.add_tags)) {
      const key = tag.toLowerCase();
      const existing = tagState.get(key);
      if (existing && !existing.present && existing.ruleId) {
        conflicts.push({ field: 'tags', kept_rule_id: existing.ruleId, ignored_rule_id: rule.id, kept_value: 'remove', ignored_value: `add:${tag}` });
      } else if (!existing || !existing.ruleId) {
        tagState.set(key, { value: tag, present: true, ruleId: rule.id });
      }
    }
    for (const tag of normalizedStringArray(effects.remove_tags)) {
      const key = tag.toLowerCase();
      const existing = tagState.get(key);
      if (existing?.present && existing.ruleId) {
        conflicts.push({ field: 'tags', kept_rule_id: existing.ruleId, ignored_rule_id: rule.id, kept_value: `add:${existing.value}`, ignored_value: `remove:${tag}` });
      } else if (!existing || !existing.ruleId) {
        tagState.set(key, { value: existing?.value || tag, present: false, ruleId: rule.id });
      }
    }
  }
  const finalTags = Array.from(tagState.values()).filter(item => item.present).map(item => item.value);
  if (!sameValue(originalTags, finalTags)) proposed.tags = finalTags;

  return {
    matched_rule_ids: ordered.map(rule => rule.id),
    proposed_effects: proposed,
    conflicts,
  };
}
