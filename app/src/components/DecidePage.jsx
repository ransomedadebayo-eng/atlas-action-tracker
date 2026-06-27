import React from 'react'
import { AlertTriangle, ArrowUpRight, CheckCircle2, ClipboardCheck, Clock3, FileCheck2, ShieldAlert, XCircle } from 'lucide-react'
import { useDecisionQueue, useDecideProposal } from '../hooks/useDecide.js'

function labelize(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function formatWhen(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function textValue(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function proposalPayload(row) {
  const candidates = [row.proposal_json, row.payload_json, row.recommendation_json, row.details_json, row.metadata_json]
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate
  }
  return {}
}

function summarizeProposal(row) {
  const payload = proposalPayload(row)
  const title = textValue(row.title || payload.title || payload.summary_title || payload.recommendation_title || `${labelize(row.entity_type)} proposal`)
  const summary = textValue(row.summary || payload.summary || payload.description || payload.rationale || payload.recommendation)
  const recommendation = textValue(row.recommendation || payload.recommendation || payload.next_step || payload.proposed_change)
  const highlights = [payload.implemented, payload.verified, payload.remaining_work, payload.why, payload.reason]
    .map(textValue)
    .filter(Boolean)
    .slice(0, 4)
  return { title, summary, recommendation, highlights }
}

function statusTone(status) {
  if (status === 'approved') return 'border-blue-500/25 bg-blue-500/10 text-blue-400'
  if (status === 'applied') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
  if (status === 'rejected') return 'border-red-500/25 bg-red-500/10 text-red-400'
  if (status === 'deferred') return 'border-white/10 bg-bg-elevated text-text-secondary'
  return 'border-accent/20 bg-accent-muted text-accent'
}

function DecisionButton({ proposalId, decision, label, Icon, className }) {
  const decide = useDecideProposal()
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${className}`}
      onClick={() => decide.mutate({ id: proposalId, decision })}
      disabled={decide.isPending}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

function ProposalCard({ row, reports }) {
  const summary = summarizeProposal(row)
  const status = row.status || 'pending'
  const isPending = status === 'pending'
  const isApproved = status === 'approved'
  const relatedReport = reports.find(report => {
    const raw = report.artifacts_json
    if (!raw || typeof raw !== 'object') return false
    return raw.proposal_id === row.id || raw.ai_proposal_id === row.id
  })

  return (
    <article className="glass-card p-4 md:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-text-primary">{summary.title}</h2>
            <span className={`badge ${statusTone(status)}`}>{status === 'approved' ? 'Accepted' : labelize(status)}</span>
          </div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
            {labelize(row.entity_type)} · {row.proposed_by || 'AEGIS'} · {formatWhen(row.proposed_at || row.created_at)}
          </p>
        </div>
        <span className="font-mono text-[10px] text-text-muted">{String(row.id || '').slice(0, 8)}</span>
      </div>

      {summary.summary && <p className="mt-3 text-sm leading-6 text-text-secondary">{summary.summary}</p>}
      {summary.recommendation && (
        <div className="mt-3 rounded-lg border border-border bg-bg-elevated p-3">
          <p className="label mb-1">Recommendation</p>
          <p className="text-sm leading-6 text-text-primary">{summary.recommendation}</p>
        </div>
      )}
      {relatedReport && (
        <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-400">
          <p className="mb-1 flex items-center gap-1.5 font-semibold">
            <FileCheck2 className="h-4 w-4" />
            Result ready for review
          </p>
          <p>{relatedReport.title || relatedReport.summary || 'Automation report is available.'}</p>
        </div>
      )}
      {summary.highlights.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {summary.highlights.map(item => (
            <li key={item} className="flex gap-2 text-sm leading-6 text-text-secondary">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-muted" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}

      {isPending && (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
          <DecisionButton proposalId={row.id} decision="approve" label="Accept direction" Icon={CheckCircle2} className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:border-emerald-500/50" />
          <DecisionButton proposalId={row.id} decision="reject" label="Reject" Icon={XCircle} className="border-red-500/25 bg-red-500/10 text-red-400 hover:border-red-500/50" />
          <DecisionButton proposalId={row.id} decision="defer" label="Defer" Icon={Clock3} className="border-white/10 text-text-secondary hover:text-text-primary" />
        </div>
      )}
      {isApproved && (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
          <DecisionButton proposalId={row.id} decision="close" label="Close as done" Icon={ClipboardCheck} className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:border-emerald-500/50" />
          <DecisionButton proposalId={row.id} decision="defer" label="Needs revision" Icon={Clock3} className="border-white/10 text-text-secondary hover:text-text-primary" />
          <DecisionButton proposalId={row.id} decision="reject" label="Reject" Icon={XCircle} className="border-red-500/25 bg-red-500/10 text-red-400 hover:border-red-500/50" />
        </div>
      )}
    </article>
  )
}

function QueueSection({ title, count, hint, children }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-text-secondary">{title}</h2>
          <p className="mt-1 text-xs text-text-muted">{hint}</p>
        </div>
        <span className="rounded-full border border-border px-2.5 py-1 text-xs text-text-muted">{count}</span>
      </div>
      {children}
    </section>
  )
}

function CompactRows({ rows, empty, getTitle, getMeta }) {
  if (!rows.length) {
    return <div className="rounded-lg border border-dashed border-border bg-bg-surface p-4 text-sm text-text-muted">{empty}</div>
  }
  return (
    <div className="glass-card divide-y divide-white/10">
      {rows.map(row => (
        <div key={row.id} className="flex items-start justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">{getTitle(row)}</p>
            <p className="mt-1 text-xs text-text-muted">{getMeta(row)}</p>
          </div>
          <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-text-muted" />
        </div>
      ))}
    </div>
  )
}

export default function DecidePage() {
  const { data, isLoading, error } = useDecisionQueue()
  const proposals = Array.isArray(data?.proposals) ? data.proposals : []
  const reports = Array.isArray(data?.reports) ? data.reports : []
  const runs = Array.isArray(data?.runs) ? data.runs : []
  const signals = Array.isArray(data?.signals) ? data.signals : []
  const reviews = Array.isArray(data?.reviews) ? data.reviews : []
  const sourceErrors = Array.isArray(data?.source_errors) ? data.source_errors : []
  const total = proposals.length + runs.length + signals.length + reviews.length

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="label mb-1">Owner decisions</p>
          <h1 className="text-xl font-semibold text-text-primary">Decide</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Proposals, blockers, review packets, and agent runs that need a clear accept, reject, defer, or closeout.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-secondary">
          <ShieldAlert className="h-4 w-4 text-accent" />
          {total} open
        </div>
      </div>

      {isLoading && <div className="glass-card p-6 text-sm text-text-muted">Loading decision queue...</div>}
      {error && <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-400">{error.message}</div>}

      {sourceErrors.length > 0 && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-400">
          <p className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Some supporting sources could not load</p>
          <p>{sourceErrors.map(item => item.source).join(', ')}</p>
        </div>
      )}

      {!isLoading && total === 0 && (
        <div className="glass-card flex flex-col items-center gap-2 p-10 text-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-400" />
          <p className="text-sm text-text-secondary">Decision queue is clear.</p>
        </div>
      )}

      {proposals.length > 0 && (
        <QueueSection title="Proposals" count={proposals.length} hint="Packets that need a direction or final closeout.">
          <div className="space-y-3">
            {proposals.map(row => <ProposalCard key={row.id} row={row} reports={reports} />)}
          </div>
        </QueueSection>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <QueueSection title="Agent runs" count={runs.length} hint="Blocked, failed, proposal-ready, or review-required runs.">
          <CompactRows
            rows={runs}
            empty="No agent runs need owner action."
            getTitle={row => row.result_summary || labelize(row.task_type) || 'Agent run'}
            getMeta={row => `${labelize(row.status)} · ${labelize(row.risk_level)} risk · ${formatWhen(row.created_at)}${row.error_message ? ` · ${row.error_message}` : ''}`}
          />
        </QueueSection>

        <QueueSection title="Open signals" count={signals.length} hint="Open blockers and observations surfaced by agents.">
          <CompactRows
            rows={signals}
            empty="No open signals."
            getTitle={row => row.summary || row.title || row.body || 'Signal'}
            getMeta={row => `${labelize(row.severity || 'info')} · ${labelize(row.signal_type)} · ${formatWhen(row.created_at)}`}
          />
        </QueueSection>

        <QueueSection title="Strategic reviews" count={reviews.length} hint="Review runs that are ready to read.">
          <CompactRows
            rows={reviews}
            empty="No strategic reviews are ready."
            getTitle={row => row.summary || labelize(row.review_type) || 'Review'}
            getMeta={row => `${labelize(row.status)} · ${formatWhen(row.created_at)}`}
          />
        </QueueSection>
      </div>
    </div>
  )
}
