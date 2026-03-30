export function coerceJsonArray(value, fallback = []) {
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

export function coerceJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return { ...fallback };

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* ignore */ }
  }

  return { ...fallback };
}

export function serializeJsonArray(value, fallback = []) {
  return coerceJsonArray(value, fallback);
}

export function serializeJsonObject(value, fallback = {}) {
  return coerceJsonObject(value, fallback);
}
