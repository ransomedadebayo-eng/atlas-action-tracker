import { SupabaseClient } from '@supabase/supabase-js';

export async function validateKnownBusinessId(supabase: SupabaseClient, business: unknown, label = 'business'): Promise<string | null> {
  if (business === undefined || business === null || business === '') return null;

  const { data, error } = await supabase
    .from('atlas_config')
    .select('value')
    .eq('key', 'businesses')
    .single();

  if (error || !data?.value) return null;

  const configured: unknown[] = Array.isArray(data.value) ? data.value : [];
  if (configured.length === 0) return null;

  if (!configured.some((item: unknown) => (item as { id: string }).id === business)) {
    return `${label} must match a configured business id`;
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
