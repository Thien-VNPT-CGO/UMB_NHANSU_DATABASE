import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { env, devAuthEnabled, firebaseWebConfig } from './env';
import {
  accessLogin,
  authMiddleware,
  authModeSummary,
  devLoginPayload,
  firebaseAdminStatus,
  googleLogin,
  initFirebaseAdmin,
} from './auth';
import { hasDatabase, closeDb } from './db/client';
import { apiRouter } from './routes/api';
import { zaloRouter } from './routes/zalo';
import { webhookRouter } from './routes/webhooks';
import { errorPayload } from './errors';
import { startWorkers, stopWorkers } from './services/worker';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors({ origin: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

/* ------------------------------------------------------- public endpoints */

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'HaraSocial Zalo Alert',
    version: '1.0.0',
    time: new Date().toISOString(),
    databaseConfigured: hasDatabase(),
    firebaseReady: firebaseAdminStatus().ready,
    devAuth: devAuthEnabled(),
    authModes: authModeSummary(),
  });
});

app.get('/api/public-config', (_req, res) => {
  const admin = firebaseAdminStatus();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    app: 'HaraSocial Zalo Alert',
    version: '1.0.0',
    firebase: firebaseWebConfig(),
    googleClientId: env.googleOAuthClientId || null,
    auth: authModeSummary(),
    firebaseAdminReady: admin.ready,
    authError: admin.error,
    devAuthEnabled: devAuthEnabled(),
    databaseConfigured: hasDatabase(),
    serverNow: new Date().toISOString(),
  });
});

app.post('/api/auth/dev', (_req, res) => {
  const payload = devLoginPayload();
  if (!payload) {
    res.status(404).json({ error: 'Dev auth đã tắt.' });
    return;
  }
  res.json(payload);
});

app.post('/api/auth/access', (req, res) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const payload = accessLogin(String(req.body?.code || ''), ip);
    res.json(payload);
  } catch (e) {
    const error = e as { status?: number; code?: string; message?: string };
    res.status(error.status || 400).json({ error: error.message || 'Đăng nhập thất bại.', code: error.code || 'AUTH_ERROR' });
  }
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const payload = await googleLogin(String(req.body?.credential || ''));
    res.json(payload);
  } catch (e) {
    const error = e as { status?: number; code?: string; message?: string };
    res.status(error.status || 401).json({ error: error.message || 'Đăng nhập Google thất bại.', code: error.code || 'AUTH_ERROR' });
  }
});

/* ----------------------------------------- webhook công khai (CORS mở) */

app.use('/api/webhooks', webhookRouter);

/* --------------------------------------------------- API cần đăng nhập */

app.use('/api', authMiddleware);
app.use('/api', apiRouter);
app.use('/api', zaloRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Không tìm thấy API.', code: 'NOT_FOUND' });
});

/* ------------------------------------------------------------- frontend */

if (env.nodeEnv === 'production') {
  const clientDir = path.resolve(dirname, '../client');
  app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

/* ---------------------------------------------------------------- errors */

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const payload = errorPayload(err);
  const status = typeof err?.status === 'number' ? err.status : 500;
  if (status >= 500) console.error('[api]', err);
  res.status(status).json(payload);
});

const server = app.listen(env.port, () => {
  initFirebaseAdmin();
  startWorkers();
  console.log(`[harasocial] http://localhost:${env.port} (${env.nodeEnv})`);
  console.log(`[harasocial] database: ${hasDatabase() ? 'configured' : 'NOT CONFIGURED'}`);
  console.log(`[harasocial] firebase admin: ${firebaseAdminStatus().ready ? 'ready' : 'not ready'}`);
  console.log(`[harasocial] auth modes: ${JSON.stringify(authModeSummary())}`);
});

async function shutdown(signal: string) {
  console.log(`[harasocial] ${signal} — shutting down`);
  stopWorkers();
  server.close(() => {
    void closeDb().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
