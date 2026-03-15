import React, { useState, useEffect, useRef } from 'react'
import {
  X, Trash2, FileText, ChevronDown,
  AlertCircle, Save, Activity,
} from 'lucide-react'
import { useAction, useUpdateAction, useDeleteAction } from '../hooks/useActions.js'
import { useMembers } from '../hooks/useMembers.js'
import { useQuery } from '@tanstack/react-query'
import { activityApi } from '../api/client.js'
import MemberSelector from './MemberSelector.jsx'
import { PRIORITIES, STATUS_LIST, PRIORITY_LIST } from '../utils/constants.js'
import { PRIORITY_COLORS } from '../utils/colors.js'
import { useBusinessContext } from '../hooks/useBusinesses.js'
import { formatTimestamp } from '../utils/dateUtils.js'
import { parseJsonArray } from '../utils/parseUtils.js'

function Select({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-1.5">
        {label}
      </label>
      <div className="relative">
        <select
          className="input-field w-full appearance-none pr-8 text-sm"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
        >
          <option value="">— None —</option>
          {options.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
      </div>
    </div>
  )
}

export default function ActionDetail({ actionId, onClose }) {
  const { BUSINESSES, BUSINESS_LIST, BUSINESS_COLORS } = useBusinessContext()
  const { data: action, isLoading } = useAction(actionId)
  const { data: members = [] } = useMembers()
  const updateAction = useUpdateAction()
  const deleteAction = useDeleteAction()

  const { data: activityLog = [] } = useQuery({
    queryKey: ['activity', actionId],
    queryFn: () => activityApi.get(actionId),
    enabled: !!actionId,
  })

  const [form, setForm] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const panelRef = useRef(null)

  useEffect(() => {
    if (action && !dirty) {
      setForm({
        title: action.title || '',
        description: action.description || '',
        status: action.status || 'not_started',
        priority: action.priority || 'p2',
        business: action.business || '',
        due_date: action.due_date || '',
        owners: parseJsonArray(action.owners),
        tags: parseJsonArray(action.tags),
        notes: action.notes || '',
        source_label: action.source_label || '',
      })
    }
  }, [action, dirty])

  function patch(key, val) {
    setForm(prev => ({ ...prev, [key]: val }))
    setDirty(true)
  }

  async function handleSave() {
    if (!form || !dirty) return
    setSaving(true)
    try {
      await updateAction.mutateAsync({ id: actionId, ...form })
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    await deleteAction.mutateAsync(actionId)
    onClose()
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

  // Close on backdrop click
  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  if (isLoading || !form) {
    return (
      <div className="fixed inset-0 z-40 flex items-stretch pointer-events-none">
        <div className="flex-1 hidden md:block" />
        <div
          className="w-full md:w-[520px] h-full border-l border-border flex flex-col pointer-events-auto bg-bg-surface"
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

  return (
    <div
      className="fixed inset-0 z-40 flex items-stretch"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Action details"
    >
      {/* Dim overlay */}
      <div className="flex-1 bg-black/50" />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full md:w-[520px] h-full border-l border-border flex flex-col overflow-hidden bg-bg-surface"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            {form.priority && (
              <span
                className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                style={{ backgroundColor: `${priorityColor}20`, color: priorityColor }}
              >
                {PRIORITIES[form.priority]?.shortLabel}
              </span>
            )}
            {form.business && businessColor && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ backgroundColor: `${businessColor}15`, color: businessColor }}
              >
                {BUSINESSES[form.business]?.shortLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <button
                className="btn-primary flex items-center gap-1.5 text-xs py-1.5"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            <button
              className="btn-ghost p-1.5 text-text-muted hover:text-red-400"
              onClick={() => setShowDeleteConfirm(true)}
              title="Delete action"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              className="btn-ghost p-1.5 text-text-muted hover:text-text-primary"
              onClick={onClose}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Title */}
          <div>
            <textarea
              className="input-field w-full text-base font-semibold text-text-primary resize-none"
              rows={2}
              value={form.title}
              onChange={e => patch('title', e.target.value)}
              placeholder="Action title…"
            />
          </div>

          {/* Status + Priority row */}
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Status"
              value={form.status}
              onChange={val => patch('status', val)}
              options={STATUS_LIST}
            />
            <Select
              label="Priority"
              value={form.priority}
              onChange={val => patch('priority', val)}
              options={PRIORITY_LIST.map(p => ({ id: p.id, label: p.label }))}
            />
          </div>

          {/* Business + Due date */}
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Business"
              value={form.business}
              onChange={val => patch('business', val)}
              options={BUSINESS_LIST.map(b => ({ id: b.id, label: b.label }))}
            />
            <div>
              <label className="block text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-1.5">
                Due Date
              </label>
              <input
                type="date"
                className="input-field w-full text-sm"
                value={form.due_date || ''}
                onChange={e => patch('due_date', e.target.value)}
              />
            </div>
          </div>

          {/* Owners */}
          <div>
            <label className="block text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-1.5">
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
            <label className="block text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-1.5">
              Description
            </label>
            <textarea
              className="input-field w-full text-sm resize-none"
              rows={3}
              value={form.description}
              onChange={e => patch('description', e.target.value)}
              placeholder="What needs to happen and why…"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-1.5">
              Notes
            </label>
            <textarea
              className="input-field w-full text-sm resize-none"
              rows={3}
              value={form.notes}
              onChange={e => patch('notes', e.target.value)}
              placeholder="Additional context, blockers, links…"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-1.5">
              Tags
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.tags.map(tag => (
                <span
                  key={tag}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}
                >
                  #{tag}
                  <button
                    onClick={() => handleTagRemove(tag)}
                    className="hover:opacity-70 ml-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <input
              type="text"
              className="input-field w-full text-sm"
              placeholder="Add tag — press Enter or comma"
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

          {/* Metadata */}
          <div className="pt-2 border-t border-border space-y-1">
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
              <p className="text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-2 flex items-center gap-1.5">
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
        </div>

        {/* Delete confirm */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
            <div className="card p-5 w-72 space-y-4">
              <div className="flex items-center gap-2 text-red-400">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p className="font-semibold text-sm">Delete this action?</p>
              </div>
              <p className="text-text-muted text-xs">This cannot be undone.</p>
              <div className="flex gap-2">
                <button
                  className="btn-ghost flex-1 text-sm"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  className="flex-1 text-sm py-2 px-3 rounded-md font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                  onClick={handleDelete}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
