import React, { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useActions } from '../hooks/useActions.js'
import { useBusinessContext } from '../hooks/useBusinesses.js'
import { getDaysInMonth, getFirstDayOfMonth, isToday } from '../utils/dateUtils.js'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function getDayNumberClass(today, isCurrentMonth, isPast) {
  if (today) {
    return 'text-bg-primary bg-accent rounded-full w-5 h-5 md:w-6 md:h-6 flex items-center justify-center text-[10px] md:text-xs'
  }
  if (!isCurrentMonth) {
    return 'text-text-muted/40'
  }
  return isPast ? 'text-text-muted' : 'text-text-secondary'
}

export default function CalendarView({ selectedBusiness, onSelectAction, onOpenQuickCapture }) {
  const { BUSINESSES, BUSINESS_COLORS } = useBusinessContext()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())

  const queryFilters = selectedBusiness ? { business: selectedBusiness } : {}
  const { data: actions = [], isLoading } = useActions(queryFilters)

  // Group actions by due_date
  const actionsByDate = useMemo(() => {
    const map = {}
    for (const action of actions) {
      if (!action.due_date) continue
      if (!map[action.due_date]) map[action.due_date] = []
      map[action.due_date].push(action)
    }
    return map
  }, [actions])

  // Calendar grid
  const calendarDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(year, month)
    const firstDay = getFirstDayOfMonth(year, month)
    const days = []

    // Previous month padding
    const prevMonthDays = getDaysInMonth(year, month - 1)
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = prevMonthDays - i
      const prevMonth = month === 0 ? 11 : month - 1
      const prevYear = month === 0 ? year - 1 : year
      const dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push({ day: d, dateStr, isCurrentMonth: false })
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push({ day: d, dateStr, isCurrentMonth: true })
    }

    // Next month padding (fill to 6 rows max)
    const totalCells = Math.ceil(days.length / 7) * 7
    const remaining = totalCells - days.length
    for (let d = 1; d <= remaining; d++) {
      const nextMonth = month === 11 ? 0 : month + 1
      const nextYear = month === 11 ? year + 1 : year
      const dateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push({ day: d, dateStr, isCurrentMonth: false })
    }

    return days
  }, [year, month])

  function goToPrev() {
    if (month === 0) {
      setMonth(11)
      setYear(y => y - 1)
    } else {
      setMonth(m => m - 1)
    }
  }

  function goToNext() {
    if (month === 11) {
      setMonth(0)
      setYear(y => y + 1)
    } else {
      setMonth(m => m + 1)
    }
  }

  function goToToday() {
    setYear(now.getFullYear())
    setMonth(now.getMonth())
  }

  // Count unscheduled
  const unscheduledCount = actions.filter(a => !a.due_date && a.status !== 'done').length

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4 animate-pulse">
          <div className="h-8 bg-bg-elevated rounded w-48" />
          <div className="h-8 bg-bg-elevated rounded w-24" />
        </div>
        <div className="grid grid-cols-7 gap-1">
          {[...Array(35)].map((_, i) => (
            <div key={i} className="card h-28 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-text-primary font-mono">
            {MONTH_NAMES[month]} {year}
          </h2>
          <div className="flex items-center gap-1">
            <button
              className="btn-ghost p-1.5"
              onClick={goToPrev}
              title="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              className="btn-ghost px-2 py-1 text-xs font-medium"
              onClick={goToToday}
            >
              Today
            </button>
            <button
              className="btn-ghost p-1.5"
              onClick={goToNext}
              title="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {unscheduledCount > 0 && (
            <span className="text-text-muted text-xs font-mono">
              {unscheduledCount} unscheduled
            </span>
          )}
          <div className="flex items-center gap-2">
            {(selectedBusiness ? [selectedBusiness] : Object.keys(BUSINESSES)).map(bizId => (
              <div key={bizId} className="flex items-center gap-1">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: BUSINESS_COLORS[bizId] }}
                />
                <span className="text-[10px] text-text-muted">
                  {BUSINESSES[bizId]?.shortLabel}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((day, i) => (
          <div
            key={day}
            className="text-center text-[10px] md:text-[11px] uppercase tracking-wider font-semibold text-text-muted py-1 md:py-2"
          >
            <span className="hidden md:inline">{day}</span>
            <span className="md:hidden">{WEEKDAYS_SHORT[i]}</span>
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((cell, idx) => {
          const dayActions = actionsByDate[cell.dateStr] || []
          const today = isToday(cell.dateStr)
          const isPast = new Date(cell.dateStr + 'T00:00:00') < new Date(new Date().toISOString().split('T')[0] + 'T00:00:00')

          const densityBg = dayActions.length > 0 && cell.isCurrentMonth
            ? dayActions.length >= 4 ? 'bg-accent/8' : dayActions.length >= 2 ? 'bg-accent/4' : ''
            : ''

          return (
            <div
              key={idx}
              role="button"
              tabIndex={cell.isCurrentMonth ? 0 : -1}
              aria-label={`${MONTH_NAMES[month]} ${cell.day}${dayActions.length ? `, ${dayActions.length} action${dayActions.length !== 1 ? 's' : ''}` : ''}`}
              className={`min-h-[50px] md:min-h-[110px] rounded-lg border transition-colors group relative ${
                cell.isCurrentMonth
                  ? 'bg-bg-surface border-border hover:border-border-hover'
                  : 'bg-bg-primary/50 border-transparent'
              } ${today ? 'ring-2 ring-accent/60 bg-accent/5' : ''} ${densityBg}`}
              onClick={() => {
                // On mobile, tap a day to quick-add
                if (window.innerWidth < 768 && cell.isCurrentMonth) {
                  if (dayActions.length > 0) {
                    onSelectAction(dayActions[0].id)
                  } else {
                    onOpenQuickCapture(cell.dateStr)
                  }
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  if (cell.isCurrentMonth) {
                    if (dayActions.length > 0) {
                      onSelectAction(dayActions[0].id)
                    } else {
                      onOpenQuickCapture(cell.dateStr)
                    }
                  }
                }
              }}
            >
              {/* Day number + quick add */}
              <div className="flex items-center justify-between px-1.5 md:px-2 pt-1 md:pt-1.5 pb-0.5 md:pb-1">
                <span
                  className={`text-[11px] md:text-xs font-mono font-semibold ${getDayNumberClass(today, cell.isCurrentMonth, isPast)}`}
                >
                  {cell.day}
                </span>
                {cell.isCurrentMonth && (
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-bg-elevated hidden md:block"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenQuickCapture(cell.dateStr)
                    }}
                    title="Add action"
                  >
                    <Plus className="w-3 h-3 text-text-muted hover:text-accent" />
                  </button>
                )}
              </div>

              {/* Actions — full text on desktop, dots on mobile */}
              {/* Desktop */}
              <div className="px-1 pb-1 space-y-0.5 overflow-hidden hidden md:block">
                {dayActions.slice(0, 3).map(action => {
                  const color = BUSINESS_COLORS[action.business] || '#71717a'
                  const done = action.status === 'done'

                  return (
                    <button
                      key={action.id}
                      className={`w-full text-left px-1.5 py-0.5 rounded text-[11px] leading-tight truncate transition-colors hover:brightness-110 ${
                        done ? 'opacity-40 line-through' : ''
                      }`}
                      style={{
                        backgroundColor: `${color}18`,
                        color,
                        borderLeft: `2px solid ${color}`,
                      }}
                      onClick={() => onSelectAction(action.id)}
                      title={action.title}
                    >
                      {action.title}
                    </button>
                  )
                })}
                {dayActions.length > 3 && (
                  <span className="text-[10px] text-text-muted px-1.5 block">
                    +{dayActions.length - 3} more
                  </span>
                )}
              </div>
              {/* Mobile dots */}
              {dayActions.length > 0 && (
                <div className="flex items-center justify-center gap-0.5 pb-1 md:hidden">
                  {dayActions.slice(0, 3).map(action => (
                    <span
                      key={action.id}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: BUSINESS_COLORS[action.business] || '#71717a' }}
                    />
                  ))}
                  {dayActions.length > 3 && (
                    <span className="text-[8px] text-text-muted">+{dayActions.length - 3}</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
