export function coerceJsonArray(value: unknown, fallback: unknown[] = []): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [...fallback];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* ignore */ }
  }
  return [...fallback];
}

export function coerceJsonObject(value: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (value === null || value === undefined || value === '') return { ...fallback };
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* ignore */ }
  }
  return { ...fallback };
}

export const serializeJsonArray = coerceJsonArray;
export const serializeJsonObject = coerceJsonObject;
