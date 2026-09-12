import React, { useState, useEffect, useId, useRef } from 'react'
import {
  X, Archive, ArchiveRestore, FileText, ChevronDown,
  Save, Activity, CheckCircle2, ClipboardCheck, Bot,
} from 'lucide-react'
import { useAction, useUpdateAction, useArchiveAction, useRestoreAction, useCompleteAction, useCreateAgentAssignment } from '../hooks/useActions.js'
import { useMembers } from '../hooks/useMembers.js'
import { useQuery } from '@tanstack/react-query'
import { activityApi } from '../api/client.js'
import MemberSelector from './MemberSelector.jsx'
import { PRIORITIES, STATUS_LIST, PRIORITY_LIST, RECURRENCE_LIST, WORK_MODES, WORK_MODE_LIST, APPROVAL_STATE_LIST, canonicalStatus } from '../utils/constants.js'
import { PRIORITY_COLORS } from '../utils/colors.js'
import { useBusinessContext } from '../hooks/useBusinesses.js'
import { formatTimestamp } from '../utils/dateUtils.js'
import { parseJsonArray, parseJsonObject } from '../utils/parseUtils.js'
import { normalizeMemberRefs } from '../utils/memberUtils.js'
import { evidenceFromText } from '../utils/evidenceUtils.js'
import { WorkModeBadge } from './StatusBadge.jsx'
import ActionStructureSection from './ActionStructureSection.jsx'
import DiscussionThread from './LazyDiscussionThread.jsx'
import { useEstimateSettings } from '../hooks/useEstimateSettings.js'
import ActionCycleControl from './ActionCycleControl.jsx'
import { useWorkflow } from '../hooks/useWorkflows.js'

function evidencePresentation(value) {
  const evidence = parseJsonObject(value)
  if (Object.keys(evidence).length === 0) return null
  return {
    kind: evidence.kind || (evidence.manual_completion ? 'manual_attestation' : 'legacy_unverified'),
    summary: evidence.summary
      || evidence.completion_note?.note
      || evidence.manual_completion?.note
      || 'Structured evidence is attached. Open audit details to inspect it.',
  }
}

function Select({ label, value, onChange, options }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="label block mb-1.5">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          className="input-field w-full appearance-none pr-8 text-sm"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
        >
          <option value="">-- None --</option>
          {options.map(o => (
            <option key={o.id} value={o.id} disabled={o.disabled}>{o.label}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
      </div>
    </div>
  )
}

export default function ActionDetail({ actionId, onClose, onSelectAction = () => {} }) {
  const { BUSINESSES, BUSINESS_LIST, BUSINESS_COLORS } = useBusinessContext()
  const { data: action, isLoading, isError, error } = useAction(actionId)
  const { data: members = [] } = useMembers()
  const updateAction = useUpdateAction()
  const archiveAction = useArchiveAction()
  const restoreAction = useRestoreAction()
  const completeAction = useCompleteAction()
  const createAgentAssignment = useCreateAgentAssignment()
  const { data: estimateSettings } = useEstimateSettings()
  const { data: workflowData } = useWorkflow(action?.business)

  const { data: activityLog = [] } = useQuery({
    queryKey: ['activity', actionId],
    queryFn: () => activityApi.get(actionId),
    enabled: !!actionId,
  })

  const [form, setForm] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [completionNote, setCompletionNote] = useState('')
  const [saveError, setSaveError] = useState('')
  const panelRef = useRef(null)

  function formatEvidence(value) {
    const obj = parseJsonObject(value)
    return Object.keys(obj).length ? JSON.stringify(obj, null, 2) : ''
  }

  useEffect(() => {
    if (action && !dirty) {
      setForm({
        title: action.title || '',
        description: action.description || '',
        status: action.status === 'archived' ? 'archived' : (canonicalStatus(action.status) || 'not_started'),
        workflow_status_id: action.workflow_status_id || '',
        priority: action.priority || 'p2',
        business: action.business || '',
        due_date: action.due_date || '',
        owners: normalizeMemberRefs(parseJsonArray(action.owners)).map(owner => owner.id),
        tags: parseJsonArray(action.tags),
        notes: action.notes || '',
        source_label: action.source_label || '',
        recurrence: action.recurrence || 'none',
        work_mode: action.work_mode || '',
        next_action: action.next_action || '',
        definition_of_done: action.definition_of_done || '',
        review_date: action.review_date || '',
        approval_state: action.approval_state || 'not_required',
        agent_assignment_id: action.agent_assignment_id || '',
        evidence_text: formatEvidence(action.evidence_json),
        estimate_points: action.estimate_points ?? '',
      })
    }
  }, [action, dirty])

  function patch(key, val) {
    setForm(prev => ({ ...prev, [key]: val }))
    setDirty(true)
  }

  function buildPayload(overrides = {}) {
    const payload = { ...form, ...overrides }
    if (payload.due_date === '') payload.due_date = null
    if (payload.source_label === '') payload.source_label = null
    if (payload.business === '') payload.business = null
    if (payload.work_mode === '') payload.work_mode = null
    if (payload.review_date === '') payload.review_date = null
    if (payload.agent_assignment_id === '') payload.agent_assignment_id = null
    if (!payload.approval_state) payload.approval_state = 'not_required'
    payload.estimate_points = payload.estimate_points === '' ? null : Number(payload.estimate_points)

    try {
      payload.evidence_json = evidenceFromText(payload.evidence_text || '', 'atlas_action_detail')
    } catch {
      throw new Error('Completion evidence must be plain text or a JSON object.')
    }
    delete payload.evidence_text
    return payload
  }

  async function savePayload(overrides = {}, keepDirty = false) {
    setSaving(true)
    setSaveError('')
    try {
      const payload = buildPayload(overrides)
      const saved = await updateAction.mutateAsync({ id: actionId, ...payload })
      setForm(prev => ({ ...prev, ...overrides }))
      if (!keepDirty) setDirty(false)
      return saved
    } catch (err) {
      setSaveError(err?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    if (!form || !dirty) return
    await savePayload()
  }

  async function handleNeedsReviewPacket() {
    await savePayload({
      approval_state: 'needs_review',
      status: form.status === 'done' ? form.status : 'waiting',
      next_action: form.next_action || 'Prepare review packet in PEOS.',
    })
  }

  async function handleComplete() {
    const summary = completionNote.trim()
    if (!summary) {
      setSaveError('Enter a completion note before marking this action done.')
      return
    }

    setSaving(true)
    setSaveError('')
    try {
      const expectedRevision = Number.isInteger(action.revision) ? action.revision : null
      await completeAction.mutateAsync({
        id: actionId,
        ...(expectedRevision ? { expected_revision: expectedRevision } : {}),
        evidence: {
          version: 2,
          kind: 'manual_attestation',
          summary,
          sources: [],
          verification: { status: 'attested' },
        },
      })
      setCompletionNote('')
      setDirty(false)
    } catch (err) {
      setSaveError(err?.message || 'Failed to complete action')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateAgentAssignment() {
    setSaveError('')
    try {
      if (dirty) await savePayload({}, true)
      const assignment = await createAgentAssignment.mutateAsync(actionId)
      setForm(prev => ({
        ...prev,
        agent_assignment_id: assignment.id,
        approval_state: prev.work_mode === 'autonomous' ? 'not_required' : 'needs_review',
      }))
      setDirty(false)
    } catch (err) {
      setSaveError(err?.message || 'Failed to create assignment')
    }
  }

  async function handleArchive() {
    setSaveError('')
    try {
      const expectedRevision = Number.isInteger(action.revision) ? action.revision : null
      await archiveAction.mutateAsync({
        id: actionId,
        ...(expectedRevision ? { expected_revision: expectedRevision } : {}),
      })
      onClose()
    } catch (err) {
      setSaveError(err?.message || 'Failed to archive action')
    }
  }

  async function handleRestore() {
    setSaveError('')
    try {
      const expectedRevision = Number.isInteger(action.revision) ? action.revision : null
      await restoreAction.mutateAsync({
        id: actionId,
        ...(expectedRevision ? { expected_revision: expectedRevision } : {}),
      })
      onClose()
    } catch (err) {
      setSaveError(err?.message || 'Failed to restore action')
    }
  }

  function requestClose() {
    if (!dirty || window.confirm('Discard your unsaved changes?')) onClose()
  }

  function selectStructuredAction(nextActionId) {
    if (dirty && !window.confirm('Discard unsaved changes and open the related action?')) return
    setDirty(false)
    onSelectAction(nextActionId)
  }

  function handleTagAdd(e) {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
      e.preventDefault()
      const tag = tagInput.trim().replace(/^#/, '')
      if (!form.tags.includes(tag)) {
        patch('tags', [...form.tags, tag])
      }
      setTagInput('')
    }
  }

  function handleTagRemove(tag) {
    patch('tags', form.tags.filter(t => t !== tag))
  }

  // Focus trap
  useEffect(() => {
    const previousFocus = document.activeElement
    const panel = panelRef.current
    if (panel) {
      panel.focus()

      function trapFocus(e) {
        if (e.key !== 'Tab') return
        const focusable = panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }

      panel.addEventListener('keydown', trapFocus)
      return () => {
        panel.removeEventListener('keydown', trapFocus)
        if (previousFocus && previousFocus.focus) previousFocus.focus()
      }
    }
  }, [])

  if (isError) {
    return (
      <div className="fixed inset-0 z-40 flex items-stretch" role="dialog" aria-modal="true" aria-label="Action details unavailable">
        <button type="button" className="flex-1 bg-black/60" aria-label="Close action details" onClick={onClose} />
        <div className="w-full md:w-[520px] border-l border-white/10 bg-bg-surface p-6">
          <div className="rounded-xl border border-danger/30 bg-danger/10 p-5 text-sm text-danger" role="alert">
            {error?.message || 'Action details could not be loaded.'}
          </div>
        </div>
      </div>
    )
  }

  if (isLoading || !form) {
    return (
      <div className="fixed inset-0 z-40 flex items-stretch pointer-events-none">
        <div className="flex-1 hidden md:block" />
        <div
          className="w-full md:w-[520px] h-full border-l border-white/10 flex flex-col pointer-events-auto glass-panel"
        >
          <div className="p-6 animate-pulse space-y-4">
            <div className="h-6 bg-bg-elevated rounded w-3/4" />
            <div className="h-4 bg-bg-elevated rounded w-1/2" />
            <div className="h-24 bg-bg-elevated rounded" />
          </div>
        </div>
      </div>
    )
  }

  const priorityColor = PRIORITY_COLORS[form.priority]
  const businessColor = BUSINESS_COLORS[form.business]
  const existingEvidence = evidencePresentation(action.evidence_json)
  const isArchived = action.status === 'archived'
  const configuredStatuses = workflowData?.workflow?.statuses || []
  const statusOptions = configuredStatuses.length
    ? configuredStatuses
      .filter(option => ['triage', 'backlog', 'unstarted', 'started'].includes(option.category) || option.id === form.workflow_status_id)
      .map(option => ({ id: option.id, label: option.name, disabled: ['completed', 'canceled', 'duplicate'].includes(option.category) }))
    : STATUS_LIST
      .filter(option => !['done', 'cancelled', 'unknown'].includes(option.id))
      .map(option => ({ ...option }))

  return (
    <div
      className="fixed inset-0 z-40 flex items-stretch"
      role="dialog"
      aria-modal="true"
      aria-label="Action details"
    >
      {/* Dim overlay */}
      <button type="button" className="flex-1 bg-black/60 backdrop-blur-sm" aria-label="Close action details" onClick={requestClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full md:w-[520px] h-full border-l border-white/10 flex flex-col overflow-hidden bg-bg-surface"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2">
            {action.identifier && (
              <span className="font-mono text-[10px] text-text-muted">{action.identifier}</span>
            )}
            {form.priority && (
              <span
                className="badge"
                style={{ backgroundColor: `${priorityColor}15`, color: priorityColor, borderColor: `${priorityColor}30` }}
              >
                {PRIORITIES[form.priority]?.shortLabel}
              </span>
            )}
            {form.business && businessColor && (
              <span
                className="badge"
                style={{ backgroundColor: `${businessColor}12`, color: businessColor, borderColor: `${businessColor}25` }}
              >
                {BUSINESSES[form.business]?.shortLabel}
              </span>
            )}
            <WorkModeBadge workMode={form.work_mode} />
            {action.template_id && <span className="badge border-accent/30 text-accent" title={action.template_instance_id || action.template_id}>Template</span>}
          </div>
          <div className="flex items-center gap-2">
            {saveError && (
              <span role="alert" className="text-danger text-xs max-w-[240px] truncate" title={saveError}>
                {saveError}
              </span>
            )}
            {dirty && (
              <button
                type="button"
                className="btn-primary flex items-center gap-1.5 text-xs py-1.5"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : 'Save'}
              </button>
            )}
            {isArchived ? (
              <button
                type="button"
                className="btn-ghost p-1.5 text-text-muted hover:text-accent"
                onClick={handleRestore}
                disabled={restoreAction.isPending}
                aria-label="Restore action"
                title="Restore action"
              >
                <ArchiveRestore className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                className="btn-ghost p-1.5 text-text-muted hover:text-accent"
                onClick={handleArchive}
                disabled={dirty || archiveAction.isPending}
                aria-label="Archive action"
                title={dirty ? 'Save or discard changes before archiving' : 'Archive action'}
              >
                <Archive className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              className="btn-ghost p-1.5 text-text-muted hover:text-text-primary"
              onClick={requestClose}
              aria-label="Close action details"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {/* Title */}
          <div>
            <textarea
              aria-label="Action title"
              className="input-field w-full text-base font-headline font-semibold text-text-primary resize-none"
              rows={2}
              value={form.title}
              onChange={e => patch('title', e.target.value)}
              placeholder="Action title..."
            />
          </div>

          {/* Status + Priority row */}
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Status"
              value={configuredStatuses.length ? form.workflow_status_id : form.status}
              onChange={val => configuredStatuses.length ? patch('workflow_status_id', val) : patch('status', val)}
              options={statusOptions}
            />
            <Select
              label="Priority"
              value={form.priority}
              onChange={val => patch('priority', val)}
              options={PRIORITY_LIST.map(p => ({ id: p.id, label: p.label }))}
            />
          </div>

          {estimateSettings?.enabled && (
            <Select
              label="Estimate"
              value={form.estimate_points === '' ? '' : String(form.estimate_points)}
              onChange={val => patch('estimate_points', val === '' ? '' : Number(val))}
              options={(estimateSettings.options || []).map(option => ({ id: String(option.value), label: option.label }))}
            />
          )}

          <ActionCycleControl action={action} isArchived={isArchived} />

          {/* Business + Due date */}
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Business"
              value={form.business}
              onChange={val => patch('business', val)}
              options={BUSINESS_LIST.map(b => ({ id: b.id, label: b.label }))}
            />
            <div>
              <label className="label block mb-1.5">
                Due Date
              </label>
              <input
                type="date"
                aria-label="Due date"
                className="input-field w-full text-sm"
                value={form.due_date || ''}
                onChange={e => patch('due_date', e.target.value)}
              />
            </div>
          </div>

          {/* Recurrence */}
          <div className="grid grid-cols-1 gap-3">
            <Select
              label="Recurrence"
              value={form.recurrence}
              onChange={val => patch('recurrence', val || 'none')}
              options={RECURRENCE_LIST}
            />
            <div>
              <Select
                label="Work Mode"
                value={form.work_mode}
                onChange={val => patch('work_mode', val)}
                options={WORK_MODE_LIST}
              />
              {form.work_mode && (
                <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
                  {WORK_MODES[form.work_mode]?.description}
                </p>
              )}
            </div>
          </div>

          <ActionStructureSection action={action} isArchived={isArchived} onSelectAction={selectStructuredAction} />

          {/* Protocol contract */}
          <div className="pt-4 border-t border-white/10 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="label">Execution Contract</p>
                <p className="mt-1 text-xs text-text-muted">Next action, review gate, and proof before completion.</p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  className="btn-ghost flex items-center gap-1.5 text-xs py-1.5"
                  onClick={handleCreateAgentAssignment}
                  disabled={saving || createAgentAssignment.isPending || !!form.agent_assignment_id}
                  title="Create a linked PEOS agent assignment"
                >
                  <Bot className="w-3.5 h-3.5" />
                  Create Agent Assignment
                </button>
                <button
                  className="btn-ghost flex items-center gap-1.5 text-xs py-1.5"
                  onClick={handleNeedsReviewPacket}
                  disabled={saving}
                  title="Flag this action for a PEOS review packet"
                >
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  Needs Review Packet
                </button>
                <button
                  className="btn-primary flex items-center gap-1.5 text-xs py-1.5"
                  onClick={handleComplete}
                  disabled={saving || isArchived || dirty || action.resolution === 'duplicate'}
                  title={dirty ? 'Save or discard changes before completing' : 'Mark done with the completion note entered below'}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Mark Done
                </button>
              </div>
            </div>

            <div>
              <label className="label block mb-1.5">
                Next Action
              </label>
              <textarea
                aria-label="Next action"
                className="input-field w-full text-sm resize-none"
                rows={2}
                value={form.next_action}
                onChange={e => patch('next_action', e.target.value)}
                placeholder="The next concrete step..."
              />
            </div>

            <div>
              <label className="label block mb-1.5">
                Definition of Done
              </label>
              <textarea
                aria-label="Definition of done"
                className="input-field w-full text-sm resize-none"
                rows={3}
                value={form.definition_of_done}
                onChange={e => patch('definition_of_done', e.target.value)}
                placeholder="The evidence and outcome needed before this can close..."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label block mb-1.5">
                  Review Date
                </label>
                <input
                  type="date"
                  aria-label="Review date"
                  className="input-field w-full text-sm"
                  value={form.review_date || ''}
                  onChange={e => patch('review_date', e.target.value)}
                />
              </div>
              <Select
                label="Approval"
                value={form.approval_state}
                onChange={val => patch('approval_state', val || 'not_required')}
                options={APPROVAL_STATE_LIST}
              />
            </div>

            <div>
              <label className="label block mb-1.5">
                Agent Assignment
              </label>
              <input
                type="text"
                aria-label="Agent assignment ID"
                className="input-field w-full text-sm font-mono"
                value={form.agent_assignment_id || ''}
                onChange={e => patch('agent_assignment_id', e.target.value)}
                placeholder="Linked assignment id"
              />
            </div>

            <div>
              <label className="label block mb-1.5">
                Completion Note
              </label>
              <textarea
                aria-label="Completion note"
                className="input-field w-full text-sm resize-none"
                rows={3}
                value={completionNote}
                onChange={e => setCompletionNote(e.target.value)}
                placeholder="Required before manual completion: describe what was completed and how you know."
              />
            </div>

            {existingEvidence && (
              <div className="rounded-xl border border-border bg-bg-surface p-3" aria-label="Existing completion evidence">
                <span className="badge border-border text-text-secondary">{existingEvidence.kind.replace(/_/g, ' ')}</span>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{existingEvidence.summary}</p>
              </div>
            )}

            <details className="rounded-xl border border-border bg-bg-surface p-3">
              <summary className="cursor-pointer text-xs font-semibold text-text-secondary">Audit evidence details</summary>
              <textarea
                aria-label="Evidence details"
                className="input-field mt-3 w-full text-sm resize-none"
                rows={6}
                value={form.evidence_text}
                onChange={e => patch('evidence_text', e.target.value)}
                placeholder="Proof links, deploy URLs, test results, or structured evidence..."
              />
            </details>
          </div>

          {/* Owners */}
          <div>
            <label className="label block mb-1.5">
              Owners
            </label>
            <MemberSelector
              members={members}
              selectedIds={form.owners}
              onChange={ids => patch('owners', ids)}
            />
          </div>

          {/* Description */}
          <div>
            <label className="label block mb-1.5">
              Description
            </label>
            <textarea
              aria-label="Action description"
              className="input-field w-full text-sm resize-none"
              rows={3}
              value={form.description}
              onChange={e => patch('description', e.target.value)}
              placeholder="What needs to happen and why..."
            />
          </div>

          {/* Notes */}
          <div>
            <label className="label block mb-1.5">
              Notes
            </label>
            <textarea
              aria-label="Action notes"
              className="input-field w-full text-sm resize-none"
              rows={3}
              value={form.notes}
              onChange={e => patch('notes', e.target.value)}
              placeholder="Additional context, blockers, links..."
            />
          </div>

          {/* Tags */}
          <div>
            <label className="label block mb-1.5">
              Tags
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.tags.map(tag => (
                <span
                  key={tag}
                  className="flex items-center gap-1 rounded-full border px-3 py-1"
                  style={{
                    fontSize: '10px',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    backgroundColor: 'rgba(75,226,119,0.1)',
                    color: '#f4b860',
                    borderColor: 'rgba(75,226,119,0.2)',
                  }}
                >
                  #{tag}
                  <button
                    type="button"
                    onClick={() => handleTagRemove(tag)}
                    className="hover:opacity-70 ml-0.5"
                    aria-label={`Remove tag ${tag}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <input
              type="text"
              aria-label="Add tag"
              className="input-field w-full text-sm"
              placeholder="Add tag -- press Enter or comma"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={handleTagAdd}
            />
          </div>

          {/* Source label */}
          {(form.source_label || action?.source_transcript_id) && (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <FileText className="w-3.5 h-3.5" />
              <span>
                Source: {form.source_label || 'Transcript'}
              </span>
            </div>
          )}

          {(action.releases || []).length > 0 && (
            <div>
              <p className="label mb-2">Delivery</p>
              <div className="space-y-2">{action.releases.map(item => <div key={item.id} className="rounded-lg border border-border bg-bg-elevated p-3"><p className="text-sm font-semibold text-text-primary">{item.release?.name || 'Release'}{item.release?.version ? ` · ${item.release.version}` : ''}</p><p className="mt-1 text-xs text-text-muted">{item.pipeline?.name || 'Pipeline'} · {item.stage?.environment || item.stage?.name || 'Unstaged'} · {item.release?.status || 'unknown'}</p>{item.release?.commit_sha && <p className="mt-1 truncate font-mono text-[10px] text-text-muted">{item.release.commit_sha}</p>}</div>)}</div>
            </div>
          )}

          {/* Metadata */}
          <div className="pt-2 border-t border-white/10 space-y-1">
            {action?.created_at && (
              <p className="text-xs text-text-muted font-mono">
                Created {formatTimestamp(action.created_at)}
              </p>
            )}
            {action?.updated_at && (
              <p className="text-xs text-text-muted font-mono">
                Updated {formatTimestamp(action.updated_at)}
              </p>
            )}
            {action?.completed_at && (
              <p className="text-xs text-text-muted font-mono">
                Completed {formatTimestamp(action.completed_at)}
              </p>
            )}
          </div>

          {/* Activity Log */}
          {activityLog.length > 0 && (
            <div>
              <p className="label mb-2 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                Activity
              </p>
              <div className="space-y-2">
                {activityLog.slice(0, 10).map(entry => (
                  <div key={entry.id} className="flex gap-2 text-xs text-text-muted">
                    <span className="font-mono text-[10px] whitespace-nowrap flex-shrink-0">
                      {formatTimestamp(entry.created_at)}
                    </span>
                    <span className="text-text-secondary">{entry.event}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DiscussionThread targetType="action" targetId={action.id} compact />
        </div>

      </div>
    </div>
  )
}
