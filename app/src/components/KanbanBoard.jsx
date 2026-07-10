import React, { useState, useMemo } from 'react'
import { GripVertical, Users, Building2, Columns, EyeOff, Eye, Bot } from 'lucide-react'
import { useActions, useUpdateAction } from '../hooks/useActions.js'
import { useMembers } from '../hooks/useMembers.js'
import { PriorityBadge, BusinessBadge, WorkModeBadge } from './StatusBadge.jsx'
import OwnerAvatars from './OwnerAvatars.jsx'
import { KANBAN_COLUMNS, STATUSES, WORK_MODE_LIST, canonicalStatus } from '../utils/constants.js'
import { STATUS_COLORS, WORK_MODE_COLORS, getMemberColor } from '../utils/colors.js'
import { useBusinessContext } from '../hooks/useBusinesses.js'
import { formatRelativeDate, isOverdue } from '../utils/dateUtils.js'
import { parseJsonArray } from '../utils/parseUtils.js'
import { normalizeMemberRefs } from '../utils/memberUtils.js'

const GROUP_MODES = [
  { id: 'status', label: 'Status', Icon: Columns },
  { id: 'business', label: 'Business', Icon: Building2 },
  { id: 'owner', label: 'Owner', Icon: Users },
  { id: 'work_mode', label: 'Mode', Icon: Bot },
]

const NON_DONE_STATUSES = 'not_started,in_progress,waiting,blocked,todo,open'

export default function KanbanBoard({ selectedBusiness, onSelectAction, hideDone = true, onToggleHideDone }) {
  const { BUSINESSES, BUSINESS_LIST, BUSINESS_COLORS } = useBusinessContext()
  const [groupBy, setGroupBy] = useState('status')
  const [dragState, setDragState] = useState({ actionId: null, overColumn: null })

  const queryFilters = {
    ...(selectedBusiness ? { business: selectedBusiness } : {}),
    ...(hideDone ? { status: NON_DONE_STATUSES } : {}),
  }
  const { data: rawActions = [], isLoading, isError, error } = useActions(queryFilters)
  const { data: rawMembers = [] } = useMembers()
  const actions = Array.isArray(rawActions) ? rawActions : []
  const members = Array.isArray(rawMembers) ? rawMembers : []
  const updateAction = useUpdateAction()

  const columns = useMemo(() => {
    if (groupBy === 'status') {
      const visibleColumns = hideDone
        ? KANBAN_COLUMNS.filter(s => s !== 'done' && s !== 'cancelled')
        : KANBAN_COLUMNS
      return visibleColumns.map(status => ({
        id: status,
        label: STATUSES[status]?.label || status,
        color: STATUS_COLORS[status] || STATUS_COLORS.unknown,
        actions: actions.filter(a => canonicalStatus(a.status) === status),
      }))
    }

    if (groupBy === 'business') {
      const businessIds = selectedBusiness
        ? [selectedBusiness]
        : BUSINESS_LIST.map(b => b.id)
      const knownBusinessIds = new Set(businessIds)
      const unclassifiedActions = actions.filter(action => !action.business || !knownBusinessIds.has(action.business))
      return businessIds.map(bizId => ({
        id: bizId,
        label: BUSINESSES[bizId]?.label || bizId,
        color: BUSINESS_COLORS[bizId] || '#71717a',
        actions: actions.filter(a => a.business === bizId),
      })).concat(unclassifiedActions.length > 0 ? [{
        id: '_unclassified',
        label: 'Unclassified',
        color: '#71717a',
        actions: unclassifiedActions,
      }] : [])
    }

    if (groupBy === 'owner') {
      const ownerMap = new Map()
      for (const action of actions) {
        const owners = normalizeMemberRefs(parseJsonArray(action.owners))
        if (owners.length === 0) {
          if (!ownerMap.has('_unassigned')) ownerMap.set('_unassigned', [])
          ownerMap.get('_unassigned').push(action)
        } else {
          for (const owner of owners) {
            if (!ownerMap.has(owner.id)) ownerMap.set(owner.id, [])
            ownerMap.get(owner.id).push(action)
          }
        }
      }
      const cols = []
      for (const [ownerId, ownerActions] of ownerMap) {
        const member = members.find(m => m.id === ownerId)
        cols.push({
          id: ownerId,
          label: ownerId === '_unassigned' ? 'Unassigned' : (member?.name || ownerId),
          color: ownerId === '_unassigned' ? '#71717a' : getMemberColor(ownerId),
          actions: ownerActions,
        })
      }
      cols.sort((a, b) => b.actions.length - a.actions.length)
      return cols
    }

    if (groupBy === 'work_mode') {
      const classified = WORK_MODE_LIST.map(mode => ({
        id: mode.id,
        label: mode.label,
        color: WORK_MODE_COLORS[mode.id] || '#71717a',
        actions: actions.filter(a => a.work_mode === mode.id),
      }))
      const unclassified = {
        id: '_unclassified',
        label: 'Unclassified',
        color: '#71717a',
        actions: actions.filter(a => !a.work_mode),
      }
      return [...classified, unclassified].filter(column => column.actions.length > 0)
    }

    return []
  }, [actions, groupBy, selectedBusiness, members, hideDone])

  function handleDragStart(e, actionId) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', actionId)
    setDragState(prev => ({ ...prev, actionId }))
  }

  function handleDragOver(e, columnId) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragState.overColumn !== columnId) {
      setDragState(prev => ({ ...prev, overColumn: columnId }))
    }
  }

  function handleDragLeave(e, columnId) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragState(prev => prev.overColumn === columnId ? { ...prev, overColumn: null } : prev)
    }
  }

  function handleDrop(e, columnId) {
    e.preventDefault()
    const actionId = e.dataTransfer.getData('text/plain')
    if (!actionId) return

    if (groupBy === 'status' && ['done', 'cancelled', 'archived'].includes(columnId)) return

    if (groupBy === 'status') {
      updateAction.mutate({ id: actionId, status: columnId })
    } else if (groupBy === 'business') {
      updateAction.mutate({ id: actionId, business: columnId })
    } else if (groupBy === 'work_mode') {
      updateAction.mutate({ id: actionId, work_mode: columnId === '_unclassified' ? null : columnId })
    }

    setDragState({ actionId: null, overColumn: null })
  }

  function handleDragEnd() {
    setDragState({ actionId: null, overColumn: null })
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex-1 glass-card p-5 animate-pulse">
              <div className="h-5 bg-bg-elevated rounded w-24 mb-4" />
              <div className="space-y-3">
                <div className="h-24 bg-bg-elevated rounded" />
                <div className="h-24 bg-bg-elevated rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/10 p-5 text-sm text-danger" role="alert">
        {error?.message || 'Kanban actions could not be loaded.'}
      </div>
    )
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Grouping toggles */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="label mr-2">
          Group by
        </span>
        {GROUP_MODES.map(mode => (
          <button
            key={mode.id}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-widest font-bold transition-colors border ${
              groupBy === mode.id
                ? 'bg-accent-muted text-accent border-accent/20'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated border-white/10'
            }`}
            onClick={() => setGroupBy(mode.id)}
          >
            <mode.Icon className="w-3.5 h-3.5" />
            {mode.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          {onToggleHideDone && (
            <button
              type="button"
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-bold transition-colors flex-shrink-0 border ${
                hideDone
                  ? 'bg-accent-muted text-accent border-accent/20'
                  : 'text-text-muted hover:text-text-secondary hover:bg-bg-elevated border-white/10'
              }`}
              onClick={() => onToggleHideDone(!hideDone)}
              aria-label={hideDone ? 'Show completed tasks' : 'Hide completed tasks'}
              aria-pressed={hideDone}
            >
              {hideDone ? (
                <EyeOff className="w-3 h-3" />
              ) : (
                <Eye className="w-3 h-3" />
              )}
              <span className="hidden sm:inline">{hideDone ? 'Done hidden' : 'Showing done'}</span>
            </button>
          )}
          <span className="text-text-muted text-xs font-mono">
            {actions.length} action{actions.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Columns */}
      <div className="flex gap-3 md:gap-4 flex-1 overflow-x-auto pb-2 min-h-0 snap-x snap-mandatory md:snap-none -mx-4 px-4 md:mx-0 md:px-0">
        {columns.map(column => {
          const isDragOver = dragState.overColumn === column.id && dragState.actionId
          const canDrop = (groupBy === 'status' && !['done', 'cancelled', 'archived'].includes(column.id))
            || groupBy === 'business'
            || groupBy === 'work_mode'

          return (
            <div
              key={column.id}
              className={`flex flex-col min-w-[260px] w-[260px] md:min-w-[280px] md:w-[280px] flex-shrink-0 rounded-2xl transition-colors snap-start ${
                isDragOver && canDrop ? 'ring-1 ring-accent/50' : ''
              }`}
              style={{ background: isDragOver && canDrop ? 'rgba(75,226,119,0.05)' : 'transparent' }}
              onDragOver={canDrop ? (e) => handleDragOver(e, column.id) : undefined}
              onDragLeave={canDrop ? (e) => handleDragLeave(e, column.id) : undefined}
              onDrop={canDrop ? (e) => handleDrop(e, column.id) : undefined}
            >
              {/* Column header */}
              <div className="flex items-center gap-2 px-3 py-2.5 mb-2">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: column.color }}
                />
                <span className="text-text-primary text-sm font-headline font-semibold truncate">
                  {column.label}
                </span>
                <span
                  className="text-[10px] font-mono px-2 py-0.5 rounded-full ml-auto flex-shrink-0 border"
                  style={{ backgroundColor: `${column.color}12`, color: column.color, borderColor: `${column.color}25` }}
                >
                  {column.actions.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto space-y-2 px-1">
                {column.actions.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-text-muted text-xs border border-dashed border-white/10 rounded-2xl mx-1">
                    No actions
                  </div>
                ) : (
                  column.actions.map(action => {
                    const owners = parseJsonArray(action.owners)
                    const normalizedStatus = canonicalStatus(action.status)
                    const statusColor = STATUS_COLORS[normalizedStatus] || STATUS_COLORS.unknown
                    const statusLabel = STATUSES[normalizedStatus]?.label || 'Unclassified'
                    const overdue = isOverdue(action.due_date) && normalizedStatus !== 'done'
                    const isDragging = dragState.actionId === action.id

                    return (
                      <div
                        key={action.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open action: ${action.title}`}
                        className={`glass-card p-4 cursor-pointer hover:border-white/10 transition-all group ${
                          isDragging ? 'opacity-40' : ''
                        } ${normalizedStatus === 'done' ? 'opacity-50' : ''}`}
                        style={overdue ? { borderLeftColor: '#ef444460', borderLeftWidth: 2 } : {}}
                        draggable={!['done', 'cancelled', 'archived'].includes(normalizedStatus)}
                        onDragStart={(e) => handleDragStart(e, action.id)}
                        onDragEnd={handleDragEnd}
                        onClick={() => onSelectAction(action.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            onSelectAction(action.id)
                          }
                        }}
                      >
                        {/* Top row: priority + grip */}
                        <div className="flex items-center justify-between mb-2">
                          <PriorityBadge priority={action.priority} />
                          <GripVertical className="w-3.5 h-3.5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity cursor-grab" />
                        </div>

                        {/* Title */}
                        <p className={`text-sm font-medium leading-snug mb-2 ${
                          normalizedStatus === 'done' ? 'line-through text-text-muted' : 'text-text-primary'
                        }`}>
                          {action.title}
                        </p>

                        {/* Tags row */}
                        <div className="flex items-center gap-1.5 flex-wrap mb-2">
                          {groupBy !== 'business' && action.business && (
                            <BusinessBadge business={action.business} />
                          )}
                          {groupBy !== 'work_mode' && (
                            <WorkModeBadge workMode={action.work_mode} />
                          )}
                          {groupBy !== 'status' && (
                            <span
                              className="badge"
                              style={{
                                backgroundColor: `${statusColor}15`,
                                color: statusColor,
                                borderColor: `${statusColor}30`,
                              }}
                            >
                              <span
                                className="w-1.5 h-1.5 rounded-full mr-1"
                                style={{ backgroundColor: statusColor }}
                              />
                              {statusLabel}
                            </span>
                          )}
                        </div>

                        {/* Recurrence indicator */}
                        {action.recurrence && action.recurrence !== 'none' && (
                          <span className="text-[10px] text-text-muted mt-0.5" title={`Repeats ${action.recurrence}`}>&#8635; {action.recurrence}</span>
                        )}

                        {/* Bottom row: due date + owners */}
                        <div className="flex items-center justify-between mt-1">
                          {action.due_date ? (
                            <span
                              className={`text-[11px] font-mono ${
                                overdue ? 'text-red-400 font-semibold' : 'text-text-muted'
                              }`}
                            >
                              {formatRelativeDate(action.due_date)}
                            </span>
                          ) : (
                            <span />
                          )}
                          <OwnerAvatars owners={owners} members={members} max={2} size="xs" />
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
