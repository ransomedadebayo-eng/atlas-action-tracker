/**
 * Safely parse a JSON array field that may already be an array,
 * a JSON string, or null/undefined.
 */
export function parseJsonArray(value) {
  if (Array.isArray(value)) return value
  if (value) return JSON.parse(value)
  return []
}
