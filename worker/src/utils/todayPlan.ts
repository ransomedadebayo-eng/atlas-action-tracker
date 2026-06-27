const CLOSED_STATUSES = new Set(['done', 'completed', 'complete', 'cancelled', 'canceled', 'applied', 'closed', 'archived']);
const PRIORITY_SCORE: Record<string, number> = { p0: 420, p1: 320, p2: 220, p3: 120 };
const MATERIAL_RE = /(family|health|doctor|passport|identity|tax|finance|wealth|payment|legal|career)/i;
const FYI_RE = /(newsletter|receipt|digest|fyi|notification)/i;
const RIDDIM_CONTENT_RE = /(song|setlist|youtube|social|content|media|post|reel|show|music)/i;
const RIDDIM_ALLOWED_RE = /(business|finance|legal|revenue|compliance|contract|bank|tax|admin|filing)/i;

export type TodayPlanItem = {
  source_action_id?: string | null;
  item_status: 'selected' | 'review' | 'deferred' | 'suppressed';
  rank: number;
  title: string;
  summary: string;
  reason: string;
  score: number;
  matched_rules: string[];
  source_evidence: Record<string, unknown>;
  review_gate?: string | null;
  estimated_effort: string;
  source_confidence: 'high' | 'medium' | 'low';
};

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getFrozenBusinesses(workflowState: unknown): string[] {
  const candidate = workflowState && typeof workflowState === 'object' ? workflowState as Record<string, unknown> : {};
  return asArray(candidate.frozenBusinesses).filter((item): item is string => typeof item === 'string');
}

function searchText(action: Record<string, unknown>) {
  return `${action.title ?? ''} ${action.description ?? ''} ${action.notes ?? ''}`.toLowerCase();
}

function scoreAction(action: Record<string, unknown>, planDate: string) {
  const priority = typeof action.priority === 'string' ? action.priority : 'p3';
  const dueDate = typeof action.due_date === 'string' ? action.due_date : null;
  const updatedAt = typeof action.updated_at === 'string' ? action.updated_at : null;
  let score = PRIORITY_SCORE[priority] ?? 120;

  if (isDateString(dueDate)) {
    if (dueDate < planDate) score += 120;
    if (dueDate === planDate) score += 90;
  }
  if (MATERIAL_RE.test(searchText(action))) score += 70;
  if (JSON.stringify(action.owners ?? []).toLowerCase().includes('ransomed') || action.work_mode === 'user_only') score += 60;
  if (updatedAt && Date.now() - Date.parse(updatedAt) <= 14 * 24 * 60 * 60 * 1000) score += 45;

  return score;
}

function gateAction(action: Record<string, unknown>, frozenBusinesses: string[]) {
  const status = String(action.status ?? 'not_started').toLowerCase();
  const text = searchText(action);
  const business = String(action.business ?? '');
  const blockers = asArray(action.blocked_by);
  const nextAction = typeof action.next_action === 'string' ? action.next_action.trim() : '';

  if (CLOSED_STATUSES.has(status)) return 'suppressed';
  if ((status === 'blocked' || blockers.length > 0) && !nextAction) return 'suppressed';
  if (frozenBusinesses.includes(business)) return 'suppressed';
  if ((business === 'riddim_exchange' || business === 'riddim-exchange') && RIDDIM_CONTENT_RE.test(text) && !RIDDIM_ALLOWED_RE.test(text)) {
    return 'suppressed';
  }
  if (FYI_RE.test(text)) return 'suppressed';

  return 'candidate';
}

export function buildDryRunPlan(args: {
  planDate?: string;
  actions: Record<string, unknown>[];
  workflowState?: unknown;
  readiness?: Record<string, unknown>;
}) {
  const planDate = args.planDate ?? new Date().toISOString().slice(0, 10);
  const readinessLevel = typeof args.readiness?.level === 'string' ? args.readiness.level : 'steady';
  const selectedCapacity = readinessLevel === 'recovery' ? 3 : 5;
  const frozenBusinesses = getFrozenBusinesses(args.workflowState);

  const candidates = args.actions
    .map((action) => {
      const gateStatus = gateAction(action, frozenBusinesses);
      return {
        action,
        gateStatus,
        score: scoreAction(action, planDate),
      };
    })
    .sort((left, right) => right.score - left.score || String(left.action.due_date ?? 'zzzz').localeCompare(String(right.action.due_date ?? 'zzzz')));

  let candidateRank = 0;
  let suppressedRank = 0;
  const items: TodayPlanItem[] = [];

  for (const entry of candidates) {
    const rank = entry.gateStatus === 'suppressed' ? ++suppressedRank : ++candidateRank;
    const status = entry.gateStatus === 'suppressed'
      ? 'suppressed'
      : rank <= selectedCapacity
        ? 'selected'
        : 'deferred';

    if (status === 'deferred' && rank > selectedCapacity + 8) continue;
    if (status === 'suppressed' && suppressedRank > 8) continue;

    const action = entry.action;
    const priority = String(action.priority ?? 'p3');
    const text = searchText(action);
    const updatedAt = typeof action.updated_at === 'string' ? action.updated_at : null;

    items.push({
      source_action_id: typeof action.id === 'string' ? action.id : null,
      item_status: status,
      rank,
      title: String(action.title ?? 'Untitled Atlas action'),
      summary: String(action.next_action || action.description || action.notes || 'Open the Atlas action and move the next concrete step.'),
      reason: status === 'selected'
        ? 'Selected by rules: priority, due pressure, material consequence, owner-only requirement, and source freshness.'
        : status === 'suppressed'
          ? 'Suppressed by a hard gate: closed, blocked without next action, frozen, FYI, or disallowed routine execution work.'
          : 'Deferred because the daily capacity cap was already filled by higher-scoring work.',
      score: entry.score,
      matched_rules: [
        'gate.closed_status',
        'gate.blocked_no_next_action',
        'gate.frozen_business',
        'gate.riddim_assignment',
        'score.priority_due_pressure',
        'score.life_priority_alignment',
        'score.owner_only',
        'score.source_freshness',
      ],
      source_evidence: {
        business: action.business ?? null,
        priority,
        due_date: action.due_date ?? null,
        status: action.status ?? null,
        updated_at: updatedAt,
      },
      review_gate: MATERIAL_RE.test(text) ? 'owner_review_required' : null,
      estimated_effort: priority === 'p0' ? '60-90m' : priority === 'p1' ? '45-60m' : '20-45m',
      source_confidence: updatedAt && Date.now() - Date.parse(updatedAt) <= 14 * 24 * 60 * 60 * 1000 ? 'high' : 'medium',
    });
  }

  return {
    plan_date: planDate,
    readiness_profile: { level: readinessLevel, capacity: selectedCapacity },
    source_coverage: {
      atlas: 'available',
      peos: 'available',
      gmail: 'available_via_existing_triage',
      calendar: 'available_via_automation',
      codex_threads: 'available_via_app_thread_tools',
      imessage: 'unavailable',
    },
    selected_capacity: selectedCapacity,
    summary: `${items.filter((item) => item.item_status === 'selected').length} selected by rules for ${planDate}.`,
    items,
  };
}
