import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './db';
import { authMiddleware } from './middleware/auth';
import actionsRouter from './routes/actions';
import membersRouter from './routes/members';
import transcriptsRouter from './routes/transcripts';
import viewsRouter from './routes/views';
import activityRouter from './routes/activity';
import configRouter from './routes/config';
import briefingRouter from './routes/briefing';
import automationsRouter from './routes/automations';
import { runScheduledProtocolJobs } from './automations/protocolJobs';
import todayRouter from './routes/today';

const app = new Hono<{ Bindings: Env }>();

// CORS — same-origin in production (Workers Assets serves frontend from same domain)
app.use('/api/*', cors({
  origin: ['https://atlas.ransomed.app'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Health checks (unauthenticated)
app.get('/health', (c) => c.json({ status: 'ok' }));
app.get('/api/health', (c) => c.json({ status: 'ok' }));
app.get('/favicon.ico', (c) => c.redirect('/favicon.svg', 302));

// Auth on all /api/* routes
app.use('/api/*', authMiddleware);

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

// 404 fallback for unmatched /api routes
app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'Not found' }, 404);
  }
  // Non-API 404s are handled by Workers Assets (serves index.html for SPA routing)
  return c.notFound();
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledProtocolJobs(env, event.cron));
  },
};
