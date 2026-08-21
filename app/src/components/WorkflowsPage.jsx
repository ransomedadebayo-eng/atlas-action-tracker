import React, { useEffect, useMemo, useState } from 'react'
import {
  Archive, ArrowDown, ArrowUp, CheckCircle2, Clock3, GitBranch,
  Inbox, PauseCircle, PlayCircle, Plus, RefreshCcw, Settings2, ShieldCheck,
  Sparkles, XCircle,
} from 'lucide-react'
import { useActions } from '../hooks/useActions.js'
import { useMembers } from '../hooks/useMembers.js'
import {
  useAcceptTriage, useApplyInactivity, useArchiveWorkflowStatus,
  useCreateWorkflowRule, useCreateWorkflowStatus, useDeclineTriage,
  useDuplicateTriage, useEnterTriage, usePreviewInactivity, usePreviewWorkflowRule,
  useReorderWorkflowStatuses, useSnoozeTriage, useTransitionWorkflowRule,
  useTriage, useUpdateTriageSettings, useUpdateWorkflow, useUpdateWorkflowStatus, useWorkflow,
} from '../hooks/useWorkflows.js'

const CATEGORY_ORDER = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled', 'duplicate']
const CATEGORY_LABELS = {
  triage: 'Triage', backlog: 'Backlog', unstarted: 'Unstarted', started: 'Started',
  completed: 'Completed', canceled: 'Canceled', duplicate: 'Duplicate',
}
const LEGACY_BY_CATEGORY = {
  triage: ['open'], backlog: ['not_started', 'todo'], unstarted: ['not_started', 'todo'],
  started: ['in_progress', 'waiting', 'blocked'], completed: ['done', 'completed', 'closed'],
  canceled: ['canceled', 'cancelled'],
}
const TRIGGERS = [
  ['triage_entered', 'Enters Triage'], ['action_created', 'Action created'],
  ['action_updated', 'Action updated'], ['status_changed', 'Status changed'],
  ['priority_changed', 'Priority changed'], ['manual', 'Manual evaluation'],
]
const CONDITION_FIELDS = ['title', 'description', 'source_label', 'priority', 'status', 'workflow_category', 'tags', 'owners', 'business', 'project_id', 'work_mode']
const OPERATORS = ['eq', 'neq', 'contains', 'in', 'not_in', 'is_empty', 'not_empty']

function ErrorNotice({ error }) {
  if (!error) return null
  return <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error.message || String(error)}</p>
}

function StatusEditor({ workflow }) {
  const create = useCreateWorkflowStatus()
  const update = useUpdateWorkflowStatus()
  const archive = useArchiveWorkflowStatus()
  const reorder = useReorderWorkflowStatuses()
  const [form, setForm] = useState({ name: '', category: 'started', color: '#3b82f6', description: '', legacy_status: 'in_progress' })
  const [error, setError] = useState(null)
  const ordered = useMemo(() => [...(workflow.statuses || [])].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.position - b.position), [workflow.statuses])

  async function createStatus(event) {
    event.preventDefault(); setError(null)
    try {
      await create.mutateAsync({ workflowId: workflow.id, ...form, position: ordered.length })
      setForm(current => ({ ...current, name: '', description: '' }))
    } catch (mutationError) { setError(mutationError) }
  }

  async function saveStatus(status, changes) {
    setError(null)
    try {
      await update.mutateAsync({
        workflowId: workflow.id, statusId: status.id, expected_revision: status.revision,
        name: status.name, description: status.description, color: status.color,
        category: status.category, legacy_status: status.legacy_status,
        position: status.position, is_default: status.is_default, ...changes,
      })
    } catch (mutationError) { setError(mutationError) }
  }

  async function move(status, direction) {
    const index = ordered.findIndex(item => item.id === status.id)
    const next = index + direction
    if (next < 0 || next >= ordered.length) return
    const ids = ordered.map(item => item.id)
    ;[ids[index], ids[next]] = [ids[next], ids[index]]
    try { await reorder.mutateAsync({ workflowId: workflow.id, status_ids: ids }) } catch (mutationError) { setError(mutationError) }
  }

  async function archiveStatus(status) {
    const replacement = ordered.find(item => item.id !== status.id && item.category === status.category)
    if (!replacement) return setError(new Error('A category must keep at least one active status.'))
    if (!window.confirm(`Archive ${status.name} and move its actions to ${replacement.name}?`)) return
    try {
      await archive.mutateAsync({ workflowId: workflow.id, statusId: status.id, replacement_status_id: replacement.id, expected_revision: status.revision })
    } catch (mutationError) { setError(mutationError) }
  }

  return <div className="space-y-5">
    <section className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3"><div><p className="label">Ordered workflow</p><h2 className="mt-1 text-lg font-semibold text-text-primary">Status categories</h2><p className="mt-1 text-sm text-text-secondary">Categories stay fixed; names, colors, and order are yours.</p></div><ShieldCheck className="h-5 w-5 text-accent" /></div>
      <ErrorNotice error={error} />
      <div className="mt-4 space-y-5">
        {CATEGORY_ORDER.map(category => {
          const statuses = ordered.filter(item => item.category === category)
          return <div key={category}><p className="label mb-2">{CATEGORY_LABELS[category]}</p><div className="space-y-2">{statuses.map(status => <div key={status.id} className="grid gap-2 rounded-xl border border-border p-3 md:grid-cols-[28px_1fr_130px_auto] md:items-center">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: status.color }} aria-hidden="true" />
            <div><input aria-label={`${status.name} name`} className="input-field min-h-10 w-full" defaultValue={status.name} disabled={status.is_system} onBlur={event => event.target.value !== status.name && saveStatus(status, { name: event.target.value })} /><p className="mt-1 text-xs text-text-muted">{status.status_key} · {status.legacy_status}{status.is_system ? ' · system' : ''}</p></div>
            <input aria-label={`${status.name} color`} type="color" className="h-10 w-full rounded border border-border bg-transparent" value={status.color} disabled={status.is_system} onChange={event => saveStatus(status, { color: event.target.value })} />
            <div className="flex justify-end gap-1"><button type="button" className="btn-ghost min-h-10 px-2" aria-label={`Move ${status.name} up`} onClick={() => move(status, -1)}><ArrowUp className="h-4 w-4" /></button><button type="button" className="btn-ghost min-h-10 px-2" aria-label={`Move ${status.name} down`} onClick={() => move(status, 1)}><ArrowDown className="h-4 w-4" /></button>{!status.is_default && !status.is_system && ['backlog', 'unstarted'].includes(status.category) && <button type="button" className="btn-ghost min-h-10 text-xs" onClick={() => saveStatus(status, { is_default: true })}>Make default</button>}{status.is_default && <span className="badge border-accent/30 text-accent">Default</span>}{!status.is_system && !status.is_default && <button type="button" className="btn-ghost min-h-10 px-2 text-danger" aria-label={`Archive ${status.name}`} onClick={() => archiveStatus(status)}><Archive className="h-4 w-4" /></button>}</div>
          </div>)}</div></div>
        })}
      </div>
    </section>
    <form className="card space-y-3 p-4 sm:p-5" onSubmit={createStatus}>
      <div><p className="label">New status</p><h2 className="mt-1 text-lg font-semibold text-text-primary">Add a workflow step</h2></div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"><label><span className="label mb-1 block">Name</span><input required className="input-field min-h-11 w-full" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label><label><span className="label mb-1 block">Category</span><select className="input-field min-h-11 w-full" value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value, legacy_status: LEGACY_BY_CATEGORY[event.target.value]?.[0] || 'not_started' }))}>{CATEGORY_ORDER.filter(item => item !== 'duplicate').map(item => <option key={item} value={item}>{CATEGORY_LABELS[item]}</option>)}</select></label><label><span className="label mb-1 block">Compatibility</span><select className="input-field min-h-11 w-full" value={form.legacy_status} onChange={event => setForm(current => ({ ...current, legacy_status: event.target.value }))}>{(LEGACY_BY_CATEGORY[form.category] || []).map(item => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><label><span className="label mb-1 block">Color</span><input type="color" className="h-11 w-full rounded border border-border bg-transparent" value={form.color} onChange={event => setForm(current => ({ ...current, color: event.target.value }))} /></label></div>
      <label><span className="label mb-1 block">Description</span><input className="input-field min-h-11 w-full" value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></label>
      <div className="flex justify-end"><button type="submit" className="btn-primary min-h-11" disabled={create.isPending}><Plus className="mr-1 inline h-4 w-4" />Add status</button></div>
    </form>
  </div>
}

function TriageSettings({ workflow, members }) {
  const update = useUpdateTriageSettings()
  const settings = workflow.triage_settings || {}
  const [form, setForm] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => setForm({
    enabled: Boolean(settings.enabled), require_priority: Boolean(settings.require_priority),
    responsible_member_ids: settings.responsible_member_ids || ['ransomed'],
    default_accept_status_id: settings.default_accept_status_id || workflow.statuses.find(item => item.is_default)?.id || '',
    auto_close_days: settings.auto_close_days ?? '', auto_archive_days: settings.auto_archive_days ?? '',
    auto_close_categories: settings.auto_close_categories || ['backlog', 'unstarted'],
  }), [workflow.id, settings.revision])
  if (!form) return null
  async function submit(event) {
    event.preventDefault(); setError(null)
    try { await update.mutateAsync({ workflowId: workflow.id, expected_revision: settings.revision, ...form }) } catch (mutationError) { setError(mutationError) }
  }
  return <form className="card space-y-4 p-4 sm:p-5" onSubmit={submit}>
    <div><p className="label">Triage and inactivity</p><h2 className="mt-1 text-lg font-semibold text-text-primary">Intake policy</h2><p className="mt-1 text-sm text-text-secondary">Enable the inbox, assign responsibility, and define previewable inactivity thresholds.</p></div>
    <ErrorNotice error={error} />
    <div className="grid gap-3 md:grid-cols-2"><label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3"><input type="checkbox" checked={form.enabled} onChange={event => setForm(current => ({ ...current, enabled: event.target.checked }))} />Enable Triage</label><label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3"><input type="checkbox" checked={form.require_priority} onChange={event => setForm(current => ({ ...current, require_priority: event.target.checked }))} />Require priority before accept</label><label><span className="label mb-1 block">Default accepted status</span><select className="input-field min-h-11 w-full" value={form.default_accept_status_id} onChange={event => setForm(current => ({ ...current, default_accept_status_id: event.target.value }))}>{workflow.statuses.filter(item => ['backlog', 'unstarted', 'started'].includes(item.category)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span className="label mb-1 block">Responsible principals</span><select multiple className="input-field min-h-24 w-full" value={form.responsible_member_ids} onChange={event => setForm(current => ({ ...current, responsible_member_ids: Array.from(event.target.selectedOptions).map(option => option.value) }))}>{members.filter(item => item.is_active).map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label><label><span className="label mb-1 block">Close after inactive days</span><input type="number" min="1" max="3650" className="input-field min-h-11 w-full" value={form.auto_close_days} onChange={event => setForm(current => ({ ...current, auto_close_days: event.target.value }))} placeholder="Disabled" /></label><label><span className="label mb-1 block">Archive terminal work after days</span><input type="number" min="1" max="3650" className="input-field min-h-11 w-full" value={form.auto_archive_days} onChange={event => setForm(current => ({ ...current, auto_archive_days: event.target.value }))} placeholder="Disabled" /></label></div>
    <div className="flex justify-end"><button className="btn-primary min-h-11" type="submit" disabled={update.isPending}>Save policy</button></div>
  </form>
}

function HierarchySettings({ workflow }) {
  const update = useUpdateWorkflow()
  const [form, setForm] = useState({ parent_auto_close: Boolean(workflow.parent_auto_close), sub_action_auto_close: Boolean(workflow.sub_action_auto_close) })
  const [error, setError] = useState(null)
  useEffect(() => setForm({ parent_auto_close: Boolean(workflow.parent_auto_close), sub_action_auto_close: Boolean(workflow.sub_action_auto_close) }), [workflow.id, workflow.revision])
  async function submit(event) {
    event.preventDefault(); setError(null)
    try { await update.mutateAsync({ id: workflow.id, expected_revision: workflow.revision, ...form }) } catch (mutationError) { setError(mutationError) }
  }
  return <form className="card space-y-4 p-4 sm:p-5" onSubmit={submit}><div><p className="label">Parent and sub-actions</p><h2 className="mt-1 text-lg font-semibold text-text-primary">Completion automation</h2><p className="mt-1 text-sm text-text-secondary">Owner-only and review-gated actions always remain protected.</p></div><ErrorNotice error={error} /><label className="flex min-h-12 items-center gap-3 rounded-lg border border-border px-3"><input type="checkbox" checked={form.parent_auto_close} onChange={event => setForm(current => ({ ...current, parent_auto_close: event.target.checked }))} /><span><span className="block text-sm text-text-primary">Close parent when all sub-actions resolve</span><span className="block text-xs text-text-muted">Direct children must all be terminal.</span></span></label><label className="flex min-h-12 items-center gap-3 rounded-lg border border-border px-3"><input type="checkbox" checked={form.sub_action_auto_close} onChange={event => setForm(current => ({ ...current, sub_action_auto_close: event.target.checked }))} /><span><span className="block text-sm text-text-primary">Close sub-actions with parent</span><span className="block text-xs text-text-muted">Eligible open direct children complete with the parent.</span></span></label><div className="flex justify-end"><button type="submit" className="btn-primary min-h-11" disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save completion policy'}</button></div></form>
}

function TriageQueue({ workflow, business, actions, onOpenAction }) {
  const [includeSnoozed, setIncludeSnoozed] = useState(false)
  const query = useTriage(business, includeSnoozed)
  const accept = useAcceptTriage(); const decline = useDeclineTriage(); const duplicate = useDuplicateTriage(); const snooze = useSnoozeTriage()
  const enter = useEnterTriage(); const [actionId, setActionId] = useState('')
  const [error, setError] = useState(null)
  async function act(mutation, payload) { setError(null); try { await mutation.mutateAsync(payload) } catch (mutationError) { setError(mutationError) } }
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="label">Special inbox</p><h2 className="mt-1 text-xl font-semibold text-text-primary">Triage queue</h2></div><label className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={includeSnoozed} onChange={event => setIncludeSnoozed(event.target.checked)} />Show snoozed</label></div><form className="card flex flex-col gap-2 p-3 sm:flex-row" onSubmit={async event => { event.preventDefault(); if (!actionId) return; await act(enter, { actionId, source_type: 'manual' }); setActionId('') }}><select aria-label="Action to add to Triage" className="input-field min-h-11 flex-1" value={actionId} onChange={event => setActionId(event.target.value)}><option value="">Select an action to add to Triage</option>{actions.filter(action => !(query.data?.entries || []).some(entry => entry.action_id === action.id)).map(action => <option key={action.id} value={action.id}>{action.title}</option>)}</select><button type="submit" className="btn-secondary min-h-11" disabled={!workflow.triage_settings?.enabled || enter.isPending}><Inbox className="mr-1 inline h-4 w-4" />Enter Triage</button></form><ErrorNotice error={error || (query.isError ? query.error : null)} />{query.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-bg-elevated" /> : <div className="space-y-3">{(query.data?.entries || []).map(entry => <article className="card p-4" key={entry.id}><div className="flex flex-col gap-3 md:flex-row md:items-start"><button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpenAction(entry.action_id)}><div className="flex flex-wrap items-center gap-2"><span className="badge border-border">{entry.source_type}</span>{entry.state === 'snoozed' && <span className="badge border-amber-400/30 text-amber-300">Snoozed</span>}<span className="badge border-border">{entry.action?.priority?.toUpperCase()}</span></div><h3 className="mt-2 font-semibold text-text-primary">{entry.action?.title || entry.action_id}</h3><p className="mt-1 line-clamp-2 text-sm text-text-secondary">{entry.action?.description || 'No description'}</p><p className="mt-2 text-xs text-text-muted">Entered {new Date(entry.created_at).toLocaleString()}</p></button><div className="flex flex-wrap gap-2"><button type="button" className="btn-primary min-h-10" onClick={() => act(accept, { actionId: entry.action_id, expected_revision: entry.revision, target_status_id: workflow.triage_settings?.default_accept_status_id })}><CheckCircle2 className="mr-1 inline h-4 w-4" />Accept</button><button type="button" className="btn-secondary min-h-10" onClick={() => act(snooze, { actionId: entry.action_id, expected_revision: entry.revision, snoozed_until: new Date(Date.now() + 86_400_000).toISOString() })}><Clock3 className="mr-1 inline h-4 w-4" />1 day</button><button type="button" className="btn-ghost min-h-10" onClick={() => { const id = window.prompt('Canonical action ID'); if (id) act(duplicate, { actionId: entry.action_id, expected_revision: entry.revision, canonical_action_id: id }) }}>Duplicate</button><button type="button" className="btn-ghost min-h-10 text-danger" onClick={() => { const reason = window.prompt('Reason for declining (optional)') || ''; act(decline, { actionId: entry.action_id, expected_revision: entry.revision, reason }) }}><XCircle className="mr-1 inline h-4 w-4" />Decline</button></div></div></article>)}{(query.data?.entries || []).length === 0 && <div className="rounded-xl border border-dashed border-border p-10 text-center"><Inbox className="mx-auto h-8 w-8 text-text-muted" /><p className="mt-3 text-sm text-text-secondary">Triage is clear.</p></div>}</div>}</div>
}

function RuleBuilder({ workflow, actions }) {
  const create = useCreateWorkflowRule(); const transition = useTransitionWorkflowRule(); const preview = usePreviewWorkflowRule()
  const [form, setForm] = useState({ name: '', trigger_type: 'triage_entered', mode: 'all', field: 'priority', operator: 'eq', condition_value: 'p1', effect_field: 'priority', effect_value: 'p1' })
  const [previewActionId, setPreviewActionId] = useState('')
  const [result, setResult] = useState(null); const [error, setError] = useState(null)
  function effectValue() { return ['owners', 'add_tags', 'remove_tags'].includes(form.effect_field) ? form.effect_value.split(',').map(item => item.trim()).filter(Boolean) : form.effect_value }
  async function submit(event) {
    event.preventDefault(); setError(null)
    const noValue = ['is_empty', 'not_empty'].includes(form.operator)
    try { await create.mutateAsync({ workflowId: workflow.id, name: form.name, trigger_type: form.trigger_type, position: workflow.rules.length, conditions: { mode: form.mode, items: [{ field: form.field, operator: form.operator, ...(noValue ? {} : { value: form.condition_value }) }] }, effects: { [form.effect_field]: effectValue() } }); setForm(current => ({ ...current, name: '' })) } catch (mutationError) { setError(mutationError) }
  }
  async function previewRule(rule) { if (!previewActionId) return setError(new Error('Select an action to preview.')); setError(null); try { setResult(await preview.mutateAsync({ workflowId: workflow.id, ruleId: rule.id, action_id: previewActionId })) } catch (mutationError) { setError(mutationError) } }
  return <div className="space-y-4"><section className="card space-y-4 p-4 sm:p-5"><div><p className="label">Deterministic automation</p><h2 className="mt-1 text-lg font-semibold text-text-primary">Ordered workflow rules</h2><p className="mt-1 text-sm text-text-secondary">Rules are created paused. Earlier scalar changes win and conflicts are retained in receipts.</p></div><ErrorNotice error={error} /><div className="grid gap-2 md:grid-cols-[1fr_auto]"><select aria-label="Action for rule preview" className="input-field min-h-11" value={previewActionId} onChange={event => setPreviewActionId(event.target.value)}><option value="">Select an action for previews</option>{actions.map(action => <option key={action.id} value={action.id}>{action.title}</option>)}</select>{result && <button type="button" className="btn-secondary min-h-11" onClick={() => setResult(null)}>Clear preview</button>}</div>{result && <pre className="max-h-72 overflow-auto rounded-lg bg-bg-elevated p-3 text-xs text-text-secondary">{JSON.stringify(result.run || result, null, 2)}</pre>}<div className="space-y-2">{(workflow.rules || []).map(rule => <article key={rule.id} className="flex flex-col gap-3 rounded-xl border border-border p-3 md:flex-row md:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-text-primary">{rule.name}</h3><span className={`badge ${rule.enabled ? 'border-emerald-400/30 text-emerald-300' : 'border-border text-text-muted'}`}>{rule.enabled ? 'Active' : 'Paused'}</span></div><p className="mt-1 text-xs text-text-muted">{rule.trigger_type.replaceAll('_', ' ')} · {rule.conditions?.mode || 'all'} · position {rule.position}</p></div><div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary min-h-10" onClick={() => previewRule(rule)}><Sparkles className="mr-1 inline h-4 w-4" />Preview</button><button type="button" className="btn-secondary min-h-10" onClick={() => transition.mutate({ workflowId: workflow.id, ruleId: rule.id, transition: rule.enabled ? 'deactivate' : 'activate', expected_revision: rule.revision })}>{rule.enabled ? <PauseCircle className="mr-1 inline h-4 w-4" /> : <PlayCircle className="mr-1 inline h-4 w-4" />}{rule.enabled ? 'Pause' : 'Activate'}</button><button type="button" className="btn-ghost min-h-10 text-danger" onClick={() => window.confirm(`Archive ${rule.name}?`) && transition.mutate({ workflowId: workflow.id, ruleId: rule.id, transition: 'archive', expected_revision: rule.revision })}>Archive</button></div></article>)}</div></section><form className="card space-y-3 p-4 sm:p-5" onSubmit={submit}><div><p className="label">New rule</p><h2 className="mt-1 text-lg font-semibold text-text-primary">Build one condition and one safe effect</h2></div><div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"><label className="lg:col-span-2"><span className="label mb-1 block">Name</span><input required className="input-field min-h-11 w-full" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label><label><span className="label mb-1 block">Trigger</span><select className="input-field min-h-11 w-full" value={form.trigger_type} onChange={event => setForm(current => ({ ...current, trigger_type: event.target.value }))}>{TRIGGERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label><span className="label mb-1 block">Match</span><select className="input-field min-h-11 w-full" value={form.mode} onChange={event => setForm(current => ({ ...current, mode: event.target.value }))}><option value="all">All conditions</option><option value="any">Any condition</option></select></label><label><span className="label mb-1 block">Condition field</span><select className="input-field min-h-11 w-full" value={form.field} onChange={event => setForm(current => ({ ...current, field: event.target.value }))}>{CONDITION_FIELDS.map(item => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><label><span className="label mb-1 block">Operator</span><select className="input-field min-h-11 w-full" value={form.operator} onChange={event => setForm(current => ({ ...current, operator: event.target.value }))}>{OPERATORS.map(item => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><label><span className="label mb-1 block">Condition value</span><input disabled={['is_empty', 'not_empty'].includes(form.operator)} className="input-field min-h-11 w-full" value={form.condition_value} onChange={event => setForm(current => ({ ...current, condition_value: event.target.value }))} /></label><label><span className="label mb-1 block">Effect</span><select className="input-field min-h-11 w-full" value={form.effect_field} onChange={event => setForm(current => ({ ...current, effect_field: event.target.value, effect_value: '' }))}><option value="priority">Set priority</option><option value="workflow_status_id">Set workflow status</option><option value="owners">Set owners</option><option value="add_tags">Add labels</option><option value="remove_tags">Remove labels</option><option value="project_id">Set project</option><option value="work_mode">Set work mode</option></select></label></div><label><span className="label mb-1 block">Effect value</span>{form.effect_field === 'workflow_status_id' ? <select className="input-field min-h-11 w-full" value={form.effect_value} onChange={event => setForm(current => ({ ...current, effect_value: event.target.value }))}><option value="">Select status</option>{workflow.statuses.filter(item => ['triage', 'backlog', 'unstarted', 'started'].includes(item.category)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <input required className="input-field min-h-11 w-full" value={form.effect_value} onChange={event => setForm(current => ({ ...current, effect_value: event.target.value }))} placeholder={['owners', 'add_tags', 'remove_tags'].includes(form.effect_field) ? 'Comma-separated values' : ''} />}</label><div className="flex justify-end"><button type="submit" className="btn-primary min-h-11" disabled={create.isPending}><Plus className="mr-1 inline h-4 w-4" />Create paused rule</button></div></form></div>
}

function InactivityPanel({ workflow }) {
  const preview = usePreviewInactivity(); const apply = useApplyInactivity(); const [result, setResult] = useState(null); const [error, setError] = useState(null)
  async function run(mutation, applying) { setError(null); try { const next = await mutation.mutateAsync({ workflowId: workflow.id, ...(applying ? { run_key: `owner-apply:${workflow.id}:${new Date().toISOString()}` } : {}) }); setResult(next) } catch (mutationError) { setError(mutationError) } }
  const candidates = result?.candidates || { close: [], archive: [], skipped: [] }
  return <section className="card space-y-4 p-4 sm:p-5"><div className="flex items-start justify-between"><div><p className="label">Owner-triggered maintenance</p><h2 className="mt-1 text-lg font-semibold text-text-primary">Inactivity policy</h2><p className="mt-1 text-sm text-text-secondary">Preview first. Applying writes evidence and never completes an action.</p></div><Settings2 className="h-5 w-5 text-accent" /></div><ErrorNotice error={error} /><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg border border-border p-3"><p className="label">Close</p><p className="mt-1 text-2xl font-semibold text-text-primary">{candidates.close?.length || 0}</p></div><div className="rounded-lg border border-border p-3"><p className="label">Archive</p><p className="mt-1 text-2xl font-semibold text-text-primary">{candidates.archive?.length || 0}</p></div><div className="rounded-lg border border-border p-3"><p className="label">Protected</p><p className="mt-1 text-2xl font-semibold text-text-primary">{candidates.skipped?.length || 0}</p></div></div><div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn-secondary min-h-11" onClick={() => run(preview, false)} disabled={preview.isPending}><RefreshCcw className="mr-1 inline h-4 w-4" />Preview</button><button type="button" className="btn-primary min-h-11" onClick={() => window.confirm('Apply the currently configured inactivity policy?') && run(apply, true)} disabled={!result || apply.isPending}>Apply verified candidates</button></div></section>
}

export default function WorkflowsPage({ selectedBusiness, onOpenAction = () => {} }) {
  const [tab, setTab] = useState('workflow')
  const workflowQuery = useWorkflow(selectedBusiness || '')
  const { data: members = [] } = useMembers()
  const { data: actions = [] } = useActions({ business: selectedBusiness || undefined, include_triage: 'true', limit: 200, sort_by: 'updated_at', sort_dir: 'desc' })
  const workflow = workflowQuery.data?.workflow
  if (workflowQuery.isLoading) return <div className="mx-auto max-w-7xl space-y-3">{[1, 2, 3].map(item => <div key={item} className="h-28 animate-pulse rounded-xl bg-bg-elevated" />)}</div>
  if (workflowQuery.isError) return <div className="mx-auto max-w-7xl"><ErrorNotice error={workflowQuery.error} /></div>
  if (!workflow) return <div className="mx-auto max-w-7xl rounded-xl border border-dashed border-border p-10 text-center"><GitBranch className="mx-auto h-8 w-8 text-text-muted" /><h1 className="mt-3 text-xl font-semibold text-text-primary">No workflow for this business</h1><p className="mt-2 text-sm text-text-secondary">Select a configured business lane or create its workflow through the API.</p></div>
  const tabs = [['workflow', 'Workflow'], ['triage', `Triage ${workflow.pending_triage_count ? `(${workflow.pending_triage_count})` : ''}`], ['rules', 'Rules'], ['inactivity', 'Inactivity']]
  return <div className="mx-auto max-w-7xl space-y-5"><header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><div><p className="label">{workflow.business || 'Workspace'} configuration</p><h1 className="mt-1 text-2xl font-semibold text-text-primary">{workflow.name}</h1><p className="mt-1 text-sm text-text-secondary">Custom statuses, intake decisions, deterministic rules, and safe maintenance.</p></div><div className="flex flex-wrap gap-1 rounded-xl border border-border bg-bg-surface p-1" role="tablist">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={`min-h-10 rounded-lg px-3 text-sm ${tab === id ? 'bg-accent text-black' : 'text-text-secondary hover:bg-bg-elevated'}`} onClick={() => setTab(id)}>{label}</button>)}</div></header>{tab === 'workflow' && <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]"><StatusEditor workflow={workflow} /><div className="space-y-5"><HierarchySettings workflow={workflow} /><TriageSettings workflow={workflow} members={members} /></div></div>}{tab === 'triage' && <TriageQueue workflow={workflow} business={selectedBusiness || ''} actions={actions} onOpenAction={onOpenAction} />}{tab === 'rules' && <RuleBuilder workflow={workflow} actions={actions} />}{tab === 'inactivity' && <div className="grid gap-5 xl:grid-cols-[1fr_1fr]"><TriageSettings workflow={workflow} members={members} /><InactivityPanel workflow={workflow} /></div>}</div>
}
