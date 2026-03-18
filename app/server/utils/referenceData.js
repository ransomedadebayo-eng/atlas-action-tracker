import db from '../db.js';

function loadConfiguredBusinesses() {
  const row = db.prepare("SELECT value FROM config WHERE key = 'businesses'").get();
  if (!row?.value) return [];

  try {
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item && typeof item.id === 'string' && item.id.trim());
  } catch {
    return [];
  }
}

function loadMemberIds() {
  return db.prepare('SELECT id FROM members WHERE is_active = 1').all().map(row => row.id);
}

export function validateKnownBusinessId(business, label = 'business') {
  if (business === undefined || business === null || business === '') return null;

  const configured = loadConfiguredBusinesses();
  if (configured.length === 0) return null;

  if (!configured.some(item => item.id === business)) {
    return `${label} must match a configured business id`;
  }

  return null;
}

export function validateKnownMemberIds(ids, label = 'owners') {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const memberIds = new Set(loadMemberIds());
  if (memberIds.size === 0) return [];

  const invalid = ids.filter(id => !memberIds.has(id));
  if (invalid.length === 0) return [];

  return [`${label} contains unknown member ids: ${invalid.join(', ')}`];
}
