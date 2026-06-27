import React, { useEffect, useMemo, useState } from 'react'
import { Flame, Clock, Play, ArrowRight, AlertTriangle, CheckCircle2, Trash2, SlidersHorizontal, X, Bot } from 'lucide-react'
import { useActions, useUpdateAction, useDeleteAction } from '../hooks/useActions.js'
import { useMembers } from '../hooks/useMembers.js'
import { useBusinessContext } from '../hooks/useBusinesses.js'
import { PriorityBadge, StatusBadge, WorkModeBadge } from './StatusBadge.jsx'
import OwnerAvatars from './OwnerAvatars.jsx'
import { formatRelativeDate, isOverdue, isToday } from '../utils/dateUtils.js'
import { PRIORITY_COLORS } from '../utils/colors.js'
import { parseJsonArray } from '../utils/parseUtils.js'
import { completionEvidenceForAction } from '../utils/evidenceUtils.js'
import TodayFocusBanner from './TodayFocusBanner.jsx'
import { PRIORITIES, STATUSES, WORK_MODES, canonicalStatus } from '../utils/constants.js'
import { useTodayPlan } from '../hooks/useTodayPlan.js'

const PRIORITY_ORDER = { p0: 0, p1: 1, p2: 2, p3: 3 }
const NON_DONE_STATUSES = 'not_started,in_progress,waiting,blocked,todo,open'
const TODAY_STATUS_FILTERS = ['not_started', 'in_progress', 'waiting', 'blocked']
const ACTIVE_STATUSES = new Set(['in_progress', 'waiting', 'blocked'])

function getDaysOverdue(dateStr) {
  if (!dateStr) return 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const date = new Date(dateStr + 'T00:00:00')
  const diff = Math.floor((today - date) / (1000 * 60 * 60 * 24))
  return diff > 0 ? diff : 0
}

function getTodayFormatted() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function getLocalDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getYesterdayDateString() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - 1)
  return getLocalDateString(date)
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function ActionCard({ action, onSelect, businessColors, members, onToggleDone, onDelete }) {
  const owners = parseJsonArray(action.owners)
  const done = action.status === 'done'
  const overdue = isOverdue(action.due_date) && !done
  const dueToday = isToday(action.due_date)
  const priorityColor = PRIORITY_COLORS[action.priority] || '#71717a'
  const businessColor = businessColors[action.business] || '#71717a'

  return (
    <div
      onClick={() => onSelect(action.id)}
      className={`w-full text-left rounded-2xl p-4 border bg-bg-surface transition-all duration-150 hover:border-accent/40 hover:scale-[1.01] active:scale-[0.99] group cursor-pointer ${
        overdue ? 'border-danger/30' : 'border-border'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-1 h-10 rounded-full flex-shrink-0 mt-0.5"
          style={{ backgroundColor: priorityColor }}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <PriorityBadge priority={action.priority} />
            <WorkModeBadge workMode={action.work_mode} />
            <span
              className={`text-xs font-medium ml-auto ${
                overdue
                  ? 'text-danger'
                  : dueToday
                    ? 'text-accent'
                    : 'text-text-muted'
              }`}
            >
              {formatRelativeDate(action.due_date)}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleDone?.(action) }}
              className="p-1 text-text-muted hover:text-accent transition-colors"
              aria-label={done ? 'Mark not started' : 'Mark done'}
              title={done ? 'Mark not started' : 'Mark done'}
            >
              <CheckCircle2 className="w-4 h-4" style={{ color: done ? '#10b981' : undefined }} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete?.(action) }}
              className="p-1 -mr-1 text-text-muted hover:text-danger transition-colors"
              aria-label="Delete action"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <p className={`text-sm font-medium leading-snug truncate ${done ? 'line-through text-text-muted' : 'text-text-primary group-hover:text-text-primary'}`}>
            {action.title}
          </p>

          <div className="flex items-center gap-3 mt-2.5">
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: businessColor }}
              />
              <span className="truncate max-w-[100px]">
                {action.business?.replace(/_/g, ' ')}
              </span>
            </span>

            <div className="ml-auto flex items-center gap-2">
              <OwnerAvatars owners={owners} members={members} max={2} size="xs" />
              <StatusBadge status={action.status} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ icon: Icon, title, subtitle, count, accentColor, children, emptyMessage }) {
  if (count === 0 && emptyMessage) {
    return (
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${accentColor}15` }}
          >
            <Icon className="w-4 h-4" style={{ color: accentColor }} />
          </div>
          <div>
            <h2 className="font-bold text-base text-white flex items-center gap-2">
              {title}
              <span
                className="text-xs font-mono px-1.5 py-0.5 rounded-md"
                style={{ backgroundColor: `${accentColor}15`, color: accentColor }}
              >
                {count}
              </span>
            </h2>
            {subtitle && <p className="text-white/30 text-xs">{subtitle}</p>}
          </div>
        </div>
        <p className="text-white/20 text-sm pl-11">{emptyMessage}</p>
      </div>
    )
  }

  if (count === 0) return null

  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${accentColor}15` }}
        >
          <Icon className="w-4 h-4" style={{ color: accentColor }} />
        </div>
        <div>
          <h2 className="font-bold text-base text-white flex items-center gap-2">
            {title}
            <span
              className="text-xs font-mono px-1.5 py-0.5 rounded-md"
              style={{ backgroundColor: `${accentColor}15`, color: accentColor }}
            >
              {count}
            </span>
          </h2>
          {subtitle && <p className="text-white/30 text-xs">{subtitle}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-0 md:pl-0">
        {children}
      </div>
    </div>
  )
}

function TodayFilters({
  filters,
  onChange,
  overdueOnly,
  onToggleOverdue,
  selectedBusiness,
  businesses,
  members,
  hasFilters,
  onClear,
}) {
  const urgentActive = filters.priority === 'p0'
  const reviewActive = filters.work_mode === 'review_required'

  function updateFilter(key, value) {
    onChange({
      ...filters,
      [key]: value || undefined,
    })
  }

  return (
    <div className="mb-6 rounded-xl border border-border bg-bg-surface p-3 md:p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 flex-shrink-0">
            <SlidersHorizontal className="w-4 h-4 text-text-muted" />
            <span className="label">Filters</span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 sm:pb-0">
            <button
              type="button"
              className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-[11px] font-bold uppercase tracking-widest transition-colors flex-shrink-0 ${
                urgentActive
                  ? 'border-danger/30 bg-danger/10 text-danger'
                  : 'border-border text-text-secondary hover:border-danger/30 hover:text-danger'
              }`}
              onClick={() => updateFilter('priority', urgentActive ? '' : 'p0')}
              aria-pressed={urgentActive}
            >
              <Flame className="w-3.5 h-3.5" />
              Urgent (P0)
            </button>

            <button
              type="button"
              className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-[11px] font-bold uppercase tracking-widest transition-colors flex-shrink-0 ${
                overdueOnly
                  ? 'border-danger/30 bg-danger/10 text-danger'
                  : 'border-border text-text-secondary hover:border-danger/30 hover:text-danger'
              }`}
              onClick={onToggleOverdue}
              aria-pressed={overdueOnly}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Overdue
            </button>

            <button
              type="button"
              className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-[11px] font-bold uppercase tracking-widest transition-colors flex-shrink-0 ${
                reviewActive
                  ? 'border-accent/30 bg-accent-muted text-accent'
                  : 'border-border text-text-secondary hover:border-accent/30 hover:text-accent'
              }`}
              onClick={() => updateFilter('work_mode', reviewActive ? '' : 'review_required')}
              aria-pressed={reviewActive}
            >
              <Bot className="w-3.5 h-3.5" />
              Review
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {!selectedBusiness && (
            <select
              aria-label="Filter by business"
              className="input-field h-9 w-full min-w-0 text-xs py-1.5 px-2 bg-bg-elevated"
              value={filters.business || ''}
              onChange={e => updateFilter('business', e.target.value)}
            >
              <option value="">All businesses</option>
              {businesses.map(business => (
                <option key={business.id} value={business.id}>
                  {business.label}
                </option>
              ))}
            </select>
          )}

          <select
            aria-label="Filter by status"
            className="input-field h-9 w-full min-w-0 text-xs py-1.5 px-2 bg-bg-elevated"
            value={filters.status || ''}
            onChange={e => updateFilter('status', e.target.value)}
          >
            <option value="">Any active status</option>
            {TODAY_STATUS_FILTERS.map(status => (
              <option key={status} value={status}>
                {STATUSES[status]?.label || status}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by priority"
            className="input-field h-9 w-full min-w-0 text-xs py-1.5 px-2 bg-bg-elevated"
            value={filters.priority || ''}
            onChange={e => updateFilter('priority', e.target.value)}
          >
            <option value="">Any priority</option>
            {Object.entries(PRIORITIES).map(([id, priority]) => (
              <option key={id} value={id}>
                {priority.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by owner"
            className="input-field h-9 w-full min-w-0 text-xs py-1.5 px-2 bg-bg-elevated"
            value={filters.owner_id || ''}
            onChange={e => updateFilter('owner_id', e.target.value)}
          >
            <option value="">Any owner</option>
            {members.map(member => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by work mode"
            className="input-field h-9 w-full min-w-0 text-xs py-1.5 px-2 bg-bg-elevated"
            value={filters.work_mode || ''}
            onChange={e => updateFilter('work_mode', e.target.value)}
          >
            <option value="">Any work mode</option>
            {Object.entries(WORK_MODES).map(([id, mode]) => (
              <option key={id} value={id}>
                {mode.label}
              </option>
            ))}
          </select>

          {hasFilters && (
            <button
              type="button"
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-[11px] font-bold uppercase tracking-widest text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
              onClick={onClear}
            >
              <X className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function labelize(value) {
  return String(value || 'unknown').replace(/_/g, ' ')
}

function planItemsFrom(data) {
  return Array.isArray(data?.items) ? data.items : []
}

function countItems(items, status) {
  return items.filter(item => item.item_status === status).length
}

function PlanTaskCard({ item, onSelectAction }) {
  const evidence = item.source_evidence && typeof item.source_evidence === 'object' ? item.source_evidence : {}

  return (
    <button
      type="button"
      onClick={() => item.source_action_id && onSelectAction?.(item.source_action_id)}
      className="w-full rounded-2xl border border-border bg-bg-surface p-4 text-left transition-all duration-150 hover:border-accent/40 hover:scale-[1.005] active:scale-[0.995]"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-md border border-accent/25 bg-accent/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-accent">
              Today
            </span>
            {item.estimated_effort ? (
              <span className="inline-flex rounded-md border border-border bg-bg-elevated px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-text-muted">
                {item.estimated_effort}
              </span>
            ) : null}
            {item.review_gate ? (
              <span className="inline-flex rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-warning">
                {labelize(item.review_gate)}
              </span>
            ) : null}
          </div>

          <h2 className="break-words text-base font-bold leading-snug text-text-primary">
            {item.title}
          </h2>
          {item.summary ? (
            <p className="mt-2 max-w-[78ch] break-words text-sm leading-6 text-text-secondary">
              {item.summary}
            </p>
          ) : null}

          {item.reason ? (
            <p className="mt-3 max-w-[78ch] text-xs leading-5 text-text-muted">
              {item.reason}
            </p>
          ) : null}
        </div>

        <div className="w-full shrink-0 rounded-xl border border-border bg-bg-elevated p-3 lg:w-52">
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Score</p>
          <p className="mt-1 font-mono text-2xl font-bold text-text-primary">{item.score ?? 0}</p>
          <dl className="mt-3 space-y-1.5 text-xs">
            {['priority', 'due_date', 'business'].map(key => (
              <div key={key} className="flex items-start justify-between gap-3">
                <dt className="text-text-muted">{labelize(key)}</dt>
                <dd className="min-w-0 break-words text-right text-text-secondary">{String(evidence[key] ?? 'none')}</dd>
              </div>
            ))}
          </dl>
          {item.source_action_id ? (
            <span className="btn-secondary mt-3 inline-flex w-full justify-center">
              Open action
            </span>
          ) : null}
        </div>
      </div>
    </button>
  )
}

function AggregateRow({ item, onSelectAction }) {
  const statusTone = item.item_status === 'suppressed'
    ? 'border-text-muted/20 bg-bg-elevated text-text-muted'
    : 'border-border bg-bg-surface text-text-secondary'

  return (
    <button
      type="button"
      onClick={() => item.source_action_id && onSelectAction?.(item.source_action_id)}
      className={`w-full rounded-xl border p-3 text-left transition-colors hover:border-accent/30 ${statusTone}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-[10px] font-bold uppercase tracking-widest">
              {labelize(item.item_status)}
            </span>
            {item.review_gate ? (
              <span className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-warning">
                review gate
              </span>
            ) : null}
          </div>
          <p className="mt-2 break-words text-sm font-semibold text-text-primary">{item.title}</p>
          <p className="mt-1 break-words text-xs leading-5 text-text-muted">{item.reason}</p>
        </div>
        <p className="font-mono text-lg font-bold text-text-secondary">{item.score ?? 0}</p>
      </div>
    </button>
  )
}

export default function TodayDashboard({ selectedBusiness, onSelectAction, frozenBusinesses = new Set(), searchQuery = '' }) {
  const [activeTab, setActiveTab] = useState('today')
  const { data, isLoading, isError, error } = useTodayPlan()
  const items = planItemsFrom(data)
  const selectedItems = items.filter(item => item.item_status === 'selected')
  const aggregateItems = items.filter(item => item.item_status !== 'selected')
  const plan = data?.plan && typeof data.plan === 'object' ? data.plan : null
  const sourceCoverage = plan?.source_coverage && typeof plan.source_coverage === 'object' ? plan.source_coverage : {}
  const stats = {
    selected: countItems(items, 'selected'),
    review: items.filter(item => item.item_status === 'review' || item.review_gate).length,
    deferred: countItems(items, 'deferred'),
    suppressed: countItems(items, 'suppressed'),
  }

  if (isLoading) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-64 bg-white/5 rounded-xl" />
          <div className="h-4 w-48 bg-white/5 rounded-lg" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-white/5 rounded-2xl" />
            ))}
          </div>
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-20 bg-white/5 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="px-2 md:px-6 py-6 md:py-8 max-w-6xl mx-auto">
        <div className="rounded-2xl border border-danger/30 bg-danger/10 p-5">
          <p className="text-danger text-xs uppercase tracking-widest font-semibold mb-2">
            Data unavailable
          </p>
          <p className="text-white/80 text-sm">
            {error?.message || 'ATLAS could not load the Today plan.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-2 md:px-6 py-6 md:py-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <p className="text-white/30 text-xs uppercase tracking-widest font-semibold mb-2">
          {getGreeting()}
        </p>
        <h1 className="text-2xl md:text-3xl font-bold text-white mb-1">
          {getTodayFormatted()}
        </h1>
        <p className="text-white/40 text-sm">
          {selectedItems.length === 0
            ? 'No tasks were selected for today.'
            : `${selectedItems.length} selected task${selectedItems.length === 1 ? '' : 's'} for today.`}
        </p>
      </div>

      <TodayFocusBanner />

      <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border bg-bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-xl border border-border bg-bg-elevated p-1">
          {[
            ['today', `Today (${stats.selected})`],
            ['aggregate', `Aggregate (${aggregateItems.length})`],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                activeTab === id
                  ? 'bg-accent text-bg-base'
                  : 'text-text-muted hover:text-text-primary'
              }`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-text-muted">
            {plan?.status || 'no plan'}
          </span>
          <span className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-text-muted">
            iMessage: {labelize(sourceCoverage.imessage || 'unavailable')}
          </span>
        </div>
      </div>

      {activeTab === 'today' ? (
        <section className="space-y-3">
          {selectedItems.length ? (
            selectedItems.map(item => (
              <PlanTaskCard key={item.id || item.source_action_id || item.title} item={item} onSelectAction={onSelectAction} />
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-bg-surface p-8 text-center">
              <p className="text-sm text-text-muted">
                No tasks were selected for today. Run the nightly retriage or check the Aggregate tab.
              </p>
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Selected', stats.selected],
              ['Review gates', stats.review],
              ['Deferred', stats.deferred],
              ['Suppressed', stats.suppressed],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-border bg-bg-surface p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{label}</p>
                <p className="mt-1 font-mono text-3xl font-bold text-text-primary">{value}</p>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {aggregateItems.length ? (
              aggregateItems.map(item => (
                <AggregateRow key={item.id || `${item.source_action_id}-${item.item_status}-${item.rank}`} item={item} onSelectAction={onSelectAction} />
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-bg-surface p-8 text-center">
                <p className="text-sm text-text-muted">No aggregate context is attached to this plan.</p>
              </div>
            )}
          </div>
        </section>
      )}

      {!plan ? (
        <div className="mt-6 rounded-2xl border border-warning/30 bg-warning/10 p-4">
          <p className="text-sm text-warning">
            Atlas did not find an active daily plan for today.
          </p>
        </div>
      ) : null}
    </div>
  )
}
