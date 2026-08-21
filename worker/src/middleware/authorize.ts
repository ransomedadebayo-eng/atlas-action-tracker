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
  | 'views:read'
  | 'weeks:read'
  | 'weeks:write'
  | 'weeks:request_review'
  | 'projects:read'
  | 'projects:write'
  | 'cycles:read'
  | 'cycles:write'
  | 'initiatives:read'
  | 'initiatives:write'
  | 'templates:read'
  | 'templates:write'
  | 'documents:read'
  | 'documents:write'
  | 'comments:read'
  | 'comments:write'
  | 'releases:read'
  | 'releases:write'
  | 'releases:ingest'
  | 'insights:read'
  | 'insights:write'
  | 'exports:read'
  | 'workflows:read'
  | 'workflows:write'
  | 'notifications:read'
  | 'notifications:write'
  | 'integrations:read'
  | 'integrations:write';

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
  if (/^\/api\/actions\/[^/]+\/restore-duplicate$/.test(path)) return true;
  if (/^\/api\/actions\/[^/]+\/convert-to-project$/.test(path)) return true;
  if (path.startsWith('/api/members') && method !== 'GET') return true;
  if (path.startsWith('/api/config') && method !== 'GET') return true;
  if (path.startsWith('/api/views') && method !== 'GET') return true;
  if (/^\/api\/weeks\/revisions\/[^/]+\/publish$/.test(path)) return true;
  if (/^\/api\/projects\/[^/]+\/(archive|restore)$/.test(path)) return true;
  if (path === '/api/cycles/configure' || /^\/api\/cycles\/[^/]+\/(complete|start-today)$/.test(path) || /^\/api\/cycles\/schedules\/[^/]+\/disable$/.test(path)) return true;
  if (/^\/api\/initiatives\/[^/]+\/(archive|restore)$/.test(path)) return true;
  if (path.startsWith('/api/templates') && method !== 'GET' && !/^\/api\/templates\/[^/]+\/instantiate$/.test(path)) return true;
  if (/^\/api\/documents\/[^/]+\/(archive|restore)$/.test(path)) return true;
  if (/^\/api\/documents\/[^/]+\/revert$/.test(path)) return true;
  if (path.startsWith('/api/releases/pipelines') && method !== 'GET') return true;
  if (/^\/api\/releases\/items\/[^/]+\/archive$/.test(path)) return true;
  if ((path.startsWith('/api/insights') || path.startsWith('/api/dashboards')) && method !== 'GET') return true;
  if (path.startsWith('/api/exports') || /^\/api\/insights\/[^/]+\/export\.csv$/.test(path)) return true;
  if ((path.startsWith('/api/workflows') || path.startsWith('/api/triage')) && method !== 'GET') return true;
  if ((path.startsWith('/api/notifications') || path.startsWith('/api/integrations')) && method !== 'GET') return true;
  return false;
}

export function requiredScopeForRequest(path: string, method: string): AtlasScope | null {
  if (path.startsWith('/api/actions')) {
    if (method === 'GET') return 'actions:read';
    if (method === 'DELETE') return 'actions:read';
    if (/^\/api\/actions\/[^/]+\/complete$/.test(path)) return 'actions:complete';
    if (/^\/api\/actions\/[^/]+\/duplicate$/.test(path)) return 'actions:complete';
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
  if (path === '/api/weeks/review') return 'weeks:read';
  if (path.startsWith('/api/weeks')) {
    if (method === 'GET') return 'weeks:read';
    if (/\/request-review$/.test(path)) return 'weeks:request_review';
    return 'weeks:write';
  }
  if (path.startsWith('/api/projects')) return method === 'GET' ? 'projects:read' : 'projects:write';
  if (path.startsWith('/api/cycles')) return method === 'GET' ? 'cycles:read' : 'cycles:write';
  if (path.startsWith('/api/initiatives')) return method === 'GET' ? 'initiatives:read' : 'initiatives:write';
  if (path.startsWith('/api/templates')) return method === 'GET' ? 'templates:read' : 'templates:write';
  if (path.startsWith('/api/documents')) return method === 'GET' ? 'documents:read' : 'documents:write';
  if (path.startsWith('/api/comments')) return method === 'GET' ? 'comments:read' : 'comments:write';
  if (/^\/api\/releases\/ingest\/[^/]+$/.test(path)) return 'releases:ingest';
  if (path.startsWith('/api/releases')) return method === 'GET' ? 'releases:read' : 'releases:write';
  if (path.startsWith('/api/insights') || path.startsWith('/api/dashboards')) return method === 'GET' ? 'insights:read' : 'insights:write';
  if (path.startsWith('/api/exports')) return 'exports:read';
  if (path.startsWith('/api/workflows') || path.startsWith('/api/triage')) return method === 'GET' ? 'workflows:read' : 'workflows:write';
  if (path.startsWith('/api/notifications')) return method === 'GET' ? 'notifications:read' : 'notifications:write';
  if (path.startsWith('/api/integrations')) return method === 'GET' ? 'integrations:read' : 'integrations:write';
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
