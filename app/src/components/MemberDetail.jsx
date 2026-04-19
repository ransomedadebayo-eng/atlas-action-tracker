import React, { useState, useMemo } from 'react'
import { ArrowLeft, AlertTriangle, CheckCircle2, Clock, Circle } from 'lucide-react'
import { useMember, useMemberActions, useMembers } from '../hooks/useMembers.js'
import { StatusBadge, PriorityBadge, BusinessBadge } from './StatusBadge.jsx'
import OwnerAvatars from './OwnerAvatars.jsx'
import { getMemberColor, STATUS_COLORS } from '../utils/colors.js'
import { getInitials } from '../utils/memberUtils.js'
import { formatRelativeDate, isOverdue } from '../utils/dateUtils.js'
import { STATUSES, STATUS_LIST } from '../utils/constants.js'

export default function MemberDetail({ memberId, onBack, onSelectAction }) {
  const [statusFilter, setStatusFilter] = useState('all')

  const { data: member, isLoading: memberLoading } = useMember(memberId)
  const { data: allMembers = [] } = useMembers()

  const { data: allActions = [], isLoading: actionsLoading } = useMemberActions(memberId)

  const actions = useMemo(() => {
    if (statusFilter === 'all') return allActions
    return allActions.filter(a => a.status === statusFilter)
  }, [allActions, statusFilter])

  const color = getMemberColor(memberId)
  const stats = useMemo(() => {
    const counts = { not_started: 0, in_progress: 0, waiting: 0, blocked: 0, done: 0 }
    let overdueCount = 0
    for (const a of allActions) {
      if (counts[a.status] !== undefined) counts[a.status]++
      if (isOverdue(a.due_date) && a.status !== 'done' && a.status !== 'blocked') {
        overdueCount++
      }
    }
    return { ...counts, total: allActions.length, overdue: overdueCount }
  }, [allActions])

  if (memberLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-bg-elevated rounded w-32" />
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-bg-elevated" />
          <div className="space-y-2">
            <div className="h-6 bg-bg-elevated rounded w-40" />
            <div className="h-4 bg-bg-elevated rounded w-24" />
          </div>
        </div>
      </div>
    )
  }

  if (!member) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-text-primary font-medium">Member not found</p>
        <button className="btn-ghost text-sm mt-2" onClick={onBack}>
          Go back
        </button>
      </div>
    )
  }

  const statCards = [
    { label: 'Active', value: stats.not_started + stats.in_progress + stats.waiting, color: '#3b82f6', icon: Clock },
    { label: 'Overdue', value: stats.overdue, color: '#ef4444', icon: AlertTriangle, alert: stats.overdue > 0 },
    { label: 'Done', value: stats.done, color: '#f4b860', icon: CheckCircle2 },
    { label: 'Total', value: stats.total, color: '#71717a', icon: Circle },
  ]

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        className="btn-ghost flex items-center gap-1.5 text-sm -ml-3"
        onClick={onBack}
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Team
      </button>

      {/* Member header */}
      <div className="flex items-start gap-4">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center font-mono font-bold text-xl flex-shrink-0"
          style={{ backgroundColor: `${color}30`, color }}
        >
          {getInitials(member.name)}
        </div>
        <div>
          <h2 className="text-xl font-semibold text-text-primary">
            {member.name}
          </h2>
          {member.full_name && member.full_name !== member.name && (
            <p className="text-text-secondary text-sm">{member.full_name}</p>
          )}
          {member.role && (
            <p className="text-text-muted text-sm mt-0.5">{member.role}</p>
          )}
          {member.email && (
            <p className="text-text-muted text-xs font-mono mt-1">{member.email}</p>
          )}
          <div className="flex items-center gap-1 mt-2">
            {(member.businesses || []).map(bizId => (
              <BusinessBadge key={bizId} business={bizId} />
            ))}
          </div>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-3">
        {statCards.map(card => (
          <div
            key={card.label}
            className={`card p-3 ${card.alert ? 'border-opacity-50' : ''}`}
            style={card.alert ? { borderColor: `${card.color}40` } : undefined}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-text-secondary text-[11px] font-medium uppercase tracking-wider">
                {card.label}
              </span>
              <card.icon className="w-3.5 h-3.5" style={{ color: card.color }} />
            </div>
            <div
              className={`text-xl font-mono font-bold ${card.alert ? '' : 'text-text-primary'}`}
              style={card.alert ? { color: card.color } : undefined}
            >
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Status breakdown bar */}
      {stats.total > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            {STATUS_LIST.map(s => (
              <div key={s.id} className="flex items-center gap-1">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: STATUS_COLORS[s.id] }}
                />
                <span className="text-[10px] text-text-muted font-mono">
                  {s.label} ({stats[s.id] || 0})
                </span>
              </div>
            ))}
          </div>
          <div className="h-2 bg-bg-primary rounded-full overflow-hidden flex">
            {STATUS_LIST.map(s => {
              const count = stats[s.id] || 0
              if (count === 0) return null
              return (
                <div
                  key={s.id}
                  className="h-full transition-all"
                  style={{
                    width: `${(count / stats.total) * 100}%`,
                    backgroundColor: STATUS_COLORS[s.id],
                  }}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 border-b border-border pb-0.5">
        <button
          className={`px-3 py-1.5 rounded-t-md text-sm font-medium transition-colors ${
            statusFilter === 'all'
              ? 'bg-bg-elevated text-text-primary'
              : 'text-text-secondary hover:text-text-primary'
          }`}
          onClick={() => setStatusFilter('all')}
        >
          All ({stats.total})
        </button>
        {STATUS_LIST.filter(s => (stats[s.id] || 0) > 0).map(s => (
          <button
            key={s.id}
            className={`px-3 py-1.5 rounded-t-md text-sm font-medium transition-colors ${
              statusFilter === s.id
                ? 'bg-bg-elevated text-text-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
            onClick={() => setStatusFilter(s.id)}
          >
            {s.label} ({stats[s.id]})
          </button>
        ))}
      </div>

      {/* Actions list */}
      {actionsLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-3 animate-pulse">
              <div className="h-4 bg-bg-elevated rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : actions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-text-primary font-medium">No actions</p>
          <p className="text-text-muted text-sm mt-1">
            {statusFilter !== 'all' ? 'No actions in this status' : 'No actions assigned to this member'}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {actions.map(action => {
            const overdue = isOverdue(action.due_date) && action.status !== 'done'
            const done = action.status === 'done'
            const owners = Array.isArray(action.owners)
              ? action.owners
              : JSON.parse(action.owners || '[]')

            return (
              <div
                key={action.id}
                className={`card px-4 py-3 cursor-pointer hover:border-border-hover transition-colors flex items-center gap-3 ${
                  done ? 'opacity-50' : ''
                }`}
                style={overdue ? { borderLeft: `2px solid #ef444460` } : {}}
                onClick={() => onSelectAction(action.id)}
              >
                <PriorityBadge priority={action.priority} />
                <StatusBadge status={action.status} />
                <span className={`flex-1 text-sm font-medium min-w-0 truncate ${
                  done ? 'line-through text-text-muted' : 'text-text-primary'
                }`}>
                  {action.title}
                </span>
                <BusinessBadge business={action.business} />
                {action.due_date && (
                  <span className={`text-xs font-mono flex-shrink-0 ${
                    overdue ? 'text-red-400 font-semibold' : 'text-text-muted'
                  }`}>
                    {formatRelativeDate(action.due_date)}
                  </span>
                )}
                <OwnerAvatars owners={owners} members={allMembers} max={2} size="xs" />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
