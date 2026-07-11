import React, { useState, useMemo, useEffect } from 'react'
import { ChevronUp, ChevronDown, ClipboardCheck } from 'lucide-react'
import { useActions } from '../hooks/useActions.js'
import { useMembers } from '../hooks/useMembers.js'
import { StatusBadge, PriorityBadge, BusinessBadge, WorkModeBadge } from './StatusBadge.jsx'
import OwnerAvatars from './OwnerAvatars.jsx'
import FilterBar from './FilterBar.jsx'
import StatsStrip from './StatsStrip.jsx'
import { formatRelativeDate, isOverdue } from '../utils/dateUtils.js'
import { useBusinessContext } from '../hooks/useBusinesses.js'
import { canonicalPriority, canonicalStatus } from '../utils/constants.js'
import { parseJsonArray } from '../utils/parseUtils.js'
import { hasEvidence } from '../utils/evidenceUtils.js'
import ActionCardControls from './ActionCardControls.jsx'

const PRIORITY_ORDER = { p0: 0, p1: 1, p2: 2, p3: 3 }

const NON_DONE_STATUSES = 'not_started,in_progress,waiting,blocked,todo,open'
const PROTOCOL_VIEWS = [
  { id: 'codex-pull', label: 'Codex Pull Queue', filters: { work_mode: 'autonomous', owner_id: 'codex' } },
  { id: 'needs-review', label: 'Needs Review', filters: { work_mode: 'review_required' } },
  { id: 'user-only', label: 'User Only', filters: { work_mode: 'user_only' } },
  { id: 'unclassified', label: 'Unclassified Cleanup', filters: { work_mode: '__null__' } },
  { id: 'stale', label: 'Stale / Stewardship', filters: { stewardship: 'stale' } },
]

export default function ActionTable({ selectedBusiness, onSelectAction, searchQuery, hideDone = true, onToggleHideDone, frozenBusinesses = new Set(), showFrozen = false }) {
  const { BUSINESS_LIST } = useBusinessContext()
  const [filters, setFilters] = useState({})
  const [sort, setSort] = useState({ by: 'priority', dir: 'asc' })
  const [businessTab, setBusinessTab] = useState(selectedBusiness || 'all')

  // Keep tab in sync when sidebar selection changes
  useEffect(() => {
    setBusinessTab(selectedBusiness || 'all')
  }, [selectedBusiness])

  const effectiveBusiness = selectedBusiness || (businessTab !== 'all' ? businessTab : undefined)

  const statusFilter = filters.status
    ? filters.status
    : hideDone
      ? NON_DONE_STATUSES
      : undefined

  const queryFilters = {
    limit: 200,
    show_blocked: true,
    ...(effectiveBusiness ? { business: effectiveBusiness } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.owner_id ? { owner_id: filters.owner_id } : {}),
    ...(filters.work_mode ? { work_mode: filters.work_mode } : {}),
    ...(filters.stewardship ? { stewardship: filters.stewardship } : {}),
    ...(searchQuery && searchQuery.length >= 1 ? { search: searchQuery } : {}),
  }

  const { data: rawActions = [], isLoading, isError, error } = useActions(queryFilters)
  const { data: rawMembers = [] } = useMembers()
  const actions = Array.isArray(rawActions) ? rawActions : []
  const members = Array.isArray(rawMembers) ? rawMembers : []

  const sorted = useMemo(() => {
    const arr = [...actions]
    arr.sort((a, b) => {
      let cmp = 0
      switch (sort.by) {
        case 'priority':
          cmp = (PRIORITY_ORDER[canonicalPriority(a.priority)] ?? 9) - (PRIORITY_ORDER[canonicalPriority(b.priority)] ?? 9)
          break
        case 'status':
          cmp = canonicalStatus(a.status).localeCompare(canonicalStatus(b.status))
          break
        case 'title':
          cmp = (a.title || '').localeCompare(b.title || '')
          break
        case 'business':
          cmp = (a.business || '').localeCompare(b.business || '')
          break
        case 'work_mode':
          cmp = (a.work_mode || 'zzzz').localeCompare(b.work_mode || 'zzzz')
          break
        case 'review_date':
          cmp = (a.review_date || 'zzzz').localeCompare(b.review_date || 'zzzz')
          break
        case 'approval_state':
          cmp = (a.approval_state || 'zzzz').localeCompare(b.approval_state || 'zzzz')
          break
        case 'due_date':
          cmp = (a.due_date || 'zzzz').localeCompare(b.due_date || 'zzzz')
          break
        case 'updated_at':
          cmp = (b.updated_at || '').localeCompare(a.updated_at || '')
          break
        default:
          cmp = 0
      }
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [actions, sort])

  // Filter out frozen businesses from default view
  const visibleActions = useMemo(() => {
    if (showFrozen || effectiveBusiness) return sorted
    return sorted.filter(a => !frozenBusinesses.has(a.business))
  }, [sorted, frozenBusinesses, showFrozen, effectiveBusiness])

  function handleSort(col) {
    setSort(prev =>
      prev.by === col
        ? { by: col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { by: col, dir: 'asc' }
    )
  }

  function handleRowKeyDown(event, actionId) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelectAction(actionId)
    }
  }

  function SortIcon({ col }) {
    if (sort.by !== col) return <ChevronDown className="w-3 h-3 opacity-30" />
    return sort.dir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-accent" />
      : <ChevronDown className="w-3 h-3 text-accent" />
  }

  const columns = [
    { id: 'priority', label: 'Priority', width: 'w-20' },
    { id: 'status', label: 'Status', width: 'w-28' },
    { id: 'title', label: 'Title', width: 'min-w-[200px] flex-1' },
    { id: 'business', label: 'Business', width: 'w-28' },
    { id: 'work_mode', label: 'Mode', width: 'w-24' },
    { id: 'owners', label: 'Owners', width: 'w-20', noSort: true },
    { id: 'due_date', label: 'Due', width: 'w-20' },
  ]

  return (
    <div className="space-y-4 md:space-y-5">
      <StatsStrip business={effectiveBusiness} />

      <div className="flex flex-wrap gap-2">
        {PROTOCOL_VIEWS.map(view => {
          const active = Object.entries(view.filters).every(([key, value]) => filters[key] === value)
          return (
            <button
              key={view.id}
              type="button"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-bold uppercase transition-colors ${
                active
                  ? 'border-accent/30 bg-accent-muted text-accent'
                  : 'border-white/10 text-text-secondary hover:border-accent/25 hover:text-accent'
              }`}
              onClick={() => setFilters(active ? {} : view.filters)}
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              {view.label}
            </button>
          )
        })}
      </div>

      {/* Business tabs */}
      {!selectedBusiness && (
        <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            className={`px-3 py-1.5 rounded-full text-[10px] uppercase tracking-widest font-bold transition-colors whitespace-nowrap border ${
              businessTab === 'all'
                ? 'bg-accent-muted text-accent border-accent/20'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated border-white/10'
            }`}
            onClick={() => setBusinessTab('all')}
          >
            All
          </button>
          {BUSINESS_LIST.filter(b => showFrozen || !frozenBusinesses.has(b.id)).map(b => (
            <button
              key={b.id}
              className={`px-3 py-1.5 rounded-full text-[10px] uppercase tracking-widest font-bold transition-colors whitespace-nowrap border ${
                businessTab === b.id
                  ? 'bg-accent-muted text-accent border-accent/20'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated border-white/10'
              }`}
              onClick={() => setBusinessTab(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <FilterBar
        filters={{ ...filters, business: effectiveBusiness }}
        onFilterChange={next => {
          const { business, ...rest } = next
          setFilters(rest)
        }}
        members={members}
        hideDone={hideDone}
        onToggleHideDone={onToggleHideDone}
      />

      {/* Desktop Table */}
      <div className="glass-card overflow-x-auto hidden md:block">
        {/* Header */}
        <div className="flex items-center border-b border-white/5 px-5 py-3 gap-2">
          {columns.map(col => (
            <div
              key={col.id}
              className={`${col.width} flex items-center gap-1 label ${
                !col.noSort ? 'cursor-pointer select-none hover:text-text-secondary' : ''
              }`}
              onClick={() => !col.noSort && handleSort(col.id)}
            >
              {col.label}
              {!col.noSort && <SortIcon col={col.id} />}
            </div>
          ))}
        </div>

        {/* Rows */}
        {isLoading ? (
          <div className="divide-y divide-white/5">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-5 py-3 animate-pulse">
                <div className="h-5 bg-bg-elevated rounded w-16" />
                <div className="h-5 bg-bg-elevated rounded w-24" />
                <div className="h-5 bg-bg-elevated rounded flex-1" />
                <div className="h-5 bg-bg-elevated rounded w-28" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="m-5 rounded-xl border border-danger/30 bg-danger/10 p-5 text-sm text-danger" role="alert">
            {error?.message || 'Actions could not be loaded.'}
          </div>
        ) : visibleActions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3 text-accent">&#10003;</div>
            <p className="text-text-primary font-headline font-medium">No actions found</p>
            <p className="text-text-muted text-sm mt-1">
              {searchQuery ? 'Try a different search term' : 'Create an action with Cmd+K'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {visibleActions.map(action => {
              const done = canonicalStatus(action.status) === 'done'
              const overdue = isOverdue(action.due_date) && !done
              const owners = parseJsonArray(action.owners)
              const tags = parseJsonArray(action.tags)
              const actionHasEvidence = hasEvidence(action.evidence_json)

              return (
                <article
                  key={action.id}
                  className={`flex items-stretch transition-colors hover:bg-white/[0.02] group ${
                    done ? 'opacity-50' : ''
                  }`}
                  style={overdue ? { borderLeft: '2px solid #ef444460' } : {}}
                >
                  <button
                    type="button"
                    aria-label={`Open action: ${action.title}`}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-5 py-3 text-left"
                    onClick={() => onSelectAction(action.id)}
                  >
                    <div className="w-20 flex-shrink-0">
                      <PriorityBadge priority={action.priority} />
                    </div>
                    <div className="w-28 flex-shrink-0">
                      <StatusBadge status={action.status} />
                    </div>
                    <div className="min-w-[200px] flex-1">
                      <span className={`text-sm font-medium truncate block ${done ? 'line-through text-text-muted' : 'text-text-primary'}`}>
                        {action.title}
                      </span>
                      {action.next_action && (
                        <span className="mt-0.5 block max-w-full truncate text-[10px] text-text-muted" title={action.next_action}>
                          {action.next_action}
                        </span>
                      )}
                      {(tags.length > 0 || (action.recurrence && action.recurrence !== 'none') || actionHasEvidence || action.review_date || (action.approval_state && action.approval_state !== 'not_required')) && (
                        <div className="mt-0.5 flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 overflow-hidden">
                          {action.recurrence && action.recurrence !== 'none' && (
                            <span className="text-[10px] text-text-muted" title={`Repeats ${action.recurrence}`}>&#8635; {action.recurrence}</span>
                          )}
                          {action.review_date && (
                            <span className="text-[10px] text-text-muted">review {formatRelativeDate(action.review_date)}</span>
                          )}
                          {action.approval_state && action.approval_state !== 'not_required' && (
                            <span className="text-[10px] text-text-muted">{action.approval_state.replace(/_/g, ' ')}</span>
                          )}
                          {actionHasEvidence && (
                            <span className="text-[10px] text-accent">evidence</span>
                          )}
                          {tags.slice(0, 3).map(tag => (
                            <span key={tag} className="text-[10px] text-text-muted">#{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="w-28 flex-shrink-0">
                      <BusinessBadge business={action.business} />
                    </div>
                    <div className="w-24 flex-shrink-0">
                      <WorkModeBadge workMode={action.work_mode} />
                    </div>
                    <div className="w-20 flex-shrink-0">
                      <OwnerAvatars owners={owners} members={members} />
                    </div>
                    <div className={`w-20 flex-shrink-0 text-xs font-mono ${overdue ? 'text-red-400 font-semibold' : 'text-text-secondary'}`}>
                      {action.due_date ? formatRelativeDate(action.due_date) : '\u2014'}
                    </div>
                  </button>
                  {!done && (
                    <ActionCardControls
                      action={action}
                      className="w-52 flex-shrink-0 border-l border-white/10 px-3 py-2.5"
                    />
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>

      {/* Mobile Card List */}
      <div className="md:hidden space-y-2">
        {isLoading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="glass-card p-4 animate-pulse space-y-2">
              <div className="h-4 bg-bg-elevated rounded w-3/4" />
              <div className="h-3 bg-bg-elevated rounded w-1/2" />
            </div>
          ))
        ) : isError ? (
          <div className="rounded-xl border border-danger/30 bg-danger/10 p-5 text-sm text-danger" role="alert">
            {error?.message || 'Actions could not be loaded.'}
          </div>
        ) : visibleActions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-3xl mb-2 text-accent">&#10003;</div>
            <p className="text-text-primary font-headline font-medium text-sm">No actions found</p>
            <p className="text-text-muted text-xs mt-1">
              {searchQuery ? 'Try a different search term' : 'Tap + to create one'}
            </p>
          </div>
        ) : (
          visibleActions.map(action => {
            const done = canonicalStatus(action.status) === 'done'
            const overdue = isOverdue(action.due_date) && !done
            const owners = parseJsonArray(action.owners)

            return (
              <article
                key={action.id}
                className={`glass-card overflow-hidden transition-colors ${done ? 'opacity-50' : ''}`}
                style={overdue ? { borderLeft: '2px solid #ef444460' } : {}}
              >
                <button
                  type="button"
                  aria-label={`Open action: ${action.title}`}
                  className="w-full cursor-pointer p-4 text-left active:bg-white/[0.04]"
                  onClick={() => onSelectAction(action.id)}
                >
                  {/* Top: priority + status */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <PriorityBadge priority={action.priority} />
                    <StatusBadge status={action.status} />
                    <div className="ml-auto flex items-center gap-2">
                      <OwnerAvatars owners={owners} members={members} max={2} size="xs" />
                    </div>
                  </div>

                  {/* Title */}
                  <p className={`text-sm font-medium leading-snug ${done ? 'line-through text-text-muted' : 'text-text-primary'}`}>
                    {action.title}
                  </p>

                  {/* Bottom: business + due date */}
                  <div className="flex items-center gap-2 mt-2">
                    <BusinessBadge business={action.business} />
                    <WorkModeBadge workMode={action.work_mode} />
                    {action.due_date && (
                      <span className={`text-[11px] font-mono ml-auto ${overdue ? 'text-red-400 font-semibold' : 'text-text-muted'}`}>
                        {formatRelativeDate(action.due_date)}
                      </span>
                    )}
                  </div>
                </button>
                {!done && (
                  <ActionCardControls
                    action={action}
                    className="border-t border-white/10 px-3 py-2.5"
                  />
                )}
              </article>
            )
          })
        )}
      </div>

      <p className="text-text-muted text-xs">
        {visibleActions.length} action{visibleActions.length !== 1 ? 's' : ''}
        {searchQuery && searchQuery.length >= 1 ? ` matching "${searchQuery}"` : ''}
      </p>
    </div>
  )
}
