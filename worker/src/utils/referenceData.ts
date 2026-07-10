import { SupabaseClient } from '@supabase/supabase-js';

export async function validateKnownBusinessId(_supabase: SupabaseClient, business: unknown, label = 'business'): Promise<string | null> {
  if (business === undefined || business === null || business === '') return null;
  if (typeof business !== 'string' || !business.trim()) {
    return `${label} must be a non-empty string`;
  }

  const { data } = await _supabase
    .from('atlas_config')
    .select('value')
    .eq('key', 'businesses')
    .maybeSingle();
  const configured = Array.isArray(data?.value) ? data.value : [];
  if (configured.length === 0) return null;

  const known = configured.some(item => item && typeof item.id === 'string' && item.id === business);
  if (!known) return `${label} must match a configured business id`;

  return null;
}

export async function validateKnownMemberIds(_supabase: SupabaseClient, ids: unknown, label = 'owners'): Promise<string[]> {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const invalid = (ids as unknown[]).filter(id => typeof id !== 'string' || !(id as string).trim());
  if (invalid.length) return [`${label} must be non-empty strings`];

  const { data } = await _supabase
    .from('atlas_members')
    .select('id, name')
    .eq('is_active', true);
  const memberIds = new Set((data || []).map(row => row.id));
  if (memberIds.size === 0) return [];

  const canonicalByLookup = new Map<string, string>();
  for (const row of data || []) {
    if (typeof row.id === 'string') canonicalByLookup.set(row.id.trim().toLowerCase(), row.id);
    if (typeof row.name === 'string') canonicalByLookup.set(row.name.trim().toLowerCase(), row.id);
  }

  const normalized = (ids as string[]).map(id => canonicalByLookup.get(id.trim().toLowerCase()) || id.trim());
  ids.splice(0, ids.length, ...Array.from(new Set(normalized)));

  const unknown = (ids as string[]).filter(id => !memberIds.has(id));
  if (unknown.length) return [`${label} contains unknown member ids: ${unknown.join(', ')}`];

  return [];
}
