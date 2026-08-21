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
  /** External outbox draining remains off unless explicitly enabled. */
  ATLAS_DELIVERY_ENABLED?: string;
  DOCUMENT_ROOM?: DurableObjectNamespace;
  /** Additional ATLAS_INTEGRATION_SECRET_* bindings are read by exact DB secret_ref. */
  [key: string]: unknown;
}

export function getDb(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}
