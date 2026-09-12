export const OFFICE_DIGEST_TERMINAL_STATUSES = Object.freeze(['done', 'cancelled', 'canceled', 'archived'])
export const OFFICE_DIGEST_BUCKETS = Object.freeze([
  { id: 'done', label: 'Done (48h)', viewId: 'office-digest-done' },
  { id: 'waiting_on_owner', label: 'Waiting-on-owner', viewId: 'office-digest-waiting-on-owner' },
  { id: 'blocked_by_office', label: 'Blocked-by-office', viewId: 'office-digest-blocked-by-office' },
])

export const OFFICE_DIGEST_VIEW_FILTERS = Object.freeze({
  'office-digest-done': Object.freeze({
    status: 'done',
    completed_within: '48h',
  }),
  'office-digest-waiting-on-owner': Object.freeze({
    open: 'true',
    approval_state: 'needs_review',
  }),
  'office-digest-blocked-by-office': Object.freeze({
    open: 'true',
    has_blocked_by: 'true',
    exclude_approval_state: 'needs_review',
  }),
})

export const OFFICE_DIGEST_VIEWS = Object.freeze(
  OFFICE_DIGEST_BUCKETS.map(bucket => ({
    id: bucket.viewId,
    bucket: bucket.id,
    label: bucket.label,
    filters: OFFICE_DIGEST_VIEW_FILTERS[bucket.viewId],
  })),
)

const NON_DONE_STATUSES = 'not_started,in_progress,waiting,blocked,todo,open'

export function csvValues(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean)
  if (value === undefined || value === null || value === '') return []
  return String(value).split(',').map(item => item.trim()).filter(Boolean)
}

export function parseCompletedWithin(value, now = new Date()) {
  if (value === undefined || value === null || value === '') return null
  const match = String(value).trim().match(/^(\d+)h$/i)
  if (!match) return null
  const hours = Number(match[1])
  if (!Number.isFinite(hours) || hours <= 0) return null
  return new Date(now.valueOf() - hours * 60 * 60 * 1000)
}

export function resolveCompletedAfter(filters = {}, now = new Date()) {
  const explicit = typeof filters.completed_after === 'string' && filters.completed_after.trim()
    ? filters.completed_after.trim()
    : ''
  if (explicit) return explicit
  const relative = parseCompletedWithin(filters.completed_within, now)
  return relative ? relative.toISOString() : null
}

export function hasNonEmptyBlockedBy(value) {
  if (value === undefined || value === null || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || trimmed === '[]' || trimmed === '{}') return false
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.length > 0
      if (parsed && typeof parsed === 'object') return Object.keys(parsed).length > 0
      return Boolean(parsed)
    } catch {
      return true
    }
  }
  if (typeof value === 'object') return Object.keys(value).length > 0
  return false
}

export function isOpenDigestAction(action) {
  if (!action || action.archived_at) return false
  const status = String(action.status || '').trim().toLowerCase()
  return !OFFICE_DIGEST_TERMINAL_STATUSES.includes(status)
}

export function normalizeSavedViewFilters(filters = {}) {
  const next = {}
  for (const [key, value] of Object.entries(filters || {})) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      const joined = value.map(item => String(item || '').trim()).filter(Boolean).join(',')
      if (joined) next[key] = joined
      continue
    }
    if (typeof value === 'boolean') {
      next[key] = value ? 'true' : 'false'
      continue
    }
    next[key] = String(value)
  }
  return next
}

export function resolveSavedViewFilters(view) {
  const id = String(view?.id || '')
  if (id && OFFICE_DIGEST_VIEW_FILTERS[id]) return { ...OFFICE_DIGEST_VIEW_FILTERS[id] }
  return normalizeSavedViewFilters(view?.filters || {})
}

export function matchesActionFilters(action, filters = {}, now = new Date()) {
  const normalized = normalizeSavedViewFilters(filters)
  if (normalized.status) {
    const allowed = new Set(csvValues(normalized.status).map(status => status.toLowerCase()))
    if (!allowed.has(String(action.status || '').toLowerCase())) return false
  }
  if (normalized.approval_state) {
    const allowed = new Set(csvValues(normalized.approval_state))
    if (!allowed.has(String(action.approval_state || ''))) return false
  }
  if (normalized.exclude_approval_state) {
    const excluded = new Set(csvValues(normalized.exclude_approval_state))
    if (excluded.has(String(action.approval_state || ''))) return false
  }
  if (normalized.open === 'true' && !isOpenDigestAction(action)) return false
  if (normalized.has_blocked_by === 'true' && !hasNonEmptyBlockedBy(action.blocked_by)) return false
  const completedAfter = resolveCompletedAfter(normalized, now)
  if (completedAfter) {
    const completedAt = typeof action.completed_at === 'string' ? action.completed_at : ''
    if (!completedAt || completedAt < completedAfter) return false
  }
  if (normalized.business && String(action.business || '') !== normalized.business) return false
  return true
}

export function actionListQueryFromFilters(filters = {}, { hideDone = true, searchQuery = '', business, limit = 200 } = {}) {
  const normalized = normalizeSavedViewFilters(filters)
  const query = {
    limit,
    show_blocked: 'true',
    ...normalized,
  }
  if (business) query.business = business
  if (!normalized.status && hideDone && normalized.open !== 'true' && !normalized.completed_within) {
    query.status = NON_DONE_STATUSES
  }
  if (searchQuery && searchQuery.length >= 1) query.search = searchQuery
  return query
}

export function groupOfficeDigest(items = [], { businessLabels = {}, selectedBusiness = null, searchQuery = '' } = {}) {
  const query = String(searchQuery || '').trim().toLowerCase()
  const grouped = Object.fromEntries(OFFICE_DIGEST_BUCKETS.map(bucket => [bucket.id, []]))

  for (const item of Array.isArray(items) ? items : []) {
    const bucket = String(item.digest_bucket || '')
    if (!grouped[bucket]) continue
    if (selectedBusiness && item.business !== selectedBusiness) continue
    if (query) {
      const haystack = `${item.identifier || ''} ${item.title || ''} ${item.next_action || ''}`.toLowerCase()
      if (!haystack.includes(query)) continue
    }
    grouped[bucket].push(item)
  }

  return OFFICE_DIGEST_BUCKETS.map(bucket => {
    const offices = new Map()
    for (const action of grouped[bucket.id]) {
      const officeId = action.business || ''
      if (!offices.has(officeId)) {
        offices.set(officeId, {
          id: officeId,
          label: businessLabels[officeId] || officeId || 'Unassigned office',
          actions: [],
        })
      }
      offices.get(officeId).actions.push(action)
    }
    return {
      ...bucket,
      count: grouped[bucket.id].length,
      offices: Array.from(offices.values()),
    }
  })
}
