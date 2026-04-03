import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import path from 'path';
import logger from './middleware/logger.js';
import authMiddleware from './middleware/auth.js';
import supabase from './db.js';
import actionsRouter from './routes/actions.js';
import transcriptsRouter from './routes/transcripts.js';
import membersRouter from './routes/members.js';
import viewsRouter from './routes/views.js';
import activityRouter from './routes/activity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
const HOST = process.env.HOST || '127.0.0.1';
const PORT = process.env.PORT || 3001;
const TUNNEL_DOMAIN = process.env.TUNNEL_DOMAIN || '';
const extraOrigins = (process.env.ATLAS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

function isLoopbackAddress(value) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value);
}

function isLocalRequest(req) {
  const hasProxyHeaders = Boolean(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']);
  return !hasProxyHeaders && isLoopbackAddress(req.socket.remoteAddress);
}

function isLoopbackProxy(req) {
  return isLoopbackAddress(req.socket.remoteAddress);
}

// --- Trust proxy (Cloudflare Tunnel) ---
app.set('trust proxy', 'loopback');

app.use(logger);

// --- Security Middleware ---

app.use(helmet({
  contentSecurityPolicy: isProduction ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    }
  } : false,
  crossOriginEmbedderPolicy: isProduction,
  crossOriginResourcePolicy: isProduction ? { policy: 'same-origin' } : false,
}));

// --- CORS ---
const allowedOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOriginPattern.test(origin)) return callback(null, true);
    if (TUNNEL_DOMAIN && origin === `https://${TUNNEL_DOMAIN}`) return callback(null, true);
    if (extraOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS: origin not allowed'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Rate Limiting (keyed on real IP behind tunnel) ---
const keyGenerator = (req) => {
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp && isLoopbackProxy(req)) return cfIp;
  return req.ip;
};

// cf-connecting-ip is already normalized by Cloudflare; disable IPv6 key-gen warning
const validate = { keyGeneratorIpFallback: false };

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  validate,
  message: { error: 'Too many requests. Try again later.' },
});

const mutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  validate,
  message: { error: 'Too many write requests. Try again later.' },
});

app.use('/api', (req, res, next) => {
  if (isLocalRequest(req)) return next();
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    return mutationLimiter(req, res, next);
  }
  next();
});
app.use('/api', (req, res, next) => {
  if (isLocalRequest(req)) return next();
  return generalLimiter(req, res, next);
});

// --- Authentication ---
app.use('/api', authMiddleware);

// --- Body Parsing ---
app.use(express.json({ limit: '1mb' }));

// --- Routes ---
app.use('/api/actions', actionsRouter);
app.use('/api/transcripts', transcriptsRouter);
app.use('/api/members', membersRouter);
app.use('/api/views', viewsRouter);
app.use('/api/activity', activityRouter);

// Config — dynamic businesses list from DB
app.get('/api/config/businesses', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('atlas_config')
      .select('value')
      .eq('key', 'businesses')
      .single();

    if (error || !data) return res.json([]);

    const parsed = data.value;
    return res.json(Array.isArray(parsed) ? parsed : []);
  } catch (err) {
    console.error(`[config] GET businesses error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/config/businesses', async (req, res) => {
  try {
    const businesses = req.body;
    if (!Array.isArray(businesses)) return res.status(400).json({ error: 'Expected array' });

    const { error } = await supabase
      .from('atlas_config')
      .upsert({ key: 'businesses', value: businesses });
    if (error) throw error;

    res.json(businesses);
  } catch (err) {
    console.error(`[config] PUT businesses error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Static Frontend (production) ---
if (isProduction) {
  app.use(express.static(path.join(__dirname, '..', 'dist')));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  if (typeof err?.message === 'string' && err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: err.message });
  }

  console.error(`[server] Unhandled error: ${err?.message || err}`);
  return res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`\n  ATLAS Action Tracker API`);
  console.log(`  http://${HOST}:${PORT}`);
  if (TUNNEL_DOMAIN) console.log(`  Tunnel: https://${TUNNEL_DOMAIN}`);
  console.log();
});
