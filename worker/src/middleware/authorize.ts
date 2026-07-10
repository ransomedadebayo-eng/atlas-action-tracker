import type { Context, Next } from 'hono';
import type { Env } from '../db';
import { apiError } from '../utils/http';

export type AtlasScope =
  | 'actions:read'
  | 'actions:write'
  | 'actions:complete'
  | 'actions:assign'
  | 'transcripts:read'
  | 'transcripts:write'
  | 'automations:read'
  | 'principals:read'
  | 'config:read'
  | 'views:read';

function getAuthKind(c: Context): string {
  const value = c.get('atlasAuthKind') as unknown;
  return typeof value === 'string' ? value : '';
}

function getScopes(c: Context): Set<string> {
  const value = c.get('atlasScopes') as unknown;
  return new Set(Array.isArray(value) ? value.filter((scope): scope is string => typeof scope === 'string') : []);
}

export function hasRequestScope(c: Context, scope: AtlasScope): boolean {
  return getAuthKind(c) === 'owner_access' || getScopes(c).has(scope);
}

function ownerOnlyRequest(path: string, method: string): boolean {
  if (path.startsWith('/api/journal') || path.startsWith('/api/decide') || path.startsWith('/api/atlas-os')) return true;
  if (/^\/api\/actions\/[^/]+\/(archive|restore)$/.test(path)) return true;
  if (path.startsWith('/api/members') && method !== 'GET') return true;
  if (path.startsWith('/api/config') && method !== 'GET') return true;
  if (path.startsWith('/api/views') && method !== 'GET') return true;
  return false;
}

export function requiredScopeForRequest(path: string, method: string): AtlasScope | null {
  if (path.startsWith('/api/actions')) {
    if (method === 'GET') return 'actions:read';
    if (method === 'DELETE') return 'actions:read';
    if (/^\/api\/actions\/[^/]+\/complete$/.test(path)) return 'actions:complete';
    if (/^\/api\/actions\/[^/]+\/agent-assignment$/.test(path)) return 'actions:assign';
    return 'actions:write';
  }
  if (path.startsWith('/api/activity') || path.startsWith('/api/today') || path.startsWith('/api/briefing')) {
    return 'actions:read';
  }
  if (path.startsWith('/api/transcripts')) return method === 'GET' ? 'transcripts:read' : 'transcripts:write';
  if (path.startsWith('/api/automations') && method === 'GET') return 'automations:read';
  if (path.startsWith('/api/members') && method === 'GET') return 'principals:read';
  if (path.startsWith('/api/config') && method === 'GET') return 'config:read';
  if (path.startsWith('/api/views') && method === 'GET') return 'views:read';
  return null;
}

export async function authorizationMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  if (getAuthKind(c) === 'owner_access') return next();

  const path = c.req.path;
  const method = c.req.method.toUpperCase();
  if (ownerOnlyRequest(path, method)) {
    return apiError(c, 403, 'OWNER_REQUIRED', 'This operation is restricted to the ATLAS owner.');
  }

  const requiredScope = requiredScopeForRequest(path, method);
  if (!requiredScope || !getScopes(c).has(requiredScope)) {
    return apiError(c, 403, 'INSUFFICIENT_SCOPE', 'The authenticated principal does not have permission for this operation.', {
      required_scope: requiredScope,
    });
  }

  return next();
}
