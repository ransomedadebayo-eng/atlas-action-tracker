import React, { useState, useMemo } from 'react'
import { Search, FileText, Calendar, Hash, ChevronRight } from 'lucide-react'
import { useTranscripts } from '../hooks/useTranscripts.js'
import { TranscriptStatusBadge, BusinessBadge } from './StatusBadge.jsx'
import { TRANSCRIPT_STATUSES } from '../utils/constants.js'
import { useBusinessContext } from '../hooks/useBusinesses.js'
import { formatDateLong, formatTimestamp } from '../utils/dateUtils.js'

export default function TranscriptHistory() {
  const { BUSINESS_LIST } = useBusinessContext()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [businessFilter, setBusinessFilter] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  const queryParams = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(businessFilter ? { business: businessFilter } : {}),
    ...(search && search.length >= 2 ? { search } : {}),
  }

  const { data: transcripts = [], isLoading } = useTranscripts(queryParams)

  // Status counts for filter badges
  const statusCounts = useMemo(() => {
    const counts = { pending: 0, reviewed: 0, archived: 0, total: 0 }
    // Fetch all transcripts (without filters) not practical here, so we show current counts
    for (const t of transcripts) {
      if (counts[t.status] !== undefined) counts[t.status]++
      counts.total++
    }
    return counts
  }, [transcripts])

  if (isLoading) {
    return (
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-bg-elevated animate-pulse">
          <div className="h-5 bg-bg-primary rounded w-32" />
        </div>
        <div className="divide-y divide-border">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="p-4 animate-pulse space-y-2">
              <div className="h-4 bg-bg-elevated rounded w-3/4" />
              <div className="h-3 bg-bg-elevated rounded w-1/2" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-bg-elevated">
        <FileText className="w-4 h-4 text-accent" />
        <span className="text-sm font-semibold text-text-primary">Transcript History</span>
        <span className="text-text-muted text-xs font-mono ml-2">
          {transcripts.length} transcript{transcripts.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            className="input-field w-full pl-8 pr-3 py-1.5 text-sm"
            placeholder="Search transcripts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Status filter */}
        <select
          className="input-field text-xs py-1.5 px-2 bg-bg-surface"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">All Status</option>
          {Object.entries(TRANSCRIPT_STATUSES).map(([id, s]) => (
            <option key={id} value={id}>{s.label}</option>
          ))}
        </select>

        {/* Business filter */}
        <select
          className="input-field text-xs py-1.5 px-2 bg-bg-surface"
          value={businessFilter}
          onChange={e => setBusinessFilter(e.target.value)}
        >
          <option value="">All Businesses</option>
          {BUSINESS_LIST.map(b => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
      </div>

      {/* Transcript list */}
      {transcripts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FileText className="w-8 h-8 text-text-muted mb-3" />
          <p className="text-text-primary font-medium">No transcripts found</p>
          <p className="text-text-muted text-sm mt-1">
            {search ? 'Try a different search term' : 'Upload a transcript to get started'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {transcripts.map(transcript => {
            const isExpanded = expandedId === transcript.id
            const participants = Array.isArray(transcript.participants)
              ? transcript.participants
              : []

            return (
              <div key={transcript.id}>
                <div
                  className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-bg-elevated transition-colors group"
                  onClick={() => setExpandedId(isExpanded ? null : transcript.id)}
                >
                  {/* Status badge */}
                  <TranscriptStatusBadge status={transcript.status} />

                  {/* Title + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary truncate">
                        {transcript.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {transcript.date && (
                        <span className="flex items-center gap-1 text-[11px] text-text-muted font-mono">
                          <Calendar className="w-3 h-3" />
                          {formatDateLong(transcript.date)}
                        </span>
                      )}
                      {participants.length > 0 && (
                        <span className="text-[11px] text-text-muted">
                          {participants.length} participant{participants.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Business badge */}
                  {transcript.business && (
                    <BusinessBadge business={transcript.business} />
                  )}

                  {/* Action count */}
                  {transcript.action_count > 0 && (
                    <span
                      className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}
                    >
                      <Hash className="w-3 h-3" />
                      {transcript.action_count} action{transcript.action_count !== 1 ? 's' : ''}
                    </span>
                  )}

                  {/* Created */}
                  <span className="text-[11px] text-text-muted font-mono flex-shrink-0">
                    {transcript.created_at ? formatTimestamp(transcript.created_at) : ''}
                  </span>

                  {/* Expand indicator */}
                  <ChevronRight
                    className={`w-4 h-4 text-text-muted transition-transform flex-shrink-0 ${
                      isExpanded ? 'rotate-90' : ''
                    }`}
                  />
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-5 pb-4 pt-0 ml-12 sm:ml-14 space-y-3">
                    {/* Summary */}
                    {transcript.summary && (
                      <div>
                        <p className="text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-1">
                          Summary
                        </p>
                        <p className="text-text-secondary text-sm leading-relaxed">
                          {transcript.summary}
                        </p>
                      </div>
                    )}

                    {/* Decisions */}
                    {transcript.decisions && transcript.decisions.length > 0 && (
                      <div>
                        <p className="text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-1">
                          Decisions
                        </p>
                        <ul className="space-y-0.5">
                          {transcript.decisions.map((d, i) => (
                            <li key={i} className="text-text-secondary text-sm flex items-start gap-1.5">
                              <span className="text-accent mt-1">-</span>
                              {d}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Open Questions */}
                    {transcript.open_questions && transcript.open_questions.length > 0 && (
                      <div>
                        <p className="text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-1">
                          Open Questions
                        </p>
                        <ul className="space-y-0.5">
                          {transcript.open_questions.map((q, i) => (
                            <li key={i} className="text-text-secondary text-sm flex items-start gap-1.5">
                              <span className="text-blue-400 mt-1">?</span>
                              {q}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Participants list */}
                    {participants.length > 0 && (
                      <div>
                        <p className="text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-1">
                          Participants
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {participants.map(p => (
                            <span
                              key={p}
                              className="text-xs px-2 py-0.5 rounded-full bg-bg-elevated text-text-secondary"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Metadata */}
                    <div className="pt-2 text-[10px] text-text-muted font-mono">
                      ID: {transcript.id}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
