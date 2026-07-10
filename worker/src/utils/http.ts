import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export function getRequestId(c: Context): string {
  const requestId = c.get('atlasRequestId') as unknown;
  return typeof requestId === 'string' && requestId ? requestId : 'unknown';
}

export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: unknown,
) {
  return c.json({
    code,
    message,
    ...(details === undefined ? {} : { details }),
    request_id: getRequestId(c),
  }, status);
}
