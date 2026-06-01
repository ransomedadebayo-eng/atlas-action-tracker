import React, { useEffect, useMemo, useState } from 'react'
import { Flame, Clock, Play, ArrowRight, AlertTriangle, CheckCircle2, Trash2, SlidersHorizontal, X, Bot } from 'lucide-react'
import { useActions, useUpdateAction, useDeleteAction } from '../hooks/useActions.js'
import { useMembers } from '../hooks/useMembers.js'
import { useBusinessContext } from '../hooks/useBusinesses.js'
import { PriorityBadge, StatusBadge, WorkModeBadge } from './StatusBadge.jsx'
import OwnerAvatars from './OwnerAvatars.jsx'
import { formatRelativeDate, isOverdue, isToday } from '../utils/dateUtils.js'
import { PRIORITY_COLORS } from '../utils/colors.js'
import { parseJsonArray, parseJsonObject } from '../utils/parseUtils.js'
import TodayFocusBanner from './TodayFocusBanner.jsx'
import { PRIORITIES, STATUSES, WORK_MODES, canonicalStatus } from '../utils/constants.js'

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

export default function TodayDashboard({ selectedBusiness, onSelectAction, frozenBusinesses = new Set(), searchQuery = '' }) {
  const [filters, setFilters] = useState({})
  const [overdueOnly, setOverdueOnly] = useState(false)
  const { BUSINESS_LIST, BUSINESS_COLORS } = useBusinessContext()
  const effectiveBusiness = selectedBusiness || filters.business
  const queryFilters = {
    ...(effectiveBusiness ? { business: effectiveBusiness } : {}),
    status: filters.status || NON_DONE_STATUSES,
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.owner_id ? { owner_id: filters.owner_id } : {}),
    ...(filters.work_mode ? { work_mode: filters.work_mode } : {}),
    ...(overdueOnly ? { due_before: getYesterdayDateString() } : {}),
    ...(searchQuery ? { search: searchQuery } : {}),
  }
  const { data: actions = [], isLoading, isError, error } = useActions(queryFilters)
  const { data: members = [] } = useMembers()
  const updateAction = useUpdateAction()
  const deleteAction = useDeleteAction()

  useEffect(() => {
    if (!selectedBusiness || !filters.business) return
    setFilters(current => {
      const { business, ...rest } = current
      return rest
    })
  }, [filters.business, selectedBusiness])

  const toggleDone = (action) => {
    if (action.status !== 'done' && Object.keys(parseJsonObject(action.evidence_json)).length === 0) {
      window.alert('Open the action and add evidence before marking it verified done.')
      return
    }
    updateAction.mutate({
      id: action.id,
      status: action.status === 'done' ? 'not_started' : 'done',
    })
  }

  const handleDelete = (action) => {
    if (window.confirm(`Delete "${action.title}"? This cannot be undone.`)) {
      deleteAction.mutate(action.id)
    }
  }

  const hasFilters = Boolean(
    filters.business
      || filters.status
      || filters.priority
      || filters.owner_id
      || filters.work_mode
      || overdueOnly
  )

  function clearFilters() {
    setFilters({})
    setOverdueOnly(false)
  }

  const { onFire, dueToday, reviewRequired, inProgress, upNext, stats } = useMemo(() => {
    // Filter out frozen businesses
    const scoped = effectiveBusiness
      ? actions
      : actions.filter(a => !frozenBusinesses.has(a.business))
    const visible = overdueOnly
      ? scoped.filter(a => isOverdue(a.due_date) && a.status !== 'done')
      : scoped

    const fire = []
    const today = []
    const review = []
    const active = []
    const notStarted = []

    for (const action of visible) {
      const isP0 = action.priority === 'p0'
      const overdue = isOverdue(action.due_date) && action.status !== 'done'
      const due = isToday(action.due_date)
      const status = canonicalStatus(action.status)
      const isActive = ACTIVE_STATUSES.has(status)
      const needsReview = action.work_mode === 'review_required'

      // On Fire: P0 or overdue (avoid duplicating in other sections)
      if (isP0 || overdue) {
        fire.push(action)
      } else if (due) {
        today.push(action)
      } else if (needsReview) {
        review.push(action)
      } else if (isActive) {
        active.push(action)
      } else if (status === 'not_started') {
        notStarted.push(action)
      }
    }

    // Sort On Fire: P0 first, then by days overdue descending
    fire.sort((a, b) => {
      const aP0 = a.priority === 'p0' ? 0 : 1
      const bP0 = b.priority === 'p0' ? 0 : 1
      if (aP0 !== bP0) return aP0 - bP0
      return getDaysOverdue(b.due_date) - getDaysOverdue(a.due_date)
    })

    // Sort Due Today by priority
    today.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9))

    // Sort active work by priority
    active.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9))
    review.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9))

    // Sort Up Next by priority then due_date
    notStarted.sort((a, b) => {
      const pDiff = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
      if (pDiff !== 0) return pDiff
      return (a.due_date || 'zzzz').localeCompare(b.due_date || 'zzzz')
    })

    // Count overdue across all visible for stats (including those in fire)
    const overdueCount = visible.filter(a => isOverdue(a.due_date) && a.status !== 'done').length
    const dueTodayCount = visible.filter(a => isToday(a.due_date)).length
    const inProgressCount = visible.filter(a => ACTIVE_STATUSES.has(canonicalStatus(a.status))).length
    const reviewCount = visible.filter(a => a.work_mode === 'review_required' && a.status !== 'done').length

    return {
      onFire: fire,
      dueToday: today,
      reviewRequired: review,
      inProgress: active,
      upNext: notStarted.slice(0, 10),
      stats: {
        overdue: overdueCount,
        dueToday: dueTodayCount,
        reviewRequired: reviewCount,
        inProgress: inProgressCount,
      },
    }
  }, [actions, effectiveBusiness, frozenBusinesses, overdueOnly])

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
            {error?.message || 'ATLAS could not load actions.'}
          </p>
        </div>
      </div>
    )
  }

  const totalFocus = onFire.length + dueToday.length + reviewRequired.length + inProgress.length

  return (
    <div className="px-2 md:px-6 py-6 md:py-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <p className="text-white/30 text-xs uppercase tracking-widest font-semibold mb-2">
          {getGreeting()}
        </p>
        <h1 className="text-2xl md:text-3xl font-bold text-white mb-1">
          {getTodayFormatted()}
        </h1>
        <p className="text-white/40 text-sm">
          {totalFocus === 0
            ? 'Nothing urgent. Pull from Up Next or take a break.'
            : `${totalFocus} action${totalFocus === 1 ? '' : 's'} need${totalFocus === 1 ? 's' : ''} your attention today.`}
        </p>
      </div>

      {/* Today's Focus — briefing banner */}
      <TodayFocusBanner />

      <TodayFilters
        filters={filters}
        onChange={setFilters}
        overdueOnly={overdueOnly}
        onToggleOverdue={() => setOverdueOnly(value => !value)}
        selectedBusiness={selectedBusiness}
        businesses={BUSINESS_LIST}
        members={members}
        hasFilters={hasFilters}
        onClear={clearFilters}
      />

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        <div className={`rounded-2xl p-4 border bg-bg-surface ${stats.overdue > 0 ? 'border-danger/30' : 'border-border'}`}>
          <p className="text-text-muted text-[10px] uppercase tracking-widest font-semibold mb-1">
            Overdue
          </p>
          <p className={`text-3xl font-bold ${stats.overdue > 0 ? 'text-danger' : 'text-text-muted'}`}>
            {stats.overdue}
          </p>
        </div>

        <div className={`rounded-2xl p-4 border bg-bg-surface ${stats.dueToday > 0 ? 'border-accent/30' : 'border-border'}`}>
          <p className="text-text-muted text-[10px] uppercase tracking-widest font-semibold mb-1">
            Due Today
          </p>
          <p className={`text-3xl font-bold ${stats.dueToday > 0 ? 'text-accent' : 'text-text-muted'}`}>
            {stats.dueToday}
          </p>
        </div>

        <div className={`rounded-2xl p-4 border bg-bg-surface ${stats.inProgress > 0 ? 'border-status-in_progress/30' : 'border-border'}`}>
          <p className="text-text-muted text-[10px] uppercase tracking-widest font-semibold mb-1">
            Active
          </p>
          <p className={`text-3xl font-bold ${stats.inProgress > 0 ? 'text-status-in_progress' : 'text-text-muted'}`}>
            {stats.inProgress}
          </p>
        </div>

        <div className={`rounded-2xl p-4 border bg-bg-surface ${stats.reviewRequired > 0 ? 'border-accent/30' : 'border-border'}`}>
          <p className="text-text-muted text-[10px] uppercase tracking-widest font-semibold mb-1">
            Review
          </p>
          <p className={`text-3xl font-bold ${stats.reviewRequired > 0 ? 'text-accent' : 'text-text-muted'}`}>
            {stats.reviewRequired}
          </p>
        </div>
      </div>

      {/* Sections */}
      <Section
        icon={Flame}
        title="On Fire"
        subtitle="P0 actions and overdue items"
        count={onFire.length}
        accentColor="#ef4444"
        emptyMessage="Nothing on fire. Nice."
      >
        {onFire.map(action => (
          <ActionCard
            key={action.id}
            action={action}
            onSelect={onSelectAction}
            businessColors={BUSINESS_COLORS}
            members={members}
            onToggleDone={toggleDone}
            onDelete={handleDelete}
          />
        ))}
      </Section>

      <Section
        icon={Clock}
        title="Due Today"
        subtitle="Ship these before midnight"
        count={dueToday.length}
        accentColor="#f59e0b"
        emptyMessage="Nothing due today."
      >
        {dueToday.map(action => (
          <ActionCard
            key={action.id}
            action={action}
            onSelect={onSelectAction}
            businessColors={BUSINESS_COLORS}
            members={members}
            onToggleDone={toggleDone}
            onDelete={handleDelete}
          />
        ))}
      </Section>

      <Section
        icon={Bot}
        title="Needs Review"
        subtitle="Agent-prepared work waiting for approval or a decision"
        count={reviewRequired.length}
        accentColor="#f4b860"
      >
        {reviewRequired.map(action => (
          <ActionCard
            key={action.id}
            action={action}
            onSelect={onSelectAction}
            businessColors={BUSINESS_COLORS}
            members={members}
            onToggleDone={toggleDone}
            onDelete={handleDelete}
          />
        ))}
      </Section>

      <Section
        icon={Play}
        title="Active"
        subtitle="In progress, blocked, or waiting"
        count={inProgress.length}
        accentColor="#3b82f6"
      >
        {inProgress.map(action => (
          <ActionCard
            key={action.id}
            action={action}
            onSelect={onSelectAction}
            businessColors={BUSINESS_COLORS}
            members={members}
            onToggleDone={toggleDone}
            onDelete={handleDelete}
          />
        ))}
      </Section>

      <Section
        icon={ArrowRight}
        title="Up Next"
        subtitle="Top 10 not-started actions to pull from"
        count={upNext.length}
        accentColor="#71717a"
      >
        {upNext.map(action => (
          <ActionCard
            key={action.id}
            action={action}
            onSelect={onSelectAction}
            businessColors={BUSINESS_COLORS}
            members={members}
            onToggleDone={toggleDone}
            onDelete={handleDelete}
          />
        ))}
      </Section>

      {/* Empty state when absolutely nothing */}
      {totalFocus === 0 && upNext.length === 0 && (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-7 h-7 text-white/20" />
          </div>
          <p className="text-white/30 text-sm">
            No active actions found. Create some or check your filters.
          </p>
        </div>
      )}
    </div>
  )
}
