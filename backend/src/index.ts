import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config.js';
import { errorHandler } from './middleware/http.js';
import { requireAuth } from './middleware/auth.js';
import { authRoutes } from './modules/auth.routes.js';
import { requirementRoutes } from './modules/requirements.routes.js';
import { candidateRoutes } from './modules/candidates.routes.js';
import { interviewerRoutes } from './modules/interviewers.routes.js';
import { interviewRoutes } from './modules/interviews.routes.js';
import { sourceRoutes, webhookRoutes } from './modules/sources/sources.routes.js';
import { integrationRoutes } from './modules/integrations.routes.js';
import { dashboardRoutes } from './modules/dashboard.routes.js';
import { settingsRoutes } from './modules/settings.routes.js';
import { publicRoutes } from './modules/public.routes.js';
import { emailRoutes } from './modules/email.routes.js';
import { runDueSyncs, startInProcessScheduler } from './modules/sources/scheduler.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: { directives: { 'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], 'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'] } },
}));
// APP_URL may list several origins, comma-separated (e.g. Vercel site + custom domain + localhost).
const origins = env.APP_URL.split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors({ origin: (o, cb) => cb(null, !o || origins.includes(o.replace(/\/$/, '')) || /^https:\/\/[\w-]+(-[\w-]+)*\.vercel\.app$/.test(o) && origins.some((x) => x.endsWith('.vercel.app'))), credentials: true }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Webhooks need the raw body for signature checks, so they are mounted before the JSON parser.
app.use('/api/webhooks', rateLimit({ windowMs: 60_000, limit: 600 }), webhookRoutes);
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Called by a free external scheduler (cron-job.org, GitHub Actions) to run due syncs and keep a free server warm.
app.post('/api/cron/run', async (req, res, next) => {
  try {
    if (!env.CRON_SECRET || req.headers['x-cron-secret'] !== env.CRON_SECRET) return res.status(401).json({ error: 'Invalid cron secret' });
    res.json(await runDueSyncs());
  } catch (e) { next(e); }
});
if (env.PUBLIC_CAREERS) app.use('/api/public', publicRoutes); // public careers page is off unless PUBLIC_CAREERS=true
app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: 50 }), authRoutes);
app.use('/api', requireAuth, rateLimit({ windowMs: 60_000, limit: 600 }));
app.use('/api/requirements', requirementRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/interviewers', interviewerRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/sources', sourceRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/email', emailRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// One-service deployment (free): the API also serves the built frontend.
if (env.SERVE_WEB) {
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
  app.use(express.static(web, { maxAge: '1h', index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(web, 'index.html')));
}
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.info(`HRMS API on http://localhost:${env.PORT}`);
  startInProcessScheduler();
});
