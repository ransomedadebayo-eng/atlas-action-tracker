import React, { useState, useMemo, useEffect } from 'react'
import { ChevronUp, ChevronDown, CheckCircle2, Trash2 } from 'lucide-react'
import { useActions, useUpdateAction, useDeleteAction } from '../hooks/useActions.js'
import { useMembers } from '../hooks/useMembers.js'
import { StatusBadge, PriorityBadge, BusinessBadge } from './StatusBadge.jsx'
import OwnerAvatars from './OwnerAvatars.jsx'
import FilterBar from './FilterBar.jsx'
import StatsStrip from './StatsStrip.jsx'
import { formatRelativeDate, formatTimestamp, isOverdue } from '../utils/dateUtils.js'
import { useBusinessContext } from '../hooks/useBusinesses.js'
import { parseJsonArray } from '../utils/parseUtils.js'

const PRIORITY_ORDER = { p0: 0, p1: 1, p2: 2, p3: 3 }

const NON_DONE_STATUSES = 'not_started,in_progress,waiting,blocked'

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
    ...(effectiveBusiness ? { business: effectiveBusiness } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.owner_id ? { owner_id: filters.owner_id } : {}),
    ...(searchQuery && searchQuery.length >= 1 ? { search: searchQuery } : {}),
  }

  const { data: actions = [], isLoading } = useActions(queryFilters)
  const { data: members = [] } = useMembers()
  const updateAction = useUpdateAction()
  const deleteAction = useDeleteAction()

  const sorted = useMemo(() => {
    const arr = [...actions]
    arr.sort((a, b) => {
      let cmp = 0
      switch (sort.by) {
        case 'priority':
          cmp = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
          break
        case 'status':
          cmp = (a.status || '').localeCompare(b.status || '')
          break
        case 'title':
          cmp = (a.title || '').localeCompare(b.title || '')
          break
        case 'business':
          cmp = (a.business || '').localeCompare(b.business || '')
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

  function markDone(e, action) {
    e.stopPropagation()
    updateAction.mutate({ id: action.id, status: action.status === 'done' ? 'not_started' : 'done' })
  }

  function handleDelete(e, action) {
    e.stopPropagation()
    if (window.confirm(`Delete "${action.title}"? This cannot be undone.`)) {
      deleteAction.mutate(action.id)
    }
  }

  function SortIcon({ col }) {
    if (sort.by !== col) return <ChevronDown className="w-3 h-3 opacity-30" />
    return sort.dir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-accent" />
      : <ChevronDown className="w-3 h-3 text-accent" />
  }

  const columns = [
    { id: 'priority', label: 'Priority', width: 'w-24' },
    { id: 'status', label: 'Status', width: 'w-32' },
    { id: 'title', label: 'Title', width: 'flex-1' },
    { id: 'business', label: 'Business', width: 'w-36' },
    { id: 'owners', label: 'Owners', width: 'w-28', noSort: true },
    { id: 'due_date', label: 'Due', width: 'w-24' },
    { id: 'updated_at', label: 'Updated', width: 'w-28' },
    { id: 'actions', label: '', width: 'w-20', noSort: true },
  ]

  return (
    <div className="space-y-4 md:space-y-5">
      <StatsStrip business={effectiveBusiness} />

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
      <div className="glass-card overflow-hidden hidden md:block">
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
              const done = action.status === 'done'
              const overdue = isOverdue(action.due_date) && !done
              const owners = parseJsonArray(action.owners)
              const tags = parseJsonArray(action.tags)

              return (
                <div
                  key={action.id}
                  className={`flex items-center gap-2 px-5 py-3 cursor-pointer transition-colors hover:bg-white/[0.02] group ${
                    done ? 'opacity-50' : ''
                  }`}
                  style={overdue ? { borderLeft: '2px solid #ef444460' } : {}}
                  onClick={() => onSelectAction(action.id)}
                >
                  <div className="w-24 flex-shrink-0">
                    <PriorityBadge priority={action.priority} />
                  </div>
                  <div className="w-32 flex-shrink-0">
                    <StatusBadge status={action.status} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm font-medium truncate block ${done ? 'line-through text-text-muted' : 'text-text-primary'}`}>
                      {action.title}
                    </span>
                    {(tags.length > 0 || (action.recurrence && action.recurrence !== 'none')) && (
                      <div className="flex gap-1 mt-0.5 items-center">
                        {action.recurrence && action.recurrence !== 'none' && (
                          <span className="text-[10px] text-text-muted" title={`Repeats ${action.recurrence}`}>&#8635; {action.recurrence}</span>
                        )}
                        {tags.slice(0, 3).map(tag => (
                          <span key={tag} className="text-[10px] text-text-muted">#{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="w-36 flex-shrink-0">
                    <BusinessBadge business={action.business} />
                  </div>
                  <div className="w-28 flex-shrink-0">
                    <OwnerAvatars owners={owners} members={members} />
                  </div>
                  <div className={`w-24 flex-shrink-0 text-xs font-mono ${overdue ? 'text-red-400 font-semibold' : 'text-text-secondary'}`}>
                    {action.due_date ? formatRelativeDate(action.due_date) : '\u2014'}
                  </div>
                  <div className="w-28 flex-shrink-0 text-xs text-text-muted font-mono">
                    {action.updated_at ? formatTimestamp(action.updated_at) : '\u2014'}
                  </div>
                  <div className="w-20 flex-shrink-0 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="p-1 text-text-muted hover:text-accent transition-colors"
                      onClick={e => markDone(e, action)}
                      aria-label={done ? 'Mark not started' : 'Mark done'}
                      title={done ? 'Mark not started' : 'Mark done'}
                    >
                      <CheckCircle2 className="w-4 h-4" style={{ color: done ? '#10b981' : undefined }} />
                    </button>
                    <button
                      className="p-1 text-text-muted hover:text-danger transition-colors"
                      onClick={e => handleDelete(e, action)}
                      aria-label="Delete action"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
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
            const done = action.status === 'done'
            const overdue = isOverdue(action.due_date) && !done
            const owners = parseJsonArray(action.owners)

            return (
              <div
                key={action.id}
                className={`glass-card p-4 cursor-pointer active:bg-white/[0.04] transition-colors ${done ? 'opacity-50' : ''}`}
                style={overdue ? { borderLeft: '2px solid #ef444460' } : {}}
                onClick={() => onSelectAction(action.id)}
              >
                {/* Top: priority + status + done toggle */}
                <div className="flex items-center gap-2 mb-1.5">
                  <PriorityBadge priority={action.priority} />
                  <StatusBadge status={action.status} />
                  <div className="ml-auto flex items-center gap-2">
                    <OwnerAvatars owners={owners} members={members} max={2} size="xs" />
                    <button
                      onClick={e => markDone(e, action)}
                      className="p-1 text-text-muted hover:text-accent"
                      aria-label={done ? 'Mark not started' : 'Mark done'}
                    >
                      <CheckCircle2
                        className="w-5 h-5"
                        style={{ color: done ? '#10b981' : undefined }}
                      />
                    </button>
                    <button
                      onClick={e => handleDelete(e, action)}
                      className="p-1 text-text-muted hover:text-danger"
                      aria-label="Delete action"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Title */}
                <p className={`text-sm font-medium leading-snug ${done ? 'line-through text-text-muted' : 'text-text-primary'}`}>
                  {action.title}
                </p>

                {/* Bottom: business + due date */}
                <div className="flex items-center gap-2 mt-2">
                  <BusinessBadge business={action.business} />
                  {action.due_date && (
                    <span className={`text-[11px] font-mono ml-auto ${overdue ? 'text-red-400 font-semibold' : 'text-text-muted'}`}>
                      {formatRelativeDate(action.due_date)}
                    </span>
                  )}
                </div>
              </div>
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
