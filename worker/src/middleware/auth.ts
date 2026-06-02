import { Context, Next } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import { Env } from '../db';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const ACTOR_PATTERN = /^[a-z0-9_-]{2,50}$/i;

function safeTokenCompare(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
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

async function verifyAccessJwt(c: Context<{ Bindings: Env }>, accessJwt: string): Promise<boolean> {
  const audience = c.env.CF_ACCESS_AUD;
  if (!audience) return false;

  const jwks = getAccessJwks(c.env);
  if (!jwks) return false;

  const issuer = c.env.CF_ACCESS_ISSUER
    || (c.env.CF_ACCESS_TEAM_DOMAIN ? `https://${c.env.CF_ACCESS_TEAM_DOMAIN}.cloudflareaccess.com` : undefined);

  try {
    const { payload } = await jwtVerify(accessJwt, jwks, {
      audience,
      issuer,
      algorithms: ['RS256'],
    });
    setRequestActor(c, actorFromAccessPayload(payload));
    return true;
  } catch {
    return false;
  }
}

function actorFromAccessPayload(payload: JWTPayload): string {
  const email = typeof payload.email === 'string' ? payload.email : '';
  const name = email.split('@')[0] || 'access-user';
  const actor = name.replace(/[^a-z0-9_-]/gi, '_').slice(0, 50);
  return ACTOR_PATTERN.test(actor) ? actor : 'access-user';
}

function setRequestActor(c: Context<{ Bindings: Env }>, actor: string) {
  (c as unknown as { set: (key: string, value: string) => void }).set('atlasActor', actor);
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const token = c.env.ATLAS_API_TOKEN;
  const authHeader = c.req.header('authorization');
  const accessJwt = c.req.header('cf-access-jwt-assertion');

  if (token && authHeader) {
    const expected = `Bearer ${token}`;
    if (safeTokenCompare(authHeader, expected)) {
      setRequestActor(c, 'api-client');
      return next();
    }
  }

  if (accessJwt && await verifyAccessJwt(c, accessJwt)) {
    return next();
  }

  return c.json({ error: 'Unauthorized' }, 401);
}
