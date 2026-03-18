function parseJson(value) {
  if (typeof value !== 'string') return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeLooseList(value) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;

  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];

  return inner
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const unquoted = part.replace(/^['"]|['"]$/g, '').trim();
      return unquoted;
    })
    .filter(Boolean);
}

function normalizeStringArrayItems(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map(item => {
      if (item === null || item === undefined) return null;
      if (typeof item === 'string') return item.trim();
      if (typeof item === 'number' || typeof item === 'boolean') return String(item);
      return JSON.stringify(item);
    })
    .filter(item => item !== null && item !== '');
}

export function coerceJsonArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return normalizeStringArrayItems(value);
  }

  if (value === null || value === undefined || value === '') {
    return [...fallback];
  }

  const parsed = parseJson(value);
  if (Array.isArray(parsed)) {
    return normalizeStringArrayItems(parsed);
  }

  const looseList = normalizeLooseList(value);
  if (Array.isArray(looseList)) {
    return normalizeStringArrayItems(looseList);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) return [trimmed];
  }

  return [...fallback];
}

export function coerceJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  if (value === null || value === undefined || value === '') {
    return { ...fallback };
  }

  const parsed = parseJson(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed;
  }

  return { ...fallback };
}

export function serializeJsonArray(value, fallback = []) {
  return JSON.stringify(coerceJsonArray(value, fallback));
}

export function serializeJsonObject(value, fallback = {}) {
  return JSON.stringify(coerceJsonObject(value, fallback));
}

export function sqlJsonArray(column) {
  return `CASE WHEN json_valid(${column}) THEN CASE WHEN json_type(${column}) = 'array' THEN ${column} ELSE '[]' END ELSE '[]' END`;
}
