import React, { useMemo, useState } from 'react'
import { Archive, BookOpenText, CheckCircle2, Plus, Send } from 'lucide-react'
import {
  useArchiveJournalEntry,
  useCreateJournalEntry,
  useJournalEntries,
  usePromoteJournalEntry,
  useUpdateJournalEntry,
} from '../hooks/useJournal.js'
import { useBusinessContext } from '../hooks/useBusinesses.js'

const KINDS = ['all', 'thought', 'idea', 'journal', 'reflection', 'question']
const REVIEW_STATES = ['all', 'unreviewed', 'reviewed', 'promoted', 'archived']

function formatWhen(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function labelize(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function tagsFromInput(value) {
  return value
    .split(/[,\n]/)
    .map(tag => tag.trim())
    .filter(Boolean)
}

function EntryCard({ entry, businesses }) {
  const updateEntry = useUpdateJournalEntry()
  const archiveEntry = useArchiveJournalEntry()
  const promoteEntry = usePromoteJournalEntry()
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [title, setTitle] = useState(entry.title || '')
  const [business, setBusiness] = useState('personal')
  const [priority, setPriority] = useState('p2')
  const [nextAction, setNextAction] = useState('')

  const reviewed = entry.review_state === 'reviewed' || entry.review_state === 'promoted'
  const isArchived = entry.review_state === 'archived' || entry.archived_at
  const promotedTargets = Array.isArray(entry.promoted_targets) ? entry.promoted_targets : []

  function markReviewed() {
    updateEntry.mutate({ id: entry.id, review_state: 'reviewed' })
  }

  function archive() {
    archiveEntry.mutate(entry.id)
  }

  function promote(e) {
    e.preventDefault()
    promoteEntry.mutate({
      id: entry.id,
      title,
      business,
      priority,
      next_action: nextAction,
      description: entry.body,
    }, {
      onSuccess: () => setPromoteOpen(false),
    })
  }

  return (
    <article className="glass-card p-4 md:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="badge border-accent/20 bg-accent-muted text-accent">{labelize(entry.kind)}</span>
            <span className="badge border-white/10 text-text-secondary">{labelize(entry.review_state)}</span>
            <span className="badge border-white/10 text-text-muted">{labelize(entry.source)}</span>
          </div>
          <h2 className="text-base font-semibold text-text-primary">
            {entry.title || entry.body?.split(/\s+/).slice(0, 9).join(' ') || 'Untitled entry'}
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{entry.body}</p>
          {Array.isArray(entry.tags) && entry.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {entry.tags.map(tag => (
                <span key={tag} className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-text-muted">
                  #{tag}
                </span>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-text-muted">{formatWhen(entry.captured_at)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!reviewed && !isArchived && (
            <button className="btn-secondary flex items-center gap-1.5 py-2" onClick={markReviewed}>
              <CheckCircle2 className="h-4 w-4" />
              Reviewed
            </button>
          )}
          {reviewed && !isArchived && (
            <button className="btn-secondary flex items-center gap-1.5 py-2" onClick={() => setPromoteOpen(v => !v)}>
              <Send className="h-4 w-4" />
              Promote
            </button>
          )}
          {!isArchived && (
            <button className="btn-ghost flex items-center gap-1.5 py-2" onClick={archive}>
              <Archive className="h-4 w-4" />
              Archive
            </button>
          )}
        </div>
      </div>

      {promotedTargets.length > 0 && (
        <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
          Promoted to {promotedTargets.map(target => target.target_type).join(', ')}
        </div>
      )}

      {promoteOpen && (
        <form className="mt-4 grid gap-3 rounded-lg border border-border bg-bg-elevated p-3 md:grid-cols-4" onSubmit={promote}>
          <label className="md:col-span-2">
            <span className="label mb-1 block">Action title</span>
            <input className="input-field w-full" value={title} onChange={e => setTitle(e.target.value)} placeholder="Action title" />
          </label>
          <label>
            <span className="label mb-1 block">Business</span>
            <select className="input-field w-full" value={business} onChange={e => setBusiness(e.target.value)}>
              {businesses.map(item => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="label mb-1 block">Priority</span>
            <select className="input-field w-full" value={priority} onChange={e => setPriority(e.target.value)}>
              {['p0', 'p1', 'p2', 'p3'].map(item => <option key={item} value={item}>{item.toUpperCase()}</option>)}
            </select>
          </label>
          <label className="md:col-span-3">
            <span className="label mb-1 block">Next action</span>
            <input className="input-field w-full" value={nextAction} onChange={e => setNextAction(e.target.value)} placeholder="What should happen next?" />
          </label>
          <div className="flex items-end">
            <button className="btn-primary w-full" type="submit" disabled={promoteEntry.isPending}>
              Create Action
            </button>
          </div>
          {promoteEntry.error && (
            <p className="md:col-span-4 text-xs text-red-400">{promoteEntry.error.message}</p>
          )}
        </form>
      )}
    </article>
  )
}

export default function JournalPage({ searchQuery = '' }) {
  const [kind, setKind] = useState('all')
  const [reviewState, setReviewState] = useState('all')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const { BUSINESS_LIST } = useBusinessContext()
  const { data, isLoading, error } = useJournalEntries({
    kind,
    review_state: reviewState,
    search: searchQuery,
    include_archived: reviewState === 'archived' ? 'true' : 'false',
  })
  const createEntry = useCreateJournalEntry()
  const entries = Array.isArray(data?.entries) ? data.entries : []

  const counts = useMemo(() => ({
    total: entries.length,
    unreviewed: entries.filter(entry => entry.review_state === 'unreviewed').length,
    reviewed: entries.filter(entry => entry.review_state === 'reviewed').length,
    promoted: entries.filter(entry => entry.review_state === 'promoted').length,
  }), [entries])

  function submit(e) {
    e.preventDefault()
    createEntry.mutate({
      kind: kind === 'all' ? 'thought' : kind,
      title,
      body,
      tags: tagsFromInput(tags),
    }, {
      onSuccess: () => {
        setTitle('')
        setBody('')
        setTags('')
      },
    })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="label mb-1">Private capture</p>
          <h1 className="text-xl font-semibold text-text-primary">Journal</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            User-authored notes stay here until reviewed. Promote only what should become tracked Atlas work.
          </p>
        </div>
        <div className="grid grid-cols-4 gap-2 rounded-lg border border-border bg-bg-surface p-2 text-center text-xs">
          <span><strong className="block text-text-primary">{counts.total}</strong><span className="text-text-muted">Shown</span></span>
          <span><strong className="block text-text-primary">{counts.unreviewed}</strong><span className="text-text-muted">New</span></span>
          <span><strong className="block text-text-primary">{counts.reviewed}</strong><span className="text-text-muted">Reviewed</span></span>
          <span><strong className="block text-text-primary">{counts.promoted}</strong><span className="text-text-muted">Promoted</span></span>
        </div>
      </div>

      <form className="glass-card grid gap-3 p-4 md:grid-cols-6" onSubmit={submit}>
        <div className="md:col-span-2">
          <label className="label mb-1 block">Title</label>
          <input className="input-field w-full" value={title} onChange={e => setTitle(e.target.value)} placeholder="Optional title" />
        </div>
        <div>
          <label className="label mb-1 block">Kind</label>
          <select className="input-field w-full" value={kind === 'all' ? 'thought' : kind} onChange={e => setKind(e.target.value)}>
            {KINDS.filter(item => item !== 'all').map(item => <option key={item} value={item}>{labelize(item)}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label mb-1 block">Tags</label>
          <input className="input-field w-full" value={tags} onChange={e => setTags(e.target.value)} placeholder="Comma separated" />
        </div>
        <div className="flex items-end">
          <button className="btn-primary flex w-full items-center justify-center gap-2" type="submit" disabled={createEntry.isPending}>
            <Plus className="h-4 w-4" />
            Save
          </button>
        </div>
        <div className="md:col-span-6">
          <label className="label mb-1 block">Entry</label>
          <textarea className="input-field min-h-28 w-full resize-y" value={body} onChange={e => setBody(e.target.value)} placeholder="Capture the thought, reflection, or decision seed..." required />
        </div>
        {createEntry.error && <p className="md:col-span-6 text-xs text-red-400">{createEntry.error.message}</p>}
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <BookOpenText className="h-4 w-4 text-text-muted" />
        <select className="input-field py-2 text-xs" value={kind} onChange={e => setKind(e.target.value)}>
          {KINDS.map(item => <option key={item} value={item}>{labelize(item)}</option>)}
        </select>
        <select className="input-field py-2 text-xs" value={reviewState} onChange={e => setReviewState(e.target.value)}>
          {REVIEW_STATES.map(item => <option key={item} value={item}>{labelize(item)}</option>)}
        </select>
      </div>

      {error && <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-400">{error.message}</div>}
      {isLoading ? (
        <div className="glass-card p-6 text-sm text-text-muted">Loading journal...</div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-bg-surface p-8 text-center text-sm text-text-muted">
          No journal entries match this view.
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map(entry => (
            <EntryCard key={entry.id} entry={entry} businesses={BUSINESS_LIST} />
          ))}
        </div>
      )}
    </div>
  )
}
