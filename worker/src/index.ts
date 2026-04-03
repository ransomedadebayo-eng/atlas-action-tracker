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

const app = new Hono<{ Bindings: Env }>();

// CORS — same-origin in production (Workers Assets serves frontend from same domain)
app.use('/api/*', cors({
  origin: ['https://atlas.ransomed.app', 'http://localhost:5173', 'http://localhost:4173'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-atlas-actor'],
  credentials: true,
}));

// Health checks (unauthenticated)
app.get('/health', (c) => c.json({ status: 'ok' }));
app.get('/api/health', (c) => c.json({ status: 'ok' }));

// Auth on all /api/* routes
app.use('/api/*', authMiddleware);

// Routes
app.route('/api/actions', actionsRouter);
app.route('/api/members', membersRouter);
app.route('/api/transcripts', transcriptsRouter);
app.route('/api/views', viewsRouter);
app.route('/api/activity', activityRouter);
app.route('/api/config', configRouter);

// 404 fallback for unmatched /api routes
app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'Not found' }, 404);
  }
  // Non-API 404s are handled by Workers Assets (serves index.html for SPA routing)
  return c.notFound();
});

export default app;
