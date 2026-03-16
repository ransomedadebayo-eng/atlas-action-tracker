import React, { useState, useMemo } from 'react'
import { ChevronUp, ChevronDown, CheckCircle2 } from 'lucide-react'
import { useActions, useUpdateAction } from '../hooks/useActions.js'
import { useMembers } from '../hooks/useMembers.js'
import { StatusBadge, PriorityBadge, BusinessBadge } from './StatusBadge.jsx'
import OwnerAvatars from './OwnerAvatars.jsx'
import FilterBar from './FilterBar.jsx'
import StatsStrip from './StatsStrip.jsx'
import { formatRelativeDate, formatTimestamp, isOverdue } from '../utils/dateUtils.js'
import { useBusinessContext } from '../hooks/useBusinesses.js'
import { parseJsonArray } from '../utils/parseUtils.js'

const PRIORITY_ORDER = { p0: 0, p1: 1, p2: 2, p3: 3 }

export default function ActionTable({ selectedBusiness, onSelectAction, searchQuery }) {
  const { BUSINESS_LIST } = useBusinessContext()
  const [filters, setFilters] = useState({})
  const [sort, setSort] = useState({ by: 'priority', dir: 'asc' })
  const [businessTab, setBusinessTab] = useState(selectedBusiness || 'all')

  const effectiveBusiness = selectedBusiness || (businessTab !== 'all' ? businessTab : undefined)

  const queryFilters = {
    ...(effectiveBusiness ? { business: effectiveBusiness } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.owner_id ? { owner_id: filters.owner_id } : {}),
    ...(searchQuery && searchQuery.length >= 2 ? { search: searchQuery } : {}),
  }

  const { data: actions = [], isLoading } = useActions(queryFilters)
  const { data: members = [] } = useMembers()
  const updateAction = useUpdateAction()

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
    { id: 'actions', label: '', width: 'w-10', noSort: true },
  ]

  return (
    <div className="space-y-4 md:space-y-5">
      <StatsStrip business={effectiveBusiness} />

      {/* Business tabs — only show when no business selected in sidebar */}
      {!selectedBusiness && (
        <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
              businessTab === 'all'
                ? 'bg-bg-elevated text-text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
            }`}
            onClick={() => setBusinessTab('all')}
          >
            All
          </button>
          {BUSINESS_LIST.map(b => (
            <button
              key={b.id}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                businessTab === b.id
                  ? 'bg-bg-elevated text-text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
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
      />

      {/* Desktop Table */}
      <div className="card overflow-hidden hidden md:block">
        {/* Header */}
        <div className="flex items-center border-b border-border px-4 py-2.5 bg-bg-elevated gap-2">
          {columns.map(col => (
            <div
              key={col.id}
              className={`${col.width} flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold text-text-muted ${
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
          <div className="divide-y divide-border">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-4 py-3 animate-pulse">
                <div className="h-5 bg-bg-elevated rounded w-16" />
                <div className="h-5 bg-bg-elevated rounded w-24" />
                <div className="h-5 bg-bg-elevated rounded flex-1" />
                <div className="h-5 bg-bg-elevated rounded w-28" />
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3">&#10003;</div>
            <p className="text-text-primary font-medium">No actions found</p>
            <p className="text-text-muted text-sm mt-1">
              {searchQuery ? 'Try a different search term' : 'Create an action with Cmd+K'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sorted.map(action => {
              const done = action.status === 'done'
              const overdue = isOverdue(action.due_date) && !done
              const owners = parseJsonArray(action.owners)
              const tags = parseJsonArray(action.tags)

              return (
                <div
                  key={action.id}
                  className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors hover:bg-bg-elevated group ${
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
                          <span className="text-[10px] text-text-muted" title={`Repeats ${action.recurrence}`}>↻ {action.recurrence}</span>
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
                  <button
                    className="w-10 flex-shrink-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => markDone(e, action)}
                    aria-label={done ? 'Mark not started' : 'Mark done'}
                  >
                    <CheckCircle2 className="w-4 h-4" style={{ color: done ? '#22c55e' : '#52525b' }} />
                  </button>
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
            <div key={i} className="card p-3 animate-pulse space-y-2">
              <div className="h-4 bg-bg-elevated rounded w-3/4" />
              <div className="h-3 bg-bg-elevated rounded w-1/2" />
            </div>
          ))
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-3xl mb-2">&#10003;</div>
            <p className="text-text-primary font-medium text-sm">No actions found</p>
            <p className="text-text-muted text-xs mt-1">
              {searchQuery ? 'Try a different search term' : 'Tap + to create one'}
            </p>
          </div>
        ) : (
          sorted.map(action => {
            const done = action.status === 'done'
            const overdue = isOverdue(action.due_date) && !done
            const owners = parseJsonArray(action.owners)

            return (
              <div
                key={action.id}
                className={`card p-3 cursor-pointer active:bg-bg-elevated transition-colors ${done ? 'opacity-50' : ''}`}
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
                      className="p-1"
                    >
                      <CheckCircle2
                        className="w-5 h-5"
                        style={{ color: done ? '#22c55e' : '#52525b' }}
                      />
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
        {sorted.length} action{sorted.length !== 1 ? 's' : ''}
        {searchQuery && searchQuery.length >= 2 ? ` matching "${searchQuery}"` : ''}
      </p>
    </div>
  )
}
