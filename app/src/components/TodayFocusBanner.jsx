import React from 'react'
import { useBriefing } from '../hooks/useBriefing.js'

function readinessConfig(level) {
  switch (level) {
    case 'push':
      return { label: 'Push Day', color: '#f4b860', bg: 'rgba(75,226,119,0.12)', border: 'rgba(75,226,119,0.25)' }
    case 'recovery':
      return { label: 'Recovery', color: '#e55353', bg: 'rgba(229,83,83,0.12)', border: 'rgba(229,83,83,0.25)' }
    default:
      return { label: 'Steady', color: '#f5a623', bg: 'rgba(245,166,35,0.12)', border: 'rgba(245,166,35,0.25)' }
  }
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  } catch {
    return iso
  }
}

export default function TodayFocusBanner() {
  const briefing = useBriefing()

  if (!briefing) return null

  const readiness = readinessConfig(briefing.health_snapshot?.readiness_level)
  const overdue = (briefing.atlas_priorities ?? []).filter(a => a.is_overdue)
  const generatedAt = briefing.generated_at ? formatTime(briefing.generated_at) : null

  return (
    <div
      className="rounded-2xl px-5 py-4 mb-6 flex flex-wrap items-center gap-4"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Readiness pill */}
      <div
        className="flex items-center gap-2 rounded-full px-3 py-1.5"
        style={{ background: readiness.bg, border: `1px solid ${readiness.border}` }}
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: readiness.color }}
        />
        <span
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: readiness.color }}
        >
          {readiness.label}
        </span>
      </div>

      {/* Overdue count */}
      {overdue.length > 0 && (
        <p className="text-sm text-white/50">
          <span className="text-red-400 font-semibold">{overdue.length}</span>
          {' action'}{overdue.length !== 1 ? 's' : ''} overdue as of this morning
        </p>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Timestamp */}
      {generatedAt && (
        <p className="text-[10px] text-white/25 tracking-wide">
          Briefing compiled {generatedAt}
        </p>
      )}
    </div>
  )
}
