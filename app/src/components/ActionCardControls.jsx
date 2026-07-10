import React, { useEffect, useRef, useState } from 'react'
import { Archive, CheckCircle2, X } from 'lucide-react'
import { useArchiveAction, useCompleteAction } from '../hooks/useActions.js'

function revisionPayload(action) {
  return Number.isInteger(action.revision) ? { expected_revision: action.revision } : {}
}

export default function ActionCardControls({ action, className = '' }) {
  const completeAction = useCompleteAction()
  const archiveAction = useArchiveAction()
  const [mode, setMode] = useState(null)
  const [completionNote, setCompletionNote] = useState('')
  const [error, setError] = useState('')
  const dialogRef = useRef(null)
  const triggerRef = useRef(null)

  const pending = completeAction.isPending || archiveAction.isPending

  useEffect(() => {
    if (!mode) return undefined
    const dialog = dialogRef.current
    const completionField = mode === 'complete' ? dialog?.querySelector('textarea') : null
    if (completionField) completionField.focus()
    else dialog?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape' && !pending) {
        event.preventDefault()
        closeDialog()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = dialog.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"])')
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    dialog?.addEventListener('keydown', handleKeyDown)
    return () => dialog?.removeEventListener('keydown', handleKeyDown)
  }, [mode, pending])

  function openDialog(nextMode, event) {
    event.stopPropagation()
    triggerRef.current = event.currentTarget
    setError('')
    setCompletionNote('')
    setMode(nextMode)
  }

  function closeDialog() {
    setMode(null)
    setError('')
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  async function completeTask() {
    const summary = completionNote.trim()
    if (!summary) {
      setError('Enter a completion note before marking this task complete.')
      return
    }

    setError('')
    try {
      await completeAction.mutateAsync({
        id: action.id,
        ...revisionPayload(action),
        evidence: {
          version: 2,
          kind: 'manual_attestation',
          summary,
          sources: [],
          verification: { status: 'attested' },
        },
      })
      setMode(null)
    } catch (mutationError) {
      setError(mutationError?.message || 'The task could not be completed.')
    }
  }

  async function archiveTask() {
    setError('')
    try {
      await archiveAction.mutateAsync({ id: action.id, ...revisionPayload(action) })
      setMode(null)
    } catch (mutationError) {
      setError(mutationError?.message || 'The task could not be archived.')
    }
  }

  return (
    <>
      <div
        className={`grid grid-cols-2 gap-2 ${className}`}
        onClick={event => event.stopPropagation()}
      >
        <button
          type="button"
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-accent/25 bg-accent-muted px-3 py-2 text-xs font-semibold text-accent"
          onClick={event => openDialog('complete', event)}
          aria-label={`Complete ${action.title}`}
        >
          <CheckCircle2 className="h-4 w-4" />
          Complete
        </button>
        <button
          type="button"
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs font-semibold text-text-secondary"
          onClick={event => openDialog('archive', event)}
          aria-label={`Archive ${action.title}`}
        >
          <Archive className="h-4 w-4" />
          Archive
        </button>
      </div>

      {mode && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-3 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`action-card-${mode}-title`}
        >
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Dismiss task action"
            onClick={closeDialog}
            disabled={pending}
          />
          <div
            ref={dialogRef}
            tabIndex={-1}
            className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-bg-surface p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="label">Task action</p>
                <h2 id={`action-card-${mode}-title`} className="mt-1 text-lg font-semibold text-text-primary">
                  {mode === 'complete' ? 'Complete task' : 'Archive task'}
                </h2>
              </div>
              <button
                type="button"
                className="min-h-11 min-w-11 rounded-lg text-text-muted hover:bg-bg-elevated hover:text-text-primary"
                onClick={closeDialog}
                aria-label="Close task action"
                disabled={pending}
              >
                <X className="mx-auto h-5 w-5" />
              </button>
            </div>

            <p className="mt-3 text-sm font-medium text-text-primary">{action.title}</p>

            {mode === 'complete' ? (
              <div className="mt-4">
                <label htmlFor={`completion-note-${action.id}`} className="label block mb-1.5">
                  Completion note
                </label>
                <textarea
                  id={`completion-note-${action.id}`}
                  className="input-field min-h-24 w-full resize-none"
                  value={completionNote}
                  onChange={event => setCompletionNote(event.target.value)}
                  placeholder="What was completed and how did you verify it?"
                  autoFocus
                />
                <p className="mt-1.5 text-xs text-text-muted">Required evidence for the audit trail.</p>
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-border bg-bg-primary p-3 text-sm text-text-secondary">
                This safely removes the task from active views. It is archived, not permanently deleted, and can be restored later.
              </p>
            )}

            {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn-secondary min-h-11"
                onClick={closeDialog}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary min-h-11"
                onClick={mode === 'complete' ? completeTask : archiveTask}
                disabled={pending}
              >
                {pending ? 'Working…' : mode === 'complete' ? 'Complete task' : 'Archive task'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
