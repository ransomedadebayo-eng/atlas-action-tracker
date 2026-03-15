import React, { useState, useMemo } from 'react'
import { Search, ChevronRight, AlertTriangle } from 'lucide-react'
import { useMembers, useMemberStats } from '../hooks/useMembers.js'
import { BusinessBadge } from './StatusBadge.jsx'
import MemberDetail from './MemberDetail.jsx'
import WorkloadChart from './WorkloadChart.jsx'
import { getMemberColor, STATUS_COLORS } from '../utils/colors.js'
import { getInitials } from '../utils/memberUtils.js'

export default function MemberList({ onSelectAction }) {
  const [search, setSearch] = useState('')
  const [selectedMemberId, setSelectedMemberId] = useState(null)
  const [showChart, setShowChart] = useState(true)

  const { data: members = [], isLoading: membersLoading } = useMembers()
  const { data: memberStats = [], isLoading: statsLoading } = useMemberStats()

  // Build a map of member_id -> stats
  const statsMap = useMemo(() => {
    const map = {}
    for (const s of memberStats) {
      map[s.member_id] = s
    }
    return map
  }, [memberStats])

  // Filter members by search
  const filtered = useMemo(() => {
    if (!search.trim()) return members
    const q = search.toLowerCase()
    return members.filter(m =>
      m.name.toLowerCase().includes(q) ||
      (m.full_name && m.full_name.toLowerCase().includes(q)) ||
      (m.role && m.role.toLowerCase().includes(q))
    )
  }, [members, search])

  if (selectedMemberId) {
    return (
      <MemberDetail
        memberId={selectedMemberId}
        onBack={() => setSelectedMemberId(null)}
        onSelectAction={onSelectAction}
      />
    )
  }

  if (membersLoading) {
    return (
      <div className="space-y-4">
        <div className="h-10 bg-bg-elevated rounded animate-pulse w-64" />
        <div className="grid grid-cols-2 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-bg-elevated" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-bg-elevated rounded w-24" />
                  <div className="h-3 bg-bg-elevated rounded w-16" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Workload Chart */}
      {showChart && memberStats.length > 0 && (
        <WorkloadChart stats={memberStats} members={members} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-text-primary font-semibold">
            Team Directory
          </h2>
          <span className="text-text-muted text-xs font-mono">
            {filtered.length} member{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            className={`text-xs px-2 py-1 rounded-md transition-colors ${
              showChart
                ? 'bg-bg-elevated text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
            onClick={() => setShowChart(v => !v)}
          >
            {showChart ? 'Hide Chart' : 'Show Chart'}
          </button>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              type="text"
              className="input-field pl-8 pr-3 py-1.5 text-sm w-56"
              placeholder="Search team..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Member grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {filtered.map(member => {
          const color = getMemberColor(member.id)
          const stats = statsMap[member.id]
          const activeCount = stats?.active || 0
          const overdueCount = stats?.overdue || 0
          const doneCount = stats?.done || 0
          const totalCount = stats?.total || 0

          return (
            <div
              key={member.id}
              className="card p-4 cursor-pointer hover:border-border-hover transition-colors group"
              onClick={() => setSelectedMemberId(member.id)}
            >
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center font-mono font-semibold text-sm flex-shrink-0"
                  style={{ backgroundColor: `${color}30`, color }}
                >
                  {getInitials(member.name)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-text-primary font-medium text-sm truncate">
                      {member.name}
                    </span>
                    {member.full_name && member.full_name !== member.name && (
                      <span className="text-text-muted text-xs truncate hidden sm:inline">
                        {member.full_name}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity ml-auto flex-shrink-0" />
                  </div>

                  {member.role && (
                    <p className="text-text-muted text-xs mt-0.5">{member.role}</p>
                  )}

                  {/* Business tags */}
                  <div className="flex items-center gap-1 mt-2 flex-wrap">
                    {(member.businesses || []).map(bizId => (
                      <BusinessBadge key={bizId} business={bizId} />
                    ))}
                  </div>

                  {/* Workload bar */}
                  {totalCount > 0 && (
                    <div className="mt-2.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-text-secondary font-mono">
                            {activeCount} active
                          </span>
                          {overdueCount > 0 && (
                            <span className="flex items-center gap-0.5 text-[11px] text-red-400 font-mono">
                              <AlertTriangle className="w-3 h-3" />
                              {overdueCount} overdue
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-text-muted font-mono">
                          {doneCount} done
                        </span>
                      </div>
                      {/* Mini progress bar */}
                      <div className="h-1.5 bg-bg-primary rounded-full overflow-hidden flex">
                        {stats?.not_started > 0 && (
                          <div
                            className="h-full"
                            style={{
                              width: `${(stats.not_started / totalCount) * 100}%`,
                              backgroundColor: STATUS_COLORS.not_started,
                            }}
                          />
                        )}
                        {stats?.in_progress > 0 && (
                          <div
                            className="h-full"
                            style={{
                              width: `${(stats.in_progress / totalCount) * 100}%`,
                              backgroundColor: STATUS_COLORS.in_progress,
                            }}
                          />
                        )}
                        {stats?.waiting > 0 && (
                          <div
                            className="h-full"
                            style={{
                              width: `${(stats.waiting / totalCount) * 100}%`,
                              backgroundColor: STATUS_COLORS.waiting,
                            }}
                          />
                        )}
                        {stats?.blocked > 0 && (
                          <div
                            className="h-full"
                            style={{
                              width: `${(stats.blocked / totalCount) * 100}%`,
                              backgroundColor: STATUS_COLORS.blocked,
                            }}
                          />
                        )}
                        {stats?.done > 0 && (
                          <div
                            className="h-full"
                            style={{
                              width: `${(stats.done / totalCount) * 100}%`,
                              backgroundColor: STATUS_COLORS.done,
                            }}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-text-primary font-medium">No members found</p>
          <p className="text-text-muted text-sm mt-1">
            {search ? 'Try a different search term' : 'No team members yet'}
          </p>
        </div>
      )}
    </div>
  )
}
