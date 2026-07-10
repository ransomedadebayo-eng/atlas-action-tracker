import { Context } from 'hono';

const ACTOR_PATTERN = /^[a-z0-9_-]{2,50}$/i;

export function getActor(c: Context, fallback = 'user'): string {
  const verifiedActor = (c as unknown as { get: (key: string) => unknown }).get('atlasActor');
  if (typeof verifiedActor === 'string' && ACTOR_PATTERN.test(verifiedActor)) return verifiedActor;
  return fallback;
}

export function getAuthKind(c: Context): string {
  const authKind = (c as unknown as { get: (key: string) => unknown }).get('atlasAuthKind');
  return typeof authKind === 'string' ? authKind : '';
}
