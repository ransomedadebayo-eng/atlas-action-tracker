import React, { useMemo } from 'react'
import { Building2, Clock3, IdCard, UserRound } from 'lucide-react'
import { useOfficeDigest } from '../hooks/useOfficeDigest.js'
import { useMembers } from '../hooks/useMembers.js'
import { useBusinessContext } from '../hooks/useBusinesses.js'
import { BusinessBadge, PriorityBadge, StatusBadge, WorkModeBadge } from './StatusBadge.jsx'
import OwnerAvatars from './OwnerAvatars.jsx'
import { formatTimestamp } from '../utils/dateUtils.js'
import { parseJsonArray } from '../utils/parseUtils.js'
import { groupOfficeDigest } from '../utils/actionFilters.js'

function DigestActionRow({ action, members, onSelectAction }) {
  const owners = parseJsonArray(action.owners)
  const ownersAreOneToOne = owners.length === 1
  const assignmentId = action.agent_assignment_id || null

  return (
    <button
      type="button"
      className="w-full rounded-xl border border-border bg-bg-surface px-4 py-3 text-left transition-colors hover:border-border-hover"
      onClick={() => onSelectAction(action.id)}
      aria-label={`Open ${action.identifier || 'action'}: ${action.title}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={action.priority} />
        <StatusBadge status={action.status} />
        {action.work_mode && <WorkModeBadge workMode={action.work_mode} />}
        {action.approval_state && action.approval_state !== 'not_required' && (
          <span className="badge border-accent/20 bg-accent-muted text-accent">
            {String(action.approval_state).replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {action.identifier && (
        <p className="mt-2 font-mono text-[10px] text-text-muted">{action.identifier}</p>
      )}
      <p className="mt-1 text-sm font-semibold text-text-primary">{action.title}</p>
      {action.next_action && (
        <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{action.next_action}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
        <span className={`inline-flex items-center gap-1 ${ownersAreOneToOne ? '' : 'text-amber-400'}`}>
          <UserRound className="h-3 w-3" />
          {ownersAreOneToOne ? '1:1 owner' : `${owners.length || 0} owners`}
        </span>
        <OwnerAvatars owners={owners} members={members} max={4} size="xs" />
        <span className="inline-flex items-center gap-1 font-mono">
          <IdCard className="h-3 w-3" />
          {assignmentId || 'No assignment'}
        </span>
        {action.completed_at && (
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3 w-3" />
            {formatTimestamp(action.completed_at)}
          </span>
        )}
      </div>
    </button>
  )
}

export default function OfficeDigestPage({
  selectedBusiness,
  searchQuery = '',
  onSelectAction,
  onOpenSavedView,
}) {
  const digest = useOfficeDigest()
  const membersQuery = useMembers()
  const { BUSINESS_LIST } = useBusinessContext()
  const members = Array.isArray(membersQuery.data) ? membersQuery.data : []
  const businessLabels = useMemo(
    () => Object.fromEntries((BUSINESS_LIST || []).map(item => [item.id, item.label])),
    [BUSINESS_LIST],
  )

  const sections = useMemo(
    () => groupOfficeDigest(digest.data?.items || [], { businessLabels, selectedBusiness, searchQuery }),
    [digest.data?.items, businessLabels, selectedBusiness, searchQuery],
  )

  if (digest.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-64 animate-pulse rounded bg-bg-elevated" />
        <div className="h-40 animate-pulse rounded-xl bg-bg-surface" />
        <div className="h-40 animate-pulse rounded-xl bg-bg-surface" />
      </div>
    )
  }

  if (digest.isError) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/10 p-5 text-sm text-danger" role="alert">
        {digest.error?.message || 'Office digest could not be loaded.'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="label mb-1">Updates</p>
          <h2 className="text-2xl font-semibold text-text-primary">Office Digest</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Exact buckets from <span className="font-mono text-xs">atlas_office_digest_v1</span>.
            Done is completed in the last 48 hours.
          </p>
        </div>
        <p className="text-xs text-text-muted">
          As of {digest.data?.as_of ? formatTimestamp(digest.data.as_of) : 'now'}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {sections.map(section => (
          <button
            key={section.id}
            type="button"
            className="card p-4 text-left hover:border-border-hover"
            onClick={() => onOpenSavedView?.(section.viewId)}
          >
            <p className="label">{section.label}</p>
            <p className="mt-2 font-mono text-2xl text-text-primary">{section.count}</p>
            <p className="mt-1 text-xs text-text-muted">Open saved view</p>
          </button>
        ))}
      </div>

      {sections.map(section => (
        <section key={section.id} className="space-y-3" aria-labelledby={`office-digest-${section.id}`}>
          <div className="flex items-center justify-between gap-3">
            <h3 id={`office-digest-${section.id}`} className="text-lg font-semibold text-text-primary">
              {section.label}
            </h3>
            <button
              type="button"
              className="btn-ghost min-h-11 text-xs"
              onClick={() => onOpenSavedView?.(section.viewId)}
            >
              {section.viewId}
            </button>
          </div>

          {section.count === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-bg-surface px-4 py-8 text-sm text-text-muted">
              No actions in this bucket.
            </div>
          ) : (
            section.offices.map(office => (
              <div key={`${section.id}-${office.id || 'none'}`} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-text-muted" />
                  {office.id ? <BusinessBadge business={office.id} /> : <span className="text-xs text-text-muted">{office.label}</span>}
                  <span className="font-mono text-[11px] text-text-muted">{office.actions.length}</span>
                </div>
                <div className="space-y-2">
                  {office.actions.map(action => (
                    <DigestActionRow
                      key={action.id}
                      action={action}
                      members={members}
                      onSelectAction={onSelectAction}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      ))}
    </div>
  )
}
