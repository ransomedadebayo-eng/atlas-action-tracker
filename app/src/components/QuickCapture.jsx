import React, { useState, useEffect, useRef } from 'react'
import { X, Zap, ChevronDown } from 'lucide-react'
import { useCreateAction } from '../hooks/useActions.js'
import { useMembers } from '../hooks/useMembers.js'
import MemberSelector from './MemberSelector.jsx'
import { PRIORITY_LIST, STATUS_LIST, RECURRENCE_LIST } from '../utils/constants.js'
import { useBusinessContext } from '../hooks/useBusinesses.js'

const DEFAULT_FORM = {
  title: '',
  business: '',
  priority: 'p2',
  status: 'not_started',
  due_date: '',
  owners: [],
  description: '',
  recurrence: 'none',
}

export default function QuickCapture({ onClose, selectedBusiness, prefilledDate }) {
  const { BUSINESS_LIST } = useBusinessContext()
  const [form, setForm] = useState({
    ...DEFAULT_FORM,
    business: selectedBusiness || '',
    due_date: prefilledDate || '',
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const createAction = useCreateAction()
  const { data: members = [] } = useMembers()
  const titleRef = useRef(null)
  const modalRef = useRef(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  // Focus trap
  useEffect(() => {
    const previousFocus = document.activeElement
    const panel = modalRef.current
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

  function patch(key, val) {
    setForm(prev => ({ ...prev, [key]: val }))
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) {
      setError('Title is required')
      titleRef.current?.focus()
      return
    }
    setSaving(true)
    try {
      await createAction.mutateAsync(form)
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to create action')
      setSaving(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(e)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-start justify-center md:pt-24 px-0 md:px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="Quick capture"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal — slides up from bottom on mobile, centered on desktop */}
      <div
        ref={modalRef}
        tabIndex={-1}
        className="relative w-full md:max-w-lg card shadow-2xl overflow-hidden rounded-t-2xl md:rounded-xl max-h-[90vh] md:max-h-none"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Zap className="w-4 h-4 text-accent flex-shrink-0" />
          <span className="text-sm font-semibold text-text-primary">Quick Capture</span>
          <span className="ml-auto text-[10px] text-text-muted font-mono">
            Cmd+Enter to save · Esc to close
          </span>
          <button
            className="btn-ghost p-1 text-text-muted hover:text-text-primary ml-1"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {/* Title */}
          <input
            ref={titleRef}
            type="text"
            className={`input-field w-full text-base font-medium ${error ? 'border-red-500/60' : ''}`}
            placeholder="What needs to get done?"
            value={form.title}
            onChange={e => patch('title', e.target.value)}
            autoComplete="off"
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}

          {/* Business + Priority */}
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <select
                className="input-field w-full appearance-none pr-8 text-sm"
                value={form.business}
                onChange={e => patch('business', e.target.value)}
              >
                <option value="">Business…</option>
                {BUSINESS_LIST.map(b => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
            </div>
            <div className="relative">
              <select
                className="input-field w-full appearance-none pr-8 text-sm"
                value={form.priority}
                onChange={e => patch('priority', e.target.value)}
              >
                {PRIORITY_LIST.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
            </div>
          </div>

          {/* Due date */}
          <input
            type="date"
            className="input-field w-full text-sm"
            value={form.due_date}
            onChange={e => patch('due_date', e.target.value)}
            placeholder="Due date"
          />

          {/* Advanced toggle */}
          <button
            type="button"
            className="text-xs text-text-muted hover:text-text-secondary transition-colors flex items-center gap-1"
            onClick={() => setShowAdvanced(v => !v)}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            {showAdvanced ? 'Less options' : 'More options'}
          </button>

          {showAdvanced && (
            <div className="space-y-3 pt-1">
              {/* Status */}
              <div className="relative">
                <select
                  className="input-field w-full appearance-none pr-8 text-sm"
                  value={form.status}
                  onChange={e => patch('status', e.target.value)}
                >
                  {STATUS_LIST.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
              </div>

              {/* Recurrence */}
              <div className="relative">
                <select
                  className="input-field w-full appearance-none pr-8 text-sm"
                  value={form.recurrence}
                  onChange={e => patch('recurrence', e.target.value || 'none')}
                >
                  <option value="none">No recurrence</option>
                  {RECURRENCE_LIST.map(r => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
              </div>

              {/* Owners */}
              <MemberSelector
                members={members}
                selectedIds={form.owners}
                onChange={ids => patch('owners', ids)}
                placeholder="Assign owners…"
              />

              {/* Description */}
              <textarea
                className="input-field w-full text-sm resize-none"
                rows={2}
                placeholder="Description (optional)"
                value={form.description}
                onChange={e => patch('description', e.target.value)}
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="btn-ghost flex-1 text-sm"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex-1 text-sm"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Create Action'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
