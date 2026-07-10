import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ATLAS_API_PRINCIPALS_JSON?: string;
  ATLAS_OWNER_EMAILS?: string;
  /** Local-development compatibility only. Ignored when NODE_ENV=production. */
  ATLAS_API_TOKEN?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_ISSUER?: string;
  CF_ACCESS_JWKS_URL?: string;
  NODE_ENV?: string;
}

export function getDb(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}
