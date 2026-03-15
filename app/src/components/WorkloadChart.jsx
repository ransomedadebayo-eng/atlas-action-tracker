import React, { useMemo } from 'react'
import { BarChart3 } from 'lucide-react'
import { STATUS_COLORS, getMemberColor } from '../utils/colors.js'
import { getInitials } from '../utils/memberUtils.js'
import { STATUSES } from '../utils/constants.js'

const STATUS_KEYS = ['not_started', 'in_progress', 'waiting', 'blocked', 'done']

export default function WorkloadChart({ stats = [], members = [] }) {
  // Sort by active (non-done) count descending
  const sorted = useMemo(() => {
    return [...stats]
      .filter(s => s.total > 0)
      .sort((a, b) => b.active - a.active)
  }, [stats])

  const maxTotal = useMemo(() => {
    return Math.max(...sorted.map(s => s.total), 1)
  }, [sorted])

  // Build member name lookup
  const memberMap = useMemo(() => {
    const map = {}
    for (const m of members) {
      map[m.id] = m.name
    }
    return map
  }, [members])

  if (sorted.length === 0) {
    return null
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-bg-elevated">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-text-primary">Workload Overview</span>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-3">
          {STATUS_KEYS.map(key => (
            <div key={key} className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-sm"
                style={{ backgroundColor: STATUS_COLORS[key] }}
              />
              <span className="text-[10px] text-text-muted">
                {STATUSES[key]?.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="px-5 py-4 space-y-3">
        {sorted.map(memberStat => {
          const name = memberMap[memberStat.member_id] || memberStat.member_id
          const color = getMemberColor(memberStat.member_id)

          return (
            <div key={memberStat.member_id} className="flex items-center gap-3">
              {/* Avatar */}
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center font-mono font-semibold text-[10px] flex-shrink-0"
                style={{ backgroundColor: `${color}30`, color }}
              >
                {getInitials(name)}
              </div>

              {/* Name */}
              <div className="w-16 sm:w-20 flex-shrink-0">
                <span className="text-xs text-text-primary font-medium truncate block">
                  {name}
                </span>
              </div>

              {/* Stacked bar */}
              <div className="flex-1 flex items-center gap-0">
                <div className="flex-1 h-6 bg-bg-primary rounded overflow-hidden flex">
                  {STATUS_KEYS.map(key => {
                    const count = memberStat[key] || 0
                    if (count === 0) return null
                    const widthPercent = (count / maxTotal) * 100

                    return (
                      <div
                        key={key}
                        className="h-full transition-all relative group/bar"
                        style={{
                          width: `${widthPercent}%`,
                          backgroundColor: STATUS_COLORS[key],
                          minWidth: count > 0 ? '4px' : '0',
                        }}
                        title={`${STATUSES[key]?.label}: ${count}`}
                      >
                        {/* Show count inside bar if wide enough */}
                        {widthPercent > 8 && (
                          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono font-bold text-white/80">
                            {count}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Total count */}
              <div className="w-12 sm:w-16 flex-shrink-0 text-right">
                <span className="text-xs font-mono text-text-secondary">
                  {memberStat.active} active
                </span>
              </div>

              {/* Overdue indicator */}
              <div className="hidden sm:block sm:w-12 flex-shrink-0 text-right">
                {memberStat.overdue > 0 ? (
                  <span className="text-[11px] font-mono text-red-400 font-semibold">
                    {memberStat.overdue} late
                  </span>
                ) : (
                  <span className="text-[11px] font-mono text-text-muted">
                    --
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Summary footer */}
      <div className="flex items-center gap-4 px-5 py-2.5 border-t border-border bg-bg-elevated">
        <span className="text-[11px] text-text-muted font-mono">
          {sorted.length} member{sorted.length !== 1 ? 's' : ''} with actions
        </span>
        <span className="text-[11px] text-text-muted font-mono">
          {sorted.reduce((sum, s) => sum + s.active, 0)} total active
        </span>
        {sorted.reduce((sum, s) => sum + s.overdue, 0) > 0 && (
          <span className="text-[11px] text-red-400 font-mono">
            {sorted.reduce((sum, s) => sum + s.overdue, 0)} total overdue
          </span>
        )}
      </div>
    </div>
  )
}
