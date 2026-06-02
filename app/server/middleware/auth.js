import { createRemoteJWKSet, jwtVerify } from 'jose';
import { timingSafeEqual } from 'crypto';

// Cloudflare Access JWT verification
const CF_TEAM_DOMAIN = process.env.CF_TEAM_DOMAIN;
const CF_ACCESS_AUD = process.env.CF_ACCESS_AUD;
const CF_ACCESS_ISSUER = process.env.CF_ACCESS_ISSUER
  || (CF_TEAM_DOMAIN ? `https://${CF_TEAM_DOMAIN}.cloudflareaccess.com` : undefined);
let jwks = null;
const ACTOR_PATTERN = /^[a-z0-9_-]{2,50}$/i;

function getJWKS() {
  if (!jwks && CF_TEAM_DOMAIN) {
    jwks = createRemoteJWKSet(
      new URL(`https://${CF_TEAM_DOMAIN}.cloudflareaccess.com/cdn-cgi/access/certs`)
    );
  }
  return jwks;
}

function safeTokenCompare(provided, expected) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function actorFromAccessPayload(payload) {
  const email = typeof payload.email === 'string' ? payload.email : '';
  const name = email.split('@')[0] || 'access-user';
  const actor = name.replace(/[^a-z0-9_-]/gi, '_').slice(0, 50);
  return ACTOR_PATTERN.test(actor) ? actor : 'access-user';
}

export default async function authMiddleware(req, res, next) {
  // Path 1: Cloudflare Access JWT (tunnel traffic)
  const cfJwt = req.headers['cf-access-jwt-assertion'];
  if (cfJwt && CF_TEAM_DOMAIN && CF_ACCESS_AUD) {
    try {
      const keys = getJWKS();
      const { payload } = await jwtVerify(cfJwt, keys, {
        audience: CF_ACCESS_AUD,
        issuer: CF_ACCESS_ISSUER,
        algorithms: ['RS256'],
      });
      req.user = payload;
      req.atlasActor = actorFromAccessPayload(payload);
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid Cloudflare Access token' });
    }
  }

  // Path 2: Bearer token (CLI, work-tracker skill, local scripts)
  const authHeader = req.headers.authorization;
  const token = process.env.ATLAS_API_TOKEN;
  if (token && authHeader) {
    const expected = `Bearer ${token}`;
    if (safeTokenCompare(authHeader, expected)) {
      req.atlasActor = 'api-client';
      return next();
    }
  }

  res.status(401).json({ error: 'Unauthorized' });
}
