import { parseJsonObject } from './parseUtils.js'

export function hasEvidence(value) {
  return Object.keys(parseJsonObject(value)).length > 0
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
