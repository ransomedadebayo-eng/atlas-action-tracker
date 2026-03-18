/**
 * Safely parse a JSON array field that may already be an array,
 * a JSON string, or null/undefined.
 */
export function parseJsonArray(value) {
  if (Array.isArray(value)) return value
  if (value) {
    try {
      return JSON.parse(value)
    } catch {
      const trimmed = String(value).trim()
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const inner = trimmed.slice(1, -1).trim()
        if (!inner) return []
        return inner
          .split(',')
          .map(part => part.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean)
      }
    }
  }
  return []
}
