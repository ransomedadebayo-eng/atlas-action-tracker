import { SupabaseClient } from '@supabase/supabase-js';

export async function validateKnownBusinessId(_supabase: SupabaseClient, business: unknown, label = 'business'): Promise<string | null> {
  if (business === undefined || business === null) return null;
  if (typeof business !== 'string' || !business.trim()) {
    return `${label} must be a non-empty string`;
  }
  return null;
}

export async function validateKnownMemberIds(_supabase: SupabaseClient, ids: unknown, label = 'owners'): Promise<string[]> {
  if (ids === undefined) return [];
  if (!Array.isArray(ids)) return [`${label} must be an array`];
  const invalid = (ids as unknown[]).filter(id => typeof id !== 'string' || !(id as string).trim());
  if (invalid.length) return [`${label} must be non-empty strings`];
  return [];
}
