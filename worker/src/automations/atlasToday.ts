import { Env, getDb } from '../db';

type Supabase = ReturnType<typeof getDb>;

type TodayRule = {
  id?: string;
  rule_key: string;
  name: string;
  category: string;
  rule_type: 'hard_gate' | 'score' | 'capacity';
  enabled: boolean;
  weight: number;
  conditions?: Record<string, unknown> | null;
  rationale?: string | null;
};

type ActionRow = {
  id: string;
  title: string;
  description?: string | null;
  status?: string | null;
  business?: string | null;
  priority?: string | null;
  due_date?: string | null;
  review_date?: string | null;
  owners?: unknown;
  tags?: unknown;
  notes?: string | null;
  work_mode?: string | null;
  next_action?: string | null;
  definition_of_done?: string | null;
  blocked_by?: unknown;
  updated_at?: string | null;
  created_at?: string | null;
};

type Candidate = {
  action: ActionRow;
  score: number;
  matchedRules: Array<Record<string, unknown>>;
  suppressed: boolean;
  suppressedReason?: string;
  summary: string;
  reason: string;
  effort: string;
  confidence: 'low' | 'medium' | 'high';
};

const ACTIVE_STATUSES = ['not_started', 'in_progress', 'waiting', 'blocked', 'todo', 'open'];
const CLOSED_STATUSES = new Set(['done', 'completed', 'closed', 'archived', 'cancelled']);
const PRIORITY_SCORE: Record<string, number> = { p0: 250, p1: 170, p2: 90, p3: 20 };
const LIFE_PRIORITY_BUSINESSES = new Set([
  'personal',
  'family',
  'health',
  'healthos',
  'health_admin',
  'wealth',
  'wealth-os',
  'wealth_os',
  'household',
  'nazriels_birthday',
  'real_estate',
]);

function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function daysBetween(dateString: string, today: string) {
  const due = new Date(`${dateString}T00:00:00Z`).getTime();
  const base = new Date(`${today}T00:00:00Z`).getTime();
  return Math.round((due - base) / 86400000);
}

function textFor(action: ActionRow) {
  return [
    action.title,
    action.description,
    action.notes,
    action.business,
    action.next_action,
    action.definition_of_done,
  ].filter(Boolean).join(' ').toLowerCase();
}

function owners(action: ActionRow): string[] {
  return Array.isArray(action.owners)
    ? action.owners.filter((owner): owner is string => typeof owner === 'string')
    : [];
}

function hasOwnerNextStep(action: ActionRow) {
  return Boolean(action.next_action || action.definition_of_done || action.description || action.notes);
}

function isBlocked(action: ActionRow) {
  return action.status === 'blocked' || (Array.isArray(action.blocked_by) && action.blocked_by.length > 0);
}

function isLowConsequence(action: ActionRow) {
  const text = textFor(action);
  return /\b(fyi|newsletter|notification|receipt only|no action|read later|optional)\b/.test(text);
}

function isSuppressedRiddimContent(action: ActionRow) {
  if (action.business !== 'riddim_exchange') return false;
  const text = textFor(action);
  const allowed = /\b(business|finance|legal|revenue|compliance|contract|bank|tax|admin|invoice|grant|payroll|insurance)\b/.test(text);
  const explicitOptIn = /\b(today|urgent|deadline|owner approved|opted in)\b/.test(text);
  return !allowed && !explicitOptIn;
}

function effortFor(action: ActionRow) {
  const text = textFor(action);
  if (/\b(call|file|submit|passport|tax|legal|financial plan|packet|review spend|citizenship)\b/.test(text)) return '60-90m';
  if (/\b(confirm|reply|check|pay|book|order|upload|approve)\b/.test(text)) return '15-30m';
  return '30-45m';
}

function confidenceFor(action: ActionRow): 'low' | 'medium' | 'high' {
  if (action.due_date || action.review_date) return 'high';
  if (action.next_action || action.definition_of_done) return 'medium';
  return 'low';
}

function ruleByKey(rules: TodayRule[], key: string) {
  return rules.find(rule => rule.enabled && rule.rule_key === key);
}

function matched(rule: TodayRule | undefined, reason: string, score?: number) {
  if (!rule) return null;
  return {
    rule_key: rule.rule_key,
    name: rule.name,
    category: rule.category,
    rule_type: rule.rule_type,
    weight: rule.weight,
    score: score ?? rule.weight,
    reason,
  };
}

function evaluateAction(action: ActionRow, rules: TodayRule[], today: string): Candidate {
  const matches: Array<Record<string, unknown>> = [];
  const status = String(action.status || '').toLowerCase();

  const closedRule = matched(ruleByKey(rules, 'gate.closed_status'), 'Closed or completed work does not belong on Today.');
  if (CLOSED_STATUSES.has(status)) {
    if (closedRule) matches.push(closedRule);
    return {
      action,
      score: 0,
      matchedRules: matches,
      suppressed: true,
      suppressedReason: 'Suppressed because the action is already closed.',
      summary: action.next_action || action.description || '',
      reason: 'Closed work is hidden from Today.',
      effort: effortFor(action),
      confidence: confidenceFor(action),
    };
  }

  const blockedRule = matched(ruleByKey(rules, 'gate.blocked_no_next_action'), 'Blocked work needs an owner-actionable next step before it can be selected.');
  if (isBlocked(action) && !hasOwnerNextStep(action)) {
    if (blockedRule) matches.push(blockedRule);
    return {
      action,
      score: 0,
      matchedRules: matches,
      suppressed: true,
      suppressedReason: 'Suppressed because it is blocked without a clear next action.',
      summary: action.next_action || action.description || '',
      reason: 'Blocked work without a next step is not startable today.',
      effort: effortFor(action),
      confidence: confidenceFor(action),
    };
  }

  const lowConsequenceRule = matched(ruleByKey(rules, 'gate.low_consequence'), 'FYI and low-consequence notifications are kept out of Today.');
  if (isLowConsequence(action)) {
    if (lowConsequenceRule) matches.push(lowConsequenceRule);
    return {
      action,
      score: 0,
      matchedRules: matches,
      suppressed: true,
      suppressedReason: 'Suppressed as low-consequence or FYI work.',
      summary: action.next_action || action.description || '',
      reason: 'Low-consequence work should not consume Today capacity.',
      effort: effortFor(action),
      confidence: confidenceFor(action),
    };
  }

  const riddimRule = matched(ruleByKey(rules, 'gate.riddim_assignment'), 'Riddim content execution is suppressed unless it is business-critical or explicitly opted in.');
  if (isSuppressedRiddimContent(action)) {
    if (riddimRule) matches.push(riddimRule);
    return {
      action,
      score: 0,
      matchedRules: matches,
      suppressed: true,
      suppressedReason: 'Suppressed by the Riddim Exchange content-execution gate.',
      summary: action.next_action || action.description || '',
      reason: 'Riddim content work is not selected unless business, finance, legal, revenue, compliance, admin, or explicitly opted in.',
      effort: effortFor(action),
      confidence: confidenceFor(action),
    };
  }

  let score = PRIORITY_SCORE[action.priority || ''] || 40;

  const dueRule = ruleByKey(rules, 'score.priority_due_pressure');
  if (action.due_date) {
    const days = daysBetween(action.due_date, today);
    let delta = 0;
    if (days < 0) delta = Math.min(260, Math.abs(days) * 18 + 80);
    else if (days === 0) delta = 180;
    else if (days <= 2) delta = 100;
    else if (days <= 7) delta = 45;
    score += delta;
    const item = matched(dueRule, days < 0 ? `Overdue by ${Math.abs(days)} day(s).` : days === 0 ? 'Due today.' : `Due in ${days} day(s).`, delta);
    if (item) matches.push(item);
  } else if (action.review_date) {
    const days = daysBetween(action.review_date, today);
    const delta = days <= 0 ? 90 : days <= 3 ? 45 : 15;
    score += delta;
    const item = matched(dueRule, days <= 0 ? 'Review date is due.' : `Review date is in ${days} day(s).`, delta);
    if (item) matches.push(item);
  }

  const ownerRule = ruleByKey(rules, 'score.owner_only');
  if (action.work_mode === 'user_only' || action.work_mode === 'review_required' || owners(action).includes('ransomed')) {
    const delta = ownerRule?.weight || 60;
    score += delta;
    const item = matched(ownerRule, 'Requires Ransomed approval, action, or review.', delta);
    if (item) matches.push(item);
  }

  const alignmentRule = ruleByKey(rules, 'score.life_priority_alignment');
  if (action.business && LIFE_PRIORITY_BUSINESSES.has(action.business)) {
    const delta = alignmentRule?.weight || 70;
    score += delta;
    const item = matched(alignmentRule, `Aligned with ${String(action.business).replace(/_/g, ' ')} priority lane.`, delta);
    if (item) matches.push(item);
  }

  const freshnessRule = ruleByKey(rules, 'score.source_freshness');
  if (action.updated_at) {
    const updated = new Date(action.updated_at).getTime();
    const ageDays = Math.max(0, Math.floor((Date.now() - updated) / 86400000));
    const delta = ageDays <= 2 ? (freshnessRule?.weight || 45) : ageDays <= 7 ? 20 : 0;
    if (delta > 0) {
      score += delta;
      const item = matched(freshnessRule, `Updated ${ageDays === 0 ? 'today' : `${ageDays} day(s) ago`}.`, delta);
      if (item) matches.push(item);
    }
  }

  return {
    action,
    score,
    matchedRules: matches,
    suppressed: false,
    summary: action.next_action || action.description || action.definition_of_done || '',
    reason: matches.length > 0
      ? `Selected by ${matches.slice(0, 2).map(rule => rule.name).join(' and ')}.`
      : 'Selected by priority and active status.',
    effort: effortFor(action),
    confidence: confidenceFor(action),
  };
}

async function loadRules(supabase: Supabase): Promise<TodayRule[]> {
  const { data, error } = await supabase
    .from('atlas_today_rules')
    .select('*')
    .eq('enabled', true)
    .order('category', { ascending: true })
    .order('weight', { ascending: false });
  if (error) throw error;
  return (data || []) as TodayRule[];
}

async function loadActiveActions(supabase: Supabase): Promise<ActionRow[]> {
  const { data, error } = await supabase
    .from('atlas_actions')
    .select('id,title,description,status,business,priority,due_date,review_date,owners,tags,notes,work_mode,next_action,definition_of_done,blocked_by,updated_at,created_at')
    .in('status', ACTIVE_STATUSES)
    .order('priority', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(500);
  if (error) throw error;
  return (data || []) as ActionRow[];
}

async function insertAutomationReport(
  supabase: Supabase,
  startedAt: string,
  planDate: string,
  selected: Candidate[],
  deferred: Candidate[],
  suppressed: Candidate[],
  sourceCoverage: Record<string, unknown>,
) {
  const completedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('automation_run_reports')
    .insert({
      automation_id: 'atlas-nightly-retriage',
      automation_name: 'Atlas Nightly Retriage',
      status: 'completed',
      title: `Atlas Today plan generated for ${planDate}`,
      summary: `${selected.length} selected, ${deferred.length} deferred, ${suppressed.length} suppressed for ${planDate}.`,
      what_i_did: 'Gathered active Atlas actions, applied Today rules, capped the selected list, and wrote the Atlas daily plan.',
      how_i_did_it: 'Deterministic Worker rule engine using active Atlas actions, atlas_today_rules, rule-version snapshot, and bounded source coverage.',
      implemented: `Wrote Atlas daily plan for ${planDate}.`,
      verified: 'Plan and item rows are returned by the same Worker route used by Atlas Today.',
      remaining_work: 'Review rule proposals in Atlas Decide when recurring selection mistakes appear.',
      review_items_json: selected.map(candidate => ({
        title: candidate.action.title,
        source_action_id: candidate.action.id,
        score: candidate.score,
        reason: candidate.reason,
      })),
      source_loads_json: sourceCoverage,
      tools_used_json: ['cloudflare_worker', 'supabase_service_role'],
      artifacts_json: {
        plan_date: planDate,
        selected: selected.length,
        deferred: deferred.length,
        suppressed: suppressed.length,
        route_used: 'worker_supabase_service_role',
      },
      run_started_at: startedAt,
      run_completed_at: completedAt,
      updated_source: 'atlas-worker',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

function itemFor(candidate: Candidate, planId: string, itemStatus: 'selected' | 'review' | 'deferred' | 'suppressed', rank: number | null, reportId?: string) {
  return {
    plan_id: planId,
    source_action_id: candidate.action.id,
    source_report_id: reportId || null,
    item_status: itemStatus,
    rank,
    title: candidate.action.title,
    summary: candidate.summary || '',
    reason: itemStatus === 'suppressed'
      ? candidate.suppressedReason || candidate.reason
      : itemStatus === 'deferred'
        ? 'Deferred because the daily capacity cap was filled by higher-scoring work.'
        : candidate.reason,
    score: Math.round(candidate.score),
    matched_rules: candidate.matchedRules,
    source_evidence: {
      action_id: candidate.action.id,
      status: candidate.action.status,
      business: candidate.action.business,
      priority: candidate.action.priority,
      due_date: candidate.action.due_date,
      review_date: candidate.action.review_date,
      owners: candidate.action.owners,
      work_mode: candidate.action.work_mode,
      updated_at: candidate.action.updated_at,
    },
    review_gate: candidate.action.work_mode === 'user_only'
      ? 'owner_action_required'
      : candidate.action.work_mode === 'review_required'
        ? 'owner_review_required'
        : null,
    estimated_effort: candidate.effort,
    source_confidence: candidate.confidence,
  };
}

export async function generateAtlasTodayPlan(env: Env, date = isoDate()) {
  const supabase = getDb(env);
  const startedAt = new Date().toISOString();
  const rules = await loadRules(supabase);
  const actions = await loadActiveActions(supabase);
  const evaluated = actions.map(action => evaluateAction(action, rules, date));
  const suppressed = evaluated.filter(candidate => candidate.suppressed);
  const candidates = evaluated
    .filter(candidate => !candidate.suppressed)
    .sort((a, b) => b.score - a.score);

  const selectedCapacity = Math.min(5, Math.max(3, candidates.length));
  const selected = candidates.slice(0, selectedCapacity);
  const review = candidates
    .slice(selectedCapacity)
    .filter(candidate => candidate.action.work_mode === 'review_required' || candidate.action.work_mode === 'user_only')
    .slice(0, 10);
  const deferred = candidates
    .slice(selectedCapacity)
    .filter(candidate => !review.includes(candidate))
    .slice(0, 20);
  const visibleSuppressed = suppressed.slice(0, 20);

  const sourceCoverage = {
    active_atlas_actions: actions.length,
    rules_loaded: rules.length,
    selected: selected.length,
    review: review.length,
    deferred: deferred.length,
    suppressed: suppressed.length,
    unavailable_sources: ['imessage_read_connector'],
  };

  const { data: ruleVersion, error: ruleVersionError } = await supabase
    .from('atlas_today_rule_versions')
    .insert({
      version_label: `worker-${date}-${startedAt}`,
      rules_snapshot: rules,
      activated_by: 'atlas-nightly-retriage',
    })
    .select('id')
    .single();
  if (ruleVersionError) throw ruleVersionError;

  const reportId = await insertAutomationReport(supabase, startedAt, date, selected, deferred, visibleSuppressed, sourceCoverage);

  const { data: plan, error: planError } = await supabase
    .from('atlas_daily_plans')
    .upsert({
      plan_date: date,
      status: 'active',
      readiness_profile: { profile: 'normal', capacity_rule: 'capacity.normal_three_to_five' },
      source_coverage: sourceCoverage,
      selected_capacity: selectedCapacity,
      rule_version_id: ruleVersion.id,
      automation_report_id: reportId,
      summary: `${selected.length} selected by Atlas Today rules for ${date}.`,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'plan_date' })
    .select('id, plan_date, status, selected_capacity, rule_version_id, automation_report_id, summary')
    .single();
  if (planError) throw planError;

  await supabase.from('atlas_daily_plan_items').delete().eq('plan_id', plan.id);

  const items = [
    ...selected.map((candidate, index) => itemFor(candidate, plan.id, 'selected', index + 1, reportId)),
    ...review.map((candidate, index) => itemFor(candidate, plan.id, 'review', index + 1, reportId)),
    ...deferred.map((candidate, index) => itemFor(candidate, plan.id, 'deferred', index + 1, reportId)),
    ...visibleSuppressed.map((candidate, index) => itemFor(candidate, plan.id, 'suppressed', index + 1, reportId)),
  ];

  if (items.length > 0) {
    const { error: itemError } = await supabase.from('atlas_daily_plan_items').insert(items);
    if (itemError) throw itemError;
  }

  return {
    job: 'atlas-nightly-retriage',
    status: 'completed' as const,
    summary: `${selected.length} selected, ${review.length} review, ${deferred.length} deferred, ${visibleSuppressed.length} suppressed for ${date}.`,
    evidence: {
      plan_date: date,
      plan_id: plan.id,
      report_id: reportId,
      rule_version_id: ruleVersion.id,
      source_coverage: sourceCoverage,
    },
  };
}

export async function readAtlasTodayPlan(env: Env, date = isoDate()) {
  const supabase = getDb(env);
  const { data: plan, error } = await supabase
    .from('atlas_daily_plans')
    .select('*')
    .eq('plan_date', date)
    .maybeSingle();
  if (error) throw error;

  if (!plan) {
    const fallback = await fallbackTodayCandidates(supabase, date);
    return {
      date,
      plan: null,
      source: 'due_date_fallback',
      items: fallback,
      selected: [],
      review: [],
      deferred: [],
      suppressed: [],
      fallback,
      diagnostics: {
        code: 'missing_daily_plan',
        message: `No Atlas Today plan exists for ${date}. Showing due and overdue fallback candidates until nightly retriage runs.`,
      },
    };
  }

  const { data: items, error: itemsError } = await supabase
    .from('atlas_daily_plan_items')
    .select('*')
    .eq('plan_id', plan.id)
    .order('item_status', { ascending: true })
    .order('rank', { ascending: true, nullsFirst: false });
  if (itemsError) throw itemsError;

  const rows = items || [];
  const selected = rows.filter(item => item.item_status === 'selected');
  const review = rows.filter(item => item.item_status === 'review');
  const deferred = rows.filter(item => item.item_status === 'deferred');
  const suppressed = rows.filter(item => item.item_status === 'suppressed');
  return {
    date,
    plan,
    source: 'atlas_daily_plan',
    items: selected,
    selected,
    review,
    deferred,
    suppressed,
    fallback: [],
    diagnostics: null,
  };
}

async function fallbackTodayCandidates(supabase: Supabase, date: string) {
  const { data, error } = await supabase
    .from('atlas_actions')
    .select('id,title,description,status,business,priority,due_date,review_date,owners,work_mode,next_action,updated_at')
    .in('status', ACTIVE_STATUSES)
    .lte('due_date', date)
    .order('priority', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(5);
  if (error) throw error;
  return data || [];
}

export { isoDate as atlasTodayIsoDate };
