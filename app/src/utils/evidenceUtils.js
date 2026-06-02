import { parseJsonObject } from './parseUtils.js'

export function hasEvidence(value) {
  return Object.keys(parseJsonObject(value)).length > 0
}

export function buildManualCompletionEvidence(note = '', source = 'atlas') {
  return {
    manual_completion: {
      completed_at: new Date().toISOString(),
      source,
      note: note.trim() || 'Marked manually done in Atlas.',
    },
  }
}

export function evidenceFromText(text = '', source = 'atlas') {
  const trimmed = text.trim()
  if (!trimmed) return {}

  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Completion evidence must be plain text or a JSON object.')
    }
    return parsed
  }

  return {
    completion_note: {
      added_at: new Date().toISOString(),
      source,
      note: trimmed,
    },
  }
}

export function completionEvidenceForAction(action, source = 'atlas') {
  const currentEvidence = parseJsonObject(action?.evidence_json)
  if (Object.keys(currentEvidence).length > 0) return currentEvidence
  return buildManualCompletionEvidence('', source)
}
