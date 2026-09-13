export const OFFICE_DIGEST_TERMINAL_STATUSES = ['done', 'completed', 'closed', 'cancelled', 'canceled', 'archived'] as const;
export const OFFICE_DIGEST_BUCKETS = ['done', 'waiting_on_owner', 'blocked_by_office'] as const;
export type OfficeDigestBucket = (typeof OFFICE_DIGEST_BUCKETS)[number];

export const OFFICE_DIGEST_VIEW_FILTERS: Record<string, Record<string, string>> = {
  'office-digest-done': {
    status: 'done',
    completed_within: '48h',
  },
  'office-digest-waiting-on-owner': {
    open: 'true',
    approval_state: 'needs_review',
  },
  'office-digest-blocked-by-office': {
    open: 'true',
    has_blocked_by: 'true',
    exclude_approval_state: 'needs_review',
  },
};

type FilterMap = Record<string, unknown>;

export function csvValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean);
  }
  if (value === undefined || value === null || value === '') return [];
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function parseCompletedWithin(value: unknown, now = new Date()): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const match = String(value).trim().match(/^(\d+)h$/i);
  if (!match) return null;
  const hours = Number(match[1]);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return new Date(now.valueOf() - hours * 60 * 60 * 1000);
}

export function resolveCompletedAfter(filters: FilterMap, now = new Date()): string | null {
  const explicit = typeof filters.completed_after === 'string' && filters.completed_after.trim()
    ? filters.completed_after.trim()
    : '';
  if (explicit) return explicit;
  const relative = parseCompletedWithin(filters.completed_within, now);
  return relative ? relative.toISOString() : null;
}

export function hasNonEmptyBlockedBy(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '[]' || trimmed === '{}') return false;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.length > 0;
      if (parsed && typeof parsed === 'object') return Object.keys(parsed).length > 0;
      return Boolean(parsed);
    } catch {
      return true;
    }
  }
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
}

export function isOpenDigestAction(action: FilterMap): boolean {
  if (action.archived_at) return false;
  const status = String(action.status || '').trim().toLowerCase();
  return !OFFICE_DIGEST_TERMINAL_STATUSES.includes(status as (typeof OFFICE_DIGEST_TERMINAL_STATUSES)[number]);
}

export function normalizeSavedViewFilters(filters: FilterMap = {}): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      const joined = value.map(item => String(item || '').trim()).filter(Boolean).join(',');
      if (joined) next[key] = joined;
      continue;
    }
    if (typeof value === 'boolean') {
      next[key] = value ? 'true' : 'false';
      continue;
    }
    next[key] = String(value);
  }
  return next;
}

export function resolveSavedViewFilters(view: { id?: string; filters?: FilterMap } | null | undefined): Record<string, string> {
  const id = String(view?.id || '');
  if (id && OFFICE_DIGEST_VIEW_FILTERS[id]) return { ...OFFICE_DIGEST_VIEW_FILTERS[id] };
  return normalizeSavedViewFilters(view?.filters || {});
}

export function matchesActionFilters(action: FilterMap, filters: FilterMap = {}, now = new Date()): boolean {
  const normalized = normalizeSavedViewFilters(filters);
  if (normalized.status) {
    const allowed = new Set(csvValues(normalized.status).map(status => status.toLowerCase()));
    if (!allowed.has(String(action.status || '').toLowerCase())) return false;
  }
  if (normalized.approval_state) {
    const allowed = new Set(csvValues(normalized.approval_state));
    if (!allowed.has(String(action.approval_state || ''))) return false;
  }
  if (normalized.exclude_approval_state) {
    const excluded = new Set(csvValues(normalized.exclude_approval_state));
    if (excluded.has(String(action.approval_state || ''))) return false;
  }
  if (normalized.open === 'true' && !isOpenDigestAction(action)) return false;
  if (normalized.has_blocked_by === 'true' && !hasNonEmptyBlockedBy(action.blocked_by)) return false;
  const completedAfter = resolveCompletedAfter(normalized, now);
  if (completedAfter) {
    const completedAt = typeof action.completed_at === 'string' ? action.completed_at : '';
    if (!completedAt || completedAt < completedAfter) return false;
  }
  if (normalized.business && String(action.business || '') !== normalized.business) return false;
  return true;
}

export function applyActionQueryFilters(query: any, filters: FilterMap = {}, now = new Date()) {
  const normalized = normalizeSavedViewFilters(filters);
  const approvalStates = csvValues(normalized.approval_state);
  if (approvalStates.length) query = query.in('approval_state', approvalStates);

  const excludedApproval = csvValues(normalized.exclude_approval_state);
  if (excludedApproval.length === 1) query = query.neq('approval_state', excludedApproval[0]);
  else if (excludedApproval.length > 1) query = query.not('approval_state', 'in', `(${excludedApproval.join(',')})`);

  const completedAfter = resolveCompletedAfter(normalized, now);
  if (completedAfter) query = query.gte('completed_at', completedAfter).not('completed_at', 'is', null);

  if (normalized.open === 'true') {
    query = query.is('archived_at', null).not('status', 'in', `(${OFFICE_DIGEST_TERMINAL_STATUSES.join(',')})`);
  }
  if (normalized.has_blocked_by === 'true') {
    query = query.not('blocked_by', 'is', null).neq('blocked_by', '[]');
  }
  return query;
}
