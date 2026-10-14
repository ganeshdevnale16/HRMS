import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah, HttpError } from '../middleware/http.js';
import { requireRole } from '../middleware/auth.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';
import { clearAiCache, complete, getAiSettings } from './ai/ai.service.js';
import { DEFAULT_MODELS } from './ai/providers.js';
import { FEATURES, PROVIDERS, PROVIDER_LABEL, fromLegacy, isConfigured, resolve, type AiSettings, type RealProvider } from './ai/settings.js';

import { clearMailCache, createTransport, getMailConfig, sendMail, type MailConfig } from '../lib/mailer.js';
import { integrations } from '../config.js';

export const settingsRoutes = Router();

/** Only what's stored in the app (not .env), so saving never copies .env secrets into the database. */
async function stored(): Promise<AiSettings> {
  const v2 = await prisma.setting.findUnique({ where: { key: 'ai.v2' } });
  if (v2) return decrypt<AiSettings>(v2.valueEnc)!;
  const v1 = await prisma.setting.findUnique({ where: { key: 'ai' } });
  return v1 ? fromLegacy(decrypt(v1.valueEnc)!) : { active: 'none', features: {}, providers: {} };
}
async function save(s: AiSettings) {
  await prisma.setting.upsert({ where: { key: 'ai.v2' }, create: { key: 'ai.v2', valueEnc: encrypt(s) }, update: { valueEnc: encrypt(s) } });
  await prisma.setting.deleteMany({ where: { key: 'ai' } });
  clearAiCache();
}
const Provider = z.enum(PROVIDERS as [RealProvider, ...RealProvider[]]);

/** For every signed-in user: which AI is connected and which one each feature uses (no keys). */
settingsRoutes.get('/ai/status', ah(async (_req, res) => {
  const s = await getAiSettings();
  res.json({
    connected: PROVIDERS.filter((p) => isConfigured(p, s.providers[p])).map((p) => ({ id: p, label: PROVIDER_LABEL[p], model: s.providers[p]?.model || DEFAULT_MODELS[p] || s.providers[p]?.azureDeployment })),
    inUse: Object.fromEntries(FEATURES.map((f) => { const r = resolve(s, f.id); return [f.id, r.provider === 'none' ? null : { provider: r.provider, label: r.label, model: r.model }]; })),
  });
}));

/** Everything the AI settings screen needs. Keys are write-only: only the last 4 characters are shown. */
settingsRoutes.get('/ai', requireRole('ADMIN'), ah(async (_req, res) => {
  const s = await getAiSettings();
  res.json({
    active: s.active, features: s.features,
    featureList: FEATURES,
    providers: PROVIDERS.map((p) => {
      const c = s.providers[p] ?? {};
      return { id: p, label: PROVIDER_LABEL[p], connected: isConfigured(p, c), source: c.source ?? null, keyHint: c.apiKey ? `…${c.apiKey.slice(-4)}` : '',
        model: c.model ?? '', defaultModel: DEFAULT_MODELS[p], baseUrl: c.baseUrl ?? '', azureEndpoint: c.azureEndpoint ?? '', azureDeployment: c.azureDeployment ?? '', azureApiVersion: c.azureApiVersion ?? '' };
    }),
    inUse: Object.fromEntries(FEATURES.map((f) => { const r = resolve(s, f.id); return [f.id, r.provider === 'none' ? null : { provider: r.provider, label: r.label, model: r.model, reason: r.reason }]; })),
  });
}));

const Creds = z.object({ apiKey: z.string().optional(), model: z.string().optional(), baseUrl: z.string().optional(), azureEndpoint: z.string().optional(), azureDeployment: z.string().optional(), azureApiVersion: z.string().optional() });

/** Save one provider's key/model. Blank key keeps the saved one. */
settingsRoutes.put('/ai/providers/:id', requireRole('ADMIN'), ah(async (req, res) => {
  const p = Provider.parse(req.params.id);
  const b = Creds.parse(req.body);
  const s = await stored();
  const cur = s.providers[p] ?? {};
  const next = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && !(k === 'apiKey' && !v))) };
  if (!next.apiKey) { const live = (await getAiSettings()).providers[p]; if (live?.apiKey) next.apiKey = live.apiKey; }
  s.providers[p] = next;
  if (s.active === 'none' && isConfigured(p, next)) s.active = p;
  await save(s);
  await audit(req.user!.id, 'settings.ai.provider', 'Setting', p, { model: next.model });
  res.json({ ok: true });
}));

settingsRoutes.delete('/ai/providers/:id', requireRole('ADMIN'), ah(async (req, res) => {
  const p = Provider.parse(req.params.id);
  const s = await stored();
  delete s.providers[p];
  if (s.active === p) s.active = (PROVIDERS.find((x) => isConfigured(x, s.providers[x])) ?? 'none');
  for (const f of Object.keys(s.features) as (keyof AiSettings['features'])[]) if (s.features[f] === p) s.features[f] = '';
  await save(s);
  await audit(req.user!.id, 'settings.ai.provider.remove', 'Setting', p);
  res.json({ ok: true });
}));

/** Default provider + per-feature routing. */
settingsRoutes.put('/ai/routing', requireRole('ADMIN'), ah(async (req, res) => {
  const b = z.object({ active: z.enum(['openai', 'anthropic', 'gemini', 'azure', 'none']), features: z.record(z.enum(['parsing', 'screening', 'interviews', 'general']), z.union([Provider, z.literal('')])).default({}) }).parse(req.body);
  const live = await getAiSettings();
  const bad = [b.active, ...Object.values(b.features)].filter((p) => p && p !== 'none' && !isConfigured(p as RealProvider, live.providers[p as RealProvider]));
  if (bad.length) throw new HttpError(400, `${bad.map((p) => PROVIDER_LABEL[p as RealProvider]).join(', ')} is not connected yet. Add its key first.`);
  const s = await stored();
  s.active = b.active; s.features = b.features;
  await save(s);
  await audit(req.user!.id, 'settings.ai.routing', 'Setting', 'ai', b);
  res.json({ ok: true });
}));

/** Test a provider with the saved key, or with a key typed but not yet saved. */
settingsRoutes.post('/ai/test', requireRole('ADMIN'), ah(async (req, res) => {
  const b = Creds.extend({ provider: Provider }).parse(req.body);
  const live = (await getAiSettings()).providers[b.provider] ?? {};
  const cfg = { ...live, ...Object.fromEntries(Object.entries(b).filter(([k, v]) => v && !(k === 'provider'))), provider: b.provider } as any;
  cfg.model = cfg.model || DEFAULT_MODELS[b.provider];
  try {
    const t = await complete('You are a connectivity check.', 'Reply with the single word: OK', false, cfg);
    res.json({ ok: true, message: `${PROVIDER_LABEL[b.provider]} works (${cfg.model || cfg.azureDeployment}). Reply: ${t.trim().slice(0, 40)}` });
  } catch (e: any) { res.json({ ok: false, message: e.message }); }
}));

/* ---------------- Email (outgoing) ---------------- */

export const MAIL_PRESETS = [
  { id: 'brevo-api', label: 'Brevo API — recommended for free hosting', provider: 'brevo', link: 'https://app.brevo.com/settings/keys/api', linkText: 'Create a Brevo API key',
    note: 'Free 300 emails/day. Sends over HTTPS, so it works on Render’s free plan (which blocks SMTP). Also verify your “From” address under Brevo → Senders.' },
  { id: 'gmail', label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 465, secure: true, link: 'https://myaccount.google.com/apppasswords', linkText: 'Create a Gmail App Password',
    note: 'Needs 2-Step Verification on. The App Passwords page is not listed in the 2-Step menu any more — open the link directly. Not available on Render’s free plan (SMTP blocked); works locally and on paid hosting.' },
  { id: 'outlook', label: 'Microsoft 365 / Outlook (SMTP)', host: 'smtp.office365.com', port: 587, secure: false, link: 'https://learn.microsoft.com/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission', linkText: 'Microsoft: enable SMTP AUTH',
    note: 'SMTP AUTH must be allowed for the mailbox. If your IT blocks it, use “Microsoft 365 (Graph)”.' },
  { id: 'graph', label: 'Microsoft 365 (Graph, no password)', provider: 'graph', link: 'https://learn.microsoft.com/graph/api/user-sendmail', linkText: 'Microsoft Graph sendMail',
    note: 'Uses the Azure app from Teams. Add the Mail.Send application permission with admin consent. Recommended for company tenants; works on free hosting (HTTPS).' },
  { id: 'zoho', label: 'Zoho Mail (India)', host: 'smtp.zoho.in', port: 465, secure: true, link: 'https://accounts.zoho.in/home#security/app_password', linkText: 'Create a Zoho app password', note: 'Use an app-specific password if 2FA is on.' },
  { id: 'brevo', label: 'Brevo (SMTP)', host: 'smtp-relay.brevo.com', port: 587, secure: false, link: 'https://app.brevo.com/settings/keys/smtp', linkText: 'Brevo SMTP keys', note: 'Use “Brevo API” instead on Render’s free plan.' },
  { id: 'sendgrid', label: 'SendGrid', host: 'smtp.sendgrid.net', port: 587, secure: false, link: 'https://app.sendgrid.com/settings/api_keys', linkText: 'SendGrid API keys', note: 'Username is literally "apikey"; password is your API key.' },
  { id: 'ses', label: 'Amazon SES', host: 'email-smtp.ap-south-1.amazonaws.com', port: 587, secure: false, link: 'https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html', linkText: 'SES SMTP credentials', note: 'Use SES SMTP credentials (not your AWS keys).' },
  { id: 'custom', label: 'Other SMTP server', host: '', port: 587, secure: false, note: '' },
];

settingsRoutes.get('/email', requireRole('ADMIN'), ah(async (_req, res) => {
  const c = await getMailConfig();
  res.json({ provider: c.provider, host: c.host ?? '', port: c.port ?? 587, secure: !!c.secure, user: c.user ?? '', fromEmail: c.fromEmail ?? '', fromName: c.fromName ?? '', replyTo: c.replyTo ?? '',
    hasPassword: !!c.password, hasApiKey: !!c.apiKey, source: c.source ?? null, presets: MAIL_PRESETS, graphReady: integrations.outlookCalendar });
}));

const MailBody = z.object({
  provider: z.enum(['smtp', 'graph', 'brevo', 'none']), apiKey: z.string().optional(), host: z.string().optional(), port: z.coerce.number().int().min(1).max(65535).optional(), secure: z.boolean().optional(),
  user: z.string().optional(), password: z.string().optional(), fromEmail: z.string().email('Enter a valid "From" email').optional(), fromName: z.string().max(80).optional(), replyTo: z.string().email().optional().or(z.literal('')),
});
async function mergedMail(b: z.infer<typeof MailBody>): Promise<MailConfig> {
  const cur = await getMailConfig();
  const cfg: MailConfig = { ...b, password: b.password || (cur.provider === b.provider ? cur.password : undefined), apiKey: b.apiKey || (cur.provider === b.provider ? cur.apiKey : undefined), replyTo: b.replyTo || undefined };
  if (cfg.provider === 'brevo' && !cfg.apiKey) throw new HttpError(400, 'Paste your Brevo API key');
  if (cfg.provider === 'smtp' && !cfg.host) throw new HttpError(400, 'Enter the SMTP server');
  if (cfg.provider !== 'none' && !cfg.fromEmail) throw new HttpError(400, 'Enter the "From" email address');
  if (cfg.provider === 'graph' && !integrations.outlookCalendar) throw new HttpError(400, 'Microsoft Graph needs MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET in the server .env');
  return cfg;
}

settingsRoutes.put('/email', requireRole('ADMIN'), ah(async (req, res) => {
  const cfg = await mergedMail(MailBody.parse(req.body));
  await prisma.setting.upsert({ where: { key: 'email' }, create: { key: 'email', valueEnc: encrypt(cfg) }, update: { valueEnc: encrypt(cfg) } });
  clearMailCache();
  await audit(req.user!.id, 'settings.email', 'Setting', 'email', { provider: cfg.provider, host: cfg.host, fromEmail: cfg.fromEmail });
  res.json({ ok: true });
}));

/** Checks the login and sends a real test message — before or after saving. */
settingsRoutes.post('/email/test', requireRole('ADMIN'), ah(async (req, res) => {
  const { to, ...rest } = MailBody.extend({ to: z.string().email('Enter the address to send the test to') }).parse(req.body);
  try {
    const cfg = await mergedMail(rest);
    if (cfg.provider === 'smtp') await createTransport(cfg).verify();
    await sendMail({ to, subject: 'HRMS test email', html: '<p>Email from HRMS is working. Interview invites and candidate emails will be sent from this address.</p>', text: 'Email from HRMS is working.' }, cfg);
    res.json({ ok: true, message: `Test email sent to ${to}. Check the inbox (and spam folder).` });
  } catch (e: any) {
    const m = String(e.message ?? e);
    const hint = /Invalid login|535|Username and Password not accepted|BadCredentials/i.test(m) ? ' — wrong username or password. Gmail/Zoho need an App Password, not your normal password.'
      : /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timeout/i.test(m) ? ' — cannot reach the server. Check host and port (465 = SSL on, 587 = SSL off).'
      : /SmtpClientAuthentication|disabled for the Tenant/i.test(m) ? ' — SMTP is disabled for this Microsoft 365 tenant. Use "Microsoft 365 (Graph)".' : '';
    res.json({ ok: false, message: m + hint });
  }
}));

settingsRoutes.delete('/email', requireRole('ADMIN'), ah(async (req, res) => {
  await prisma.setting.deleteMany({ where: { key: 'email' } });
  clearMailCache();
  await audit(req.user!.id, 'settings.email.reset', 'Setting', 'email');
  res.json({ ok: true });
}));
