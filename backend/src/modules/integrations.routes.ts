import { Router } from 'express';
import { z } from 'zod';
import { env, integrations } from '../config.js';
import { ah } from '../middleware/http.js';
import { requireRole } from '../middleware/auth.js';
import { meetingProviders } from './scheduling/providers/index.js';
import { graph } from './scheduling/providers/msgraph.js';
import { gcal } from './scheduling/providers/google.js';
import { getMailConfig, sendMail } from '../lib/mailer.js';
import { getAiConfig } from './ai/ai.service.js';

export const integrationRoutes = Router();

integrationRoutes.get('/', ah(async (_req, res) => {
  const aic = await getAiConfig();
  const mc = await getMailConfig();
  res.json({
    meeting: Object.values(meetingProviders).map((p) => ({ id: p.id, label: p.label, configured: p.isConfigured() })),
    calendar: [
      { id: 'OUTLOOK', label: 'Outlook / Microsoft 365 calendar', configured: integrations.outlookCalendar && !!env.MS_ORGANIZER_UPN },
      { id: 'GOOGLE', label: 'Google calendar', configured: integrations.googleCalendar && !!env.GOOGLE_ORGANIZER_EMAIL },
    ],
    email: { configured: mc.provider !== 'none', provider: mc.provider, from: mc.fromEmail ? `${mc.fromName ?? ''} <${mc.fromEmail}>` : '' },
    ai: { configured: aic.provider !== 'none' && !!aic.apiKey, provider: aic.provider, model: aic.model, label: aic.label },
    timezone: env.DEFAULT_TIMEZONE,
  });
}));

integrationRoutes.post('/test', requireRole('ADMIN'), ah(async (req, res) => {
  const { id, to } = z.object({ id: z.string(), to: z.string().email().optional() }).parse(req.body);
  try {
    if (id in meetingProviders) return res.json({ ok: true, message: await (meetingProviders as any)[id].test() });
    if (id === 'OUTLOOK') { await graph('GET', `/users/${encodeURIComponent(env.MS_ORGANIZER_UPN!)}/calendar?$select=id`); return res.json({ ok: true, message: 'Calendar availability can be read.' }); }
    if (id === 'GOOGLE') { await gcal(env.GOOGLE_ORGANIZER_EMAIL!, 'GET', `/calendars/${encodeURIComponent(env.GOOGLE_ORGANIZER_EMAIL!)}`); return res.json({ ok: true, message: 'Calendar availability can be read.' }); }
    if (id === 'EMAIL') { const r = await sendMail({ to: to ?? req.user!.email, subject: 'HRMS test email', html: '<p>Email delivery is working.</p>' }); return res.json({ ok: r.delivered, message: r.delivered ? `Test email sent to ${to ?? req.user!.email}.` : 'SMTP is not configured.' }); }
    res.json({ ok: false, message: 'Unknown integration' });
  } catch (e: any) { res.json({ ok: false, message: e.message }); }
}));
