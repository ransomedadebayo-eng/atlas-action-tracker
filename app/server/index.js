import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import path from 'path';
import logger from './middleware/logger.js';
import authMiddleware from './middleware/auth.js';
import db from './db.js';
import actionsRouter from './routes/actions.js';
import transcriptsRouter from './routes/transcripts.js';
import membersRouter from './routes/members.js';
import viewsRouter from './routes/views.js';
import activityRouter from './routes/activity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
const PORT = process.env.PORT || 3001;
const TUNNEL_DOMAIN = process.env.TUNNEL_DOMAIN || '';

// --- Trust proxy (Cloudflare Tunnel) ---
app.set('trust proxy', 1);

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
const allowedOriginPattern = /^http:\/\/(localhost|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$/;
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOriginPattern.test(origin)) return callback(null, true);
    if (TUNNEL_DOMAIN && origin === `https://${TUNNEL_DOMAIN}`) return callback(null, true);
    return callback(new Error('CORS: origin not allowed'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

// --- Block .db file requests ---
app.use((req, res, next) => {
  if (req.path.match(/\.db($|\?)/i)) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
});

// --- Rate Limiting (keyed on real IP behind tunnel) ---
const keyGenerator = (req) => {
  // Cloudflare sets cf-connecting-ip to the real client IP
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp) return cfIp;
  // Fallback to Express req.ip (respects trust proxy)
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
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    return mutationLimiter(req, res, next);
  }
  next();
});
app.use('/api', generalLimiter);

// --- Authentication ---
app.use('/api', authMiddleware);

// --- Body Parsing ---
app.use(express.json({ limit: '1mb' }));
app.use(logger);

// --- Routes ---
app.use('/api/actions', actionsRouter);
app.use('/api/transcripts', transcriptsRouter);
app.use('/api/members', membersRouter);
app.use('/api/views', viewsRouter);
app.use('/api/activity', activityRouter);

// Config — dynamic businesses list from DB
app.get('/api/config/businesses', (req, res) => {
  try {
    const row = db.prepare("SELECT value FROM config WHERE key = 'businesses'").get();
    res.json(row ? JSON.parse(row.value) : []);
  } catch (err) {
    console.error(`[config] GET businesses error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/config/businesses', (req, res) => {
  try {
    const businesses = req.body;
    if (!Array.isArray(businesses)) return res.status(400).json({ error: 'Expected array' });
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('businesses', ?)").run(JSON.stringify(businesses));
    res.json(businesses);
  } catch (err) {
    console.error(`[config] PUT businesses error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Static Frontend (production) ---
if (isProduction) {
  app.use(express.static(path.join(__dirname, '..', 'dist')));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`\n  ATLAS Action Tracker API`);
  console.log(`  http://localhost:${PORT}`);
  if (TUNNEL_DOMAIN) console.log(`  Tunnel: https://${TUNNEL_DOMAIN}`);
  console.log();
});
