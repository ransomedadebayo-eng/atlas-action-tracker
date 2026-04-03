import supabase from '../db.js';

async function loadConfiguredBusinesses() {
  const { data, error } = await supabase
    .from('atlas_config')
    .select('value')
    .eq('key', 'businesses')
    .single();

  if (error || !data?.value) return [];

  const parsed = data.value;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(item => item && typeof item.id === 'string' && item.id.trim());
}

async function loadMemberIds() {
  const { data, error } = await supabase
    .from('atlas_members')
    .select('id')
    .eq('is_active', true);

  if (error || !data) return [];
  return data.map(row => row.id);
}

export async function validateKnownBusinessId(business, label = 'business') {
  if (business === undefined || business === null || business === '') return null;

  const configured = await loadConfiguredBusinesses();
  if (configured.length === 0) return null;

  if (!configured.some(item => item.id === business)) {
    return `${label} must match a configured business id`;
  }

  return null;
}

export async function validateKnownMemberIds(ids, label = 'owners') {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const memberIds = new Set(await loadMemberIds());
  if (memberIds.size === 0) return [];

  const invalid = ids.filter(id => !memberIds.has(id));
  if (invalid.length === 0) return [];

  return [`${label} contains unknown member ids: ${invalid.join(', ')}`];
}
