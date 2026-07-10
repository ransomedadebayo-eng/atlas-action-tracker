import React from 'react'
import { RefreshCcw } from 'lucide-react'
import { useAutomationRegistry } from '../hooks/useAtlasOs.js'

export default function AutomationRegistry() {
  const { data, isLoading, isError, error, refetch, isFetching } = useAutomationRegistry()
  const jobs = data?.jobs || []

  if (isLoading) return <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-bg-elevated" />)}</div>
  if (isError) return <div className="rounded-xl border border-danger/30 bg-danger/10 p-5 text-sm text-danger">{error?.message || 'Automations could not load.'}</div>

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="label mb-2">Atlas Automations</p>
          <h1 className="text-2xl font-bold text-text-primary">Registry and last run</h1>
          <p className="mt-1 text-sm text-text-secondary">Read-only status from guarded Codex protocol reports. Automations cannot be run from ATLAS.</p>
        </div>
        <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCcw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-bg-surface">
        <div className="grid grid-cols-[1.2fr_1fr_1fr_1.4fr] gap-3 border-b border-border px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-text-muted">
          <span>Automation</span>
          <span>Schedule</span>
          <span>Writes to</span>
          <span>Last report</span>
        </div>
        {jobs.map(job => (
          <div key={job.id} className="grid grid-cols-1 gap-3 border-b border-border px-4 py-4 last:border-b-0 md:grid-cols-[1.2fr_1fr_1fr_1.4fr] md:items-center">
            <div>
              <p className="font-semibold text-text-primary">{job.id}</p>
              <p className="text-xs text-text-muted">{job.route_used}</p>
            </div>
            <p className="text-sm text-text-secondary">{job.schedule}</p>
            <div className="flex flex-wrap gap-1.5">
              {(job.writes_to || []).map(surface => <span key={surface} className="badge border-white/10 text-text-secondary">{surface}</span>)}
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">{job.latest_report?.title || 'No report yet'}</p>
              <p className="text-xs text-text-muted">{job.latest_report?.created_at ? new Date(job.latest_report.created_at).toLocaleString() : ''}</p>
            </div>
          </div>
        ))}
        {jobs.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-text-muted">
            No verified automation reports are available yet.
          </div>
        )}
      </div>
    </div>
  )
}
