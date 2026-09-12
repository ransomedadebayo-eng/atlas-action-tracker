import { Context, Next } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Env, getDb } from '../db';
import { apiError } from '../utils/http';
import { MACHINE_PRINCIPALS, MachinePrincipalId } from '../utils/principals';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export type MachinePrincipal = {
  actor: MachinePrincipalId;
  token: string;
  scopes: string[];
};

export type HumanAccessPrincipal = {
  email: string;
  actor: 'nicole';
  scopes: string[];
};

export type AccessIdentity = {
  actor: 'ransomed' | 'nicole';
  authKind: 'owner_access' | 'human_access';
  scopes: string[];
};

function parseScopes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return Array.from(new Set(value.filter((scope): scope is string => (
    typeof scope === 'string' && /^[a-z]+:[a-z]+(?:_[a-z]+)*$/.test(scope)
  ))));
}

async function sha256(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export async function sha256Hex(value: string): Promise<string> {
  return Array.from(await sha256(value)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function matchReleaseAccessKey(env: Env, pipelineId: string, provided: string): Promise<boolean> {
  if (!pipelineId || provided.length < 24) return false;
  const { data, error } = await getDb(env).from('atlas_release_pipelines').select('access_key_hash,status').eq('id', pipelineId).maybeSingle();
  if (error || !data || data.status !== 'active' || typeof data.access_key_hash !== 'string') return false;
  return safeTokenCompare(await sha256Hex(provided), data.access_key_hash);
}

export async function safeTokenCompare(provided: string, expected: string): Promise<boolean> {
  const [providedDigest, expectedDigest] = await Promise.all([sha256(provided), sha256(expected)]);
  let mismatch = 0;
  for (let i = 0; i < expectedDigest.length; i++) {
    mismatch |= providedDigest[i] ^ expectedDigest[i];
  }
  return mismatch === 0;
}

export function parseOwnerEmails(raw?: string): Set<string> {
  return new Set((raw || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean));
}

export function parseApiPrincipals(raw?: string): MachinePrincipal[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];

    const principals: MachinePrincipal[] = [];
    for (const actor of MACHINE_PRINCIPALS) {
      const value = parsed[actor];
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const config = value as Record<string, unknown>;
      const scopes = parseScopes(config.scopes);
      if (typeof config.token !== 'string' || config.token.length < 16 || !scopes) continue;
      principals.push({ actor, token: config.token, scopes });
    }

    if (new Set(principals.map(principal => principal.token)).size !== principals.length) return [];
    return principals;
  } catch {
    return [];
  }
}

export function parseHumanAccessPrincipals(raw?: string): HumanAccessPrincipal[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];

    const principals: HumanAccessPrincipal[] = [];
    for (const [rawEmail, value] of Object.entries(parsed)) {
      const email = rawEmail.trim().toLowerCase();
      if (!email || !email.includes('@') || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const config = value as Record<string, unknown>;
      const scopes = parseScopes(config.scopes);
      if (config.actor !== 'nicole' || !scopes || scopes.length === 0) continue;
      principals.push({ email, actor: 'nicole', scopes });
    }

    if (new Set(principals.map(principal => principal.actor)).size !== principals.length) return [];
    return principals;
  } catch {
    return [];
  }
}

function humanAccessEmails(raw?: string): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Set();
    return new Set(Object.keys(parsed).map(email => email.trim().toLowerCase()).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function resolveVerifiedAccessIdentity(email: string, env: Pick<Env, 'ATLAS_OWNER_EMAILS' | 'ATLAS_HUMAN_ACCESS_JSON'>): AccessIdentity | null {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;
  const isOwner = parseOwnerEmails(env.ATLAS_OWNER_EMAILS).has(normalizedEmail);
  if (isOwner && humanAccessEmails(env.ATLAS_HUMAN_ACCESS_JSON).has(normalizedEmail)) return null;
  const principal = parseHumanAccessPrincipals(env.ATLAS_HUMAN_ACCESS_JSON)
    .find(candidate => candidate.email === normalizedEmail);
  if (isOwner) {
    return { actor: 'ransomed', authKind: 'owner_access', scopes: ['*'] };
  }
  return principal ? { actor: principal.actor, authKind: 'human_access', scopes: principal.scopes } : null;
}

export async function matchMachinePrincipal(providedToken: string, rawConfig?: string): Promise<MachinePrincipal | null> {
  const principals = parseApiPrincipals(rawConfig);
  let match: MachinePrincipal | null = null;
  for (const principal of principals) {
    if (await safeTokenCompare(providedToken, principal.token)) match = principal;
  }
  return match;
}

function getAccessJwks(env: Env) {
  const jwksUrl = env.CF_ACCESS_JWKS_URL
    || (env.CF_ACCESS_TEAM_DOMAIN
      ? `https://${env.CF_ACCESS_TEAM_DOMAIN}.cloudflareaccess.com/cdn-cgi/access/certs`
      : '');
  if (!jwksUrl) return null;
  if (!jwksCache.has(jwksUrl)) {
    jwksCache.set(jwksUrl, createRemoteJWKSet(new URL(jwksUrl)));
  }
  return jwksCache.get(jwksUrl) || null;
}

async function verifyAccessJwt(c: Context<{ Bindings: Env }>, accessJwt: string): Promise<'authorized' | 'forbidden' | 'invalid'> {
  const audience = c.env.CF_ACCESS_AUD;
  if (!audience) return 'invalid';

  const jwks = getAccessJwks(c.env);
  if (!jwks) return 'invalid';

  const issuer = c.env.CF_ACCESS_ISSUER
    || (c.env.CF_ACCESS_TEAM_DOMAIN ? `https://${c.env.CF_ACCESS_TEAM_DOMAIN}.cloudflareaccess.com` : undefined);

  try {
    const { payload } = await jwtVerify(accessJwt, jwks, {
      audience,
      issuer,
      algorithms: ['RS256'],
    });
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const identity = resolveVerifiedAccessIdentity(email, c.env);
    if (!identity) return 'forbidden';
    setRequestIdentity(c, identity.actor, identity.authKind, identity.scopes);
    return 'authorized';
  } catch {
    return 'invalid';
  }
}

function setRequestIdentity(c: Context<{ Bindings: Env }>, actor: string, authKind: 'api_principal' | 'human_access' | 'owner_access' | 'release_access', scopes: string[]) {
  (c as unknown as { set: (key: string, value: string) => void }).set('atlasActor', actor);
  (c as unknown as { set: (key: string, value: string) => void }).set('atlasAuthKind', authKind);
  (c as unknown as { set: (key: string, value: string[]) => void }).set('atlasScopes', scopes);
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('authorization');
  const accessJwt = c.req.header('cf-access-jwt-assertion');
  const releaseMatch = c.req.path.match(/^\/api\/releases\/ingest\/([^/]+)$/);
  const releaseKey = c.req.header('x-atlas-release-key');

  if (releaseMatch && releaseKey && await matchReleaseAccessKey(c.env, decodeURIComponent(releaseMatch[1]), releaseKey)) {
    setRequestIdentity(c, 'release_ci', 'release_access', ['releases:ingest']);
    (c as unknown as { set: (key: string, value: string) => void }).set('atlasReleasePipelineId', decodeURIComponent(releaseMatch[1]));
    return next();
  }

  if (authHeader?.startsWith('Bearer ')) {
    const providedToken = authHeader.slice(7);
    const principal = await matchMachinePrincipal(providedToken, c.env.ATLAS_API_PRINCIPALS_JSON);
    if (principal) {
      setRequestIdentity(c, principal.actor, 'api_principal', principal.scopes);
      return next();
    }
    if (c.env.NODE_ENV !== 'production' && c.env.ATLAS_API_TOKEN && await safeTokenCompare(providedToken, c.env.ATLAS_API_TOKEN)) {
      setRequestIdentity(c, 'ransomed', 'owner_access', ['*']);
      return next();
    }
  }

  if (accessJwt) {
    const result = await verifyAccessJwt(c, accessJwt);
    if (result === 'authorized') return next();
    if (result === 'forbidden') {
      return apiError(c, 403, 'ACCESS_IDENTITY_NOT_ALLOWED', 'This verified Cloudflare Access identity is not configured for ATLAS.');
    }
  }

  return apiError(c, 401, 'UNAUTHORIZED', 'Valid owner or scoped principal authentication is required.');
}
