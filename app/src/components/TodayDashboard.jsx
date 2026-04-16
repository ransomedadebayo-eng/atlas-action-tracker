import React, { useMemo } from 'react'
import { Flame, Clock, Play, ArrowRight, AlertTriangle } from 'lucide-react'
import { useActions } from '../hooks/useActions.js'
import { useMembers } from '../hooks/useMembers.js'
import { useBusinessContext } from '../hooks/useBusinesses.js'
import { PriorityBadge, StatusBadge } from './StatusBadge.jsx'
import OwnerAvatars from './OwnerAvatars.jsx'
import { formatRelativeDate, isOverdue, isToday } from '../utils/dateUtils.js'
import { PRIORITY_COLORS, STATUS_COLORS } from '../utils/colors.js'
import { parseJsonArray } from '../utils/parseUtils.js'
import TodayFocusBanner from './TodayFocusBanner.jsx'

const PRIORITY_ORDER = { p0: 0, p1: 1, p2: 2, p3: 3 }
const NON_DONE_STATUSES = 'not_started,in_progress,waiting,blocked'

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

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function ActionCard({ action, onSelect, businessColors, members }) {
  const owners = parseJsonArray(action.owner_ids)
  const overdue = isOverdue(action.due_date) && action.status !== 'done'
  const dueToday = isToday(action.due_date)
  const priorityColor = PRIORITY_COLORS[action.priority] || '#71717a'
  const businessColor = businessColors[action.business] || '#71717a'

  return (
    <button
      onClick={() => onSelect(action.id)}
      className="w-full text-left rounded-2xl p-4 border transition-all duration-150 hover:border-white/20 hover:scale-[1.01] active:scale-[0.99] group"
      style={{
        background: 'rgba(255,255,255,0.03)',
        backdropFilter: 'blur(20px)',
        borderColor: overdue ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.07)',
      }}
    >
      <div className="flex items-start gap-3">
        {/* Priority stripe */}
        <div
          className="w-1 h-10 rounded-full flex-shrink-0 mt-0.5"
          style={{ backgroundColor: priorityColor }}
        />

        <div className="flex-1 min-w-0">
          {/* Top row: priority + due */}
          <div className="flex items-center gap-2 mb-1.5">
            <PriorityBadge priority={action.priority} />
            <span
              className={`text-xs font-medium ml-auto ${
                overdue
                  ? 'text-red-400'
                  : dueToday
                    ? 'text-amber-400'
                    : 'text-white/40'
              }`}
            >
              {formatRelativeDate(action.due_date)}
            </span>
          </div>

          {/* Title */}
          <p className="text-sm font-medium text-white/90 leading-snug truncate group-hover:text-white">
            {action.title}
          </p>

          {/* Bottom row: business + owners + status */}
          <div className="flex items-center gap-3 mt-2.5">
            <span className="flex items-center gap-1.5 text-xs text-white/40">
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
    </button>
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

export default function TodayDashboard({ selectedBusiness, onSelectAction, frozenBusinesses = new Set() }) {
  const queryFilters = {
    ...(selectedBusiness ? { business: selectedBusiness } : {}),
    status: NON_DONE_STATUSES,
  }
  const { data: actions = [], isLoading } = useActions(queryFilters)
  const { data: members = [] } = useMembers()
  const { BUSINESS_COLORS } = useBusinessContext()

  const { onFire, dueToday, inProgress, upNext, stats } = useMemo(() => {
    // Filter out frozen businesses
    const visible = selectedBusiness
      ? actions
      : actions.filter(a => !frozenBusinesses.has(a.business))

    const fire = []
    const today = []
    const active = []
    const notStarted = []

    for (const action of visible) {
      const isP0 = action.priority === 'p0'
      const overdue = isOverdue(action.due_date) && action.status !== 'done'
      const due = isToday(action.due_date)
      const isActive = action.status === 'in_progress' || action.status === 'waiting'

      // On Fire: P0 or overdue (avoid duplicating in other sections)
      if (isP0 || overdue) {
        fire.push(action)
      } else if (due) {
        today.push(action)
      } else if (isActive) {
        active.push(action)
      } else if (action.status === 'not_started') {
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

    // Sort In Progress by priority
    active.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9))

    // Sort Up Next by priority then due_date
    notStarted.sort((a, b) => {
      const pDiff = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
      if (pDiff !== 0) return pDiff
      return (a.due_date || 'zzzz').localeCompare(b.due_date || 'zzzz')
    })

    // Count overdue across all visible for stats (including those in fire)
    const overdueCount = visible.filter(a => isOverdue(a.due_date) && a.status !== 'done').length
    const dueTodayCount = visible.filter(a => isToday(a.due_date)).length
    const inProgressCount = visible.filter(a => a.status === 'in_progress').length

    return {
      onFire: fire,
      dueToday: today,
      inProgress: active,
      upNext: notStarted.slice(0, 10),
      stats: {
        overdue: overdueCount,
        dueToday: dueTodayCount,
        inProgress: inProgressCount,
      },
    }
  }, [actions, frozenBusinesses, selectedBusiness])

  if (isLoading) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-64 bg-white/5 rounded-xl" />
          <div className="h-4 w-48 bg-white/5 rounded-lg" />
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
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

  const totalFocus = onFire.length + dueToday.length + inProgress.length

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

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-10">
        <div
          className="rounded-2xl p-4 border"
          style={{
            background: stats.overdue > 0 ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.03)',
            borderColor: stats.overdue > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)',
          }}
        >
          <p className="text-white/30 text-[10px] uppercase tracking-widest font-semibold mb-1">
            Overdue
          </p>
          <p className={`text-3xl font-bold ${stats.overdue > 0 ? 'text-red-400' : 'text-white/20'}`}>
            {stats.overdue}
          </p>
        </div>

        <div
          className="rounded-2xl p-4 border"
          style={{
            background: stats.dueToday > 0 ? 'rgba(245,158,11,0.06)' : 'rgba(255,255,255,0.03)',
            borderColor: stats.dueToday > 0 ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)',
          }}
        >
          <p className="text-white/30 text-[10px] uppercase tracking-widest font-semibold mb-1">
            Due Today
          </p>
          <p className={`text-3xl font-bold ${stats.dueToday > 0 ? 'text-amber-400' : 'text-white/20'}`}>
            {stats.dueToday}
          </p>
        </div>

        <div
          className="rounded-2xl p-4 border"
          style={{
            background: stats.inProgress > 0 ? 'rgba(59,130,246,0.06)' : 'rgba(255,255,255,0.03)',
            borderColor: stats.inProgress > 0 ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
          }}
        >
          <p className="text-white/30 text-[10px] uppercase tracking-widest font-semibold mb-1">
            In Progress
          </p>
          <p className={`text-3xl font-bold ${stats.inProgress > 0 ? 'text-blue-400' : 'text-white/20'}`}>
            {stats.inProgress}
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
          />
        ))}
      </Section>

      <Section
        icon={Play}
        title="In Progress"
        subtitle="Active and waiting on others"
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
