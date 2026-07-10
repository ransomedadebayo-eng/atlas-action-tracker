import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './db';
import { authMiddleware } from './middleware/auth';
import { authorizationMiddleware } from './middleware/authorize';
import { apiError } from './utils/http';
import actionsRouter from './routes/actions';
import membersRouter from './routes/members';
import transcriptsRouter from './routes/transcripts';
import viewsRouter from './routes/views';
import activityRouter from './routes/activity';
import configRouter from './routes/config';
import briefingRouter from './routes/briefing';
import automationsRouter from './routes/automations';
import todayRouter from './routes/today';
import journalRouter from './routes/journal';
import decideRouter from './routes/decide';
import atlasOsRouter from './routes/atlasOs';

export const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const incoming = c.req.header('cf-ray') || c.req.header('x-request-id');
  const requestId = incoming && incoming.length <= 128 ? incoming : crypto.randomUUID();
  (c as unknown as { set: (key: string, value: string) => void }).set('atlasRequestId', requestId);
  c.header('X-Request-Id', requestId);
  await next();
});

// CORS — same-origin in production (Workers Assets serves frontend from same domain)
app.use('/api/*', cors({
  origin: ['https://atlas.ransomed.app'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['X-Request-Id'],
  credentials: true,
}));

// Health checks (unauthenticated)
app.get('/health', (c) => c.json({ status: 'ok' }));
app.get('/api/health', (c) => c.json({ status: 'ok' }));
app.get('/favicon.ico', (c) => c.redirect('/favicon.svg', 302));

// Auth on all /api/* routes
app.use('/api/*', authMiddleware);
app.use('/api/*', authorizationMiddleware);

// Routes
app.route('/api/actions', actionsRouter);
app.route('/api/members', membersRouter);
app.route('/api/transcripts', transcriptsRouter);
app.route('/api/views', viewsRouter);
app.route('/api/activity', activityRouter);
app.route('/api/config', configRouter);
app.route('/api/briefing', briefingRouter);
app.route('/api/automations', automationsRouter);
app.route('/api/today', todayRouter);
app.route('/api/journal', journalRouter);
app.route('/api/decide', decideRouter);
app.route('/api/atlas-os', atlasOsRouter);

// 404 fallback for unmatched /api routes
app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return apiError(c, 404, 'NOT_FOUND', 'The requested ATLAS API route does not exist.');
  }
  // Non-API 404s are handled by Workers Assets (serves index.html for SPA routing)
  return c.notFound();
});

app.onError((error, c) => {
  const requestId = (c as unknown as { get: (key: string) => unknown }).get('atlasRequestId');
  console.error(JSON.stringify({
    level: 'error',
    request_id: requestId || 'unknown',
    method: c.req.method,
    path: c.req.path,
    message: error.message,
  }));
  return apiError(c, 500, 'INTERNAL_ERROR', 'ATLAS could not complete the request.');
});

export default { fetch: app.fetch };
