import { Context, Next } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Env } from '../db';
import { apiError } from '../utils/http';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const MACHINE_PRINCIPALS = ['codex', 'claude'] as const;

export type MachinePrincipal = {
  actor: 'codex' | 'claude';
  token: string;
  scopes: string[];
};

async function sha256(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
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
      if (typeof config.token !== 'string' || config.token.length < 16 || !Array.isArray(config.scopes)) continue;
      const scopes = Array.from(new Set(config.scopes.filter((scope): scope is string => (
        typeof scope === 'string' && /^[a-z]+:[a-z]+$/.test(scope)
      ))));
      principals.push({ actor, token: config.token, scopes });
    }

    if (new Set(principals.map(principal => principal.token)).size !== principals.length) return [];
    return principals;
  } catch {
    return [];
  }
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
    if (!email || !parseOwnerEmails(c.env.ATLAS_OWNER_EMAILS).has(email)) return 'forbidden';
    setRequestIdentity(c, 'ransomed', 'owner_access', ['*']);
    return 'authorized';
  } catch {
    return 'invalid';
  }
}

function setRequestIdentity(c: Context<{ Bindings: Env }>, actor: string, authKind: 'api_principal' | 'owner_access', scopes: string[]) {
  (c as unknown as { set: (key: string, value: string) => void }).set('atlasActor', actor);
  (c as unknown as { set: (key: string, value: string) => void }).set('atlasAuthKind', authKind);
  (c as unknown as { set: (key: string, value: string[]) => void }).set('atlasScopes', scopes);
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('authorization');
  const accessJwt = c.req.header('cf-access-jwt-assertion');

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
      return apiError(c, 403, 'OWNER_EMAIL_REQUIRED', 'This Cloudflare Access identity is not the configured ATLAS owner.');
    }
  }

  return apiError(c, 401, 'UNAUTHORIZED', 'Valid owner or scoped principal authentication is required.');
}
