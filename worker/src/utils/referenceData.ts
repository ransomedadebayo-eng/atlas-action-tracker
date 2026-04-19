import { SupabaseClient } from '@supabase/supabase-js';

export async function validateKnownBusinessId(_supabase: SupabaseClient, business: unknown, label = 'business'): Promise<string | null> {
  if (business === undefined || business === null) return null;
  if (typeof business !== 'string' || !business.trim()) {
    return `${label} must be a non-empty string`;
  }
  return null;
}

export async function validateKnownMemberIds(supabase: SupabaseClient, ids: unknown, label = 'owners'): Promise<string[]> {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const { data, error } = await supabase
    .from('atlas_members')
    .select('id')
    .eq('is_active', true);

  if (error || !data) return [];

  const memberIds = new Set(data.map((row: { id: string }) => row.id));
  if (memberIds.size === 0) return [];

  const invalid = (ids as string[]).filter(id => !memberIds.has(id));
  if (invalid.length === 0) return [];

  return [`${label} contains unknown member ids: ${invalid.join(', ')}`];
}
