import React, { useState, useRef, useCallback } from 'react'
import { Upload, FileText, X, ChevronDown, Check } from 'lucide-react'
import { useCreateTranscript } from '../hooks/useTranscripts.js'
import { useMembers } from '../hooks/useMembers.js'
import MemberSelector from './MemberSelector.jsx'
import { useBusinessContext } from '../hooks/useBusinesses.js'
import { getISODate } from '../utils/dateUtils.js'

const DEFAULT_FORM = {
  title: '',
  date: getISODate(),
  business: '',
  participants: [],
  raw_text: '',
}

export default function TranscriptUpload() {
  const { BUSINESS_LIST } = useBusinessContext()
  const [form, setForm] = useState({ ...DEFAULT_FORM })
  const [isDragOver, setIsDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const createTranscript = useCreateTranscript()
  const { data: members = [] } = useMembers()
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)

  function patch(key, val) {
    setForm(prev => ({ ...prev, [key]: val }))
    setError('')
    setSuccess(false)
  }

  function handleFileRead(file) {
    if (!file) return

    // Only accept text files
    if (!file.type.startsWith('text/') && !file.name.endsWith('.txt') && !file.name.endsWith('.md')) {
      setError('Only text files (.txt, .md) are supported')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result
      patch('raw_text', text)
      // Auto-fill title from filename if empty
      if (!form.title) {
        const name = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
        patch('title', name)
      }
    }
    reader.onerror = () => {
      setError('Failed to read file')
    }
    reader.readAsText(file)
  }

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const file = e.dataTransfer?.files?.[0]
    if (file) {
      handleFileRead(file)
      return
    }

    // Check for dropped text
    const text = e.dataTransfer?.getData('text/plain')
    if (text) {
      patch('raw_text', text)
    }
  }, [form.title])

  function handleFileInput(e) {
    const file = e.target.files?.[0]
    if (file) handleFileRead(file)
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (!form.title.trim()) {
      setError('Title is required')
      return
    }
    if (!form.raw_text.trim()) {
      setError('Transcript text is required')
      return
    }

    setSaving(true)
    setError('')
    try {
      await createTranscript.mutateAsync({
        title: form.title.trim(),
        date: form.date || null,
        business: form.business || null,
        participants: form.participants,
        raw_text: form.raw_text,
      })
      setForm({ ...DEFAULT_FORM, date: getISODate() })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err.message || 'Failed to upload transcript')
    } finally {
      setSaving(false)
    }
  }

  const wordCount = form.raw_text.trim() ? form.raw_text.trim().split(/\s+/).length : 0

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-bg-elevated">
        <Upload className="w-4 h-4 text-accent" />
        <span className="text-sm font-semibold text-text-primary">Upload Transcript</span>
        <span className="ml-auto text-[10px] text-text-muted font-mono">
          Drop file, paste text, or type directly
        </span>
      </div>

      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {/* Title */}
        <div>
          <label className="block text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-1.5">
            Title
          </label>
          <input
            type="text"
            className={`input-field w-full text-sm ${error && !form.title.trim() ? 'border-red-500/60' : ''}`}
            placeholder="Meeting title or transcript name..."
            value={form.title}
            onChange={e => patch('title', e.target.value)}
          />
        </div>

        {/* Date + Business */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-1.5">
              Date
            </label>
            <input
              type="date"
              className="input-field w-full text-sm"
              value={form.date}
              onChange={e => patch('date', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-1.5">
              Business
            </label>
            <div className="relative">
              <select
                className="input-field w-full appearance-none pr-8 text-sm"
                value={form.business}
                onChange={e => patch('business', e.target.value)}
              >
                <option value="">Select business...</option>
                {BUSINESS_LIST.map(b => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Participants */}
        <div>
          <label className="block text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-1.5">
            Participants
          </label>
          <MemberSelector
            members={members}
            selected={form.participants}
            onChange={ids => patch('participants', ids)}
            placeholder="Select participants..."
          />
        </div>

        {/* Drop zone / Text area */}
        <div>
          <label className="block text-[11px] uppercase tracking-wider font-semibold text-text-muted mb-1.5">
            Transcript Text
          </label>
          <div
            className={`relative rounded-lg border-2 border-dashed transition-colors ${
              isDragOver
                ? 'border-accent bg-accent-muted'
                : form.raw_text
                ? 'border-border'
                : 'border-border hover:border-border-hover'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {!form.raw_text ? (
              <div className="flex flex-col items-center justify-center py-10 px-4">
                <FileText className="w-8 h-8 text-text-muted mb-3" />
                <p className="text-text-secondary text-sm font-medium mb-1">
                  Drop a text file here, or paste transcript text
                </p>
                <p className="text-text-muted text-xs mb-3">
                  Supports .txt and .md files
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-xs py-1.5"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Browse File
                  </button>
                  <span className="text-text-muted text-xs">or</span>
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => textareaRef.current?.focus()}
                  >
                    Type directly
                  </button>
                </div>
              </div>
            ) : null}

            <textarea
              ref={textareaRef}
              className={`w-full bg-transparent text-text-primary text-sm resize-none focus:outline-none px-4 py-3 font-mono ${
                form.raw_text ? 'min-h-[200px]' : 'min-h-[60px] absolute inset-0 opacity-0 pointer-events-none focus:pointer-events-auto focus:opacity-100 focus:relative'
              }`}
              placeholder="Paste or type transcript text here..."
              value={form.raw_text}
              onChange={e => patch('raw_text', e.target.value)}
            />

            {form.raw_text && (
              <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-bg-elevated">
                <span className="text-[11px] text-text-muted font-mono">
                  {wordCount} word{wordCount !== 1 ? 's' : ''} / {form.raw_text.length} chars
                </span>
                <button
                  type="button"
                  className="text-text-muted hover:text-red-400 text-xs flex items-center gap-1 transition-colors"
                  onClick={() => patch('raw_text', '')}
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,text/*"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>

        {/* Error / Success */}
        {error && (
          <p className="text-red-400 text-xs">{error}</p>
        )}
        {success && (
          <div className="flex items-center gap-1.5 text-xs text-green-400">
            <Check className="w-3.5 h-3.5" />
            Transcript uploaded successfully
          </div>
        )}

        {/* Submit */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={() => {
              setForm({ ...DEFAULT_FORM, date: getISODate() })
              setError('')
              setSuccess(false)
            }}
          >
            Reset
          </button>
          <button
            type="submit"
            className="btn-primary text-sm"
            disabled={saving}
          >
            {saving ? 'Uploading...' : 'Upload Transcript'}
          </button>
        </div>
      </form>
    </div>
  )
}
