import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah, HttpError } from '../middleware/http.js';
import { requireRole } from '../middleware/auth.js';
import { activity, audit } from '../lib/audit.js';
import { getMailConfig, sendMail } from '../lib/mailer.js';
import { BUILT_IN_TEMPLATES, render, textToHtml, TEMPLATE_VARS, type TemplateVars } from '../lib/template.js';

/** Emailing candidates from HRMS. Every message is logged on the candidate (Communication + timeline). */
export const emailRoutes = Router();

emailRoutes.get('/templates', ah(async (_req, res) => {
  const mc = await getMailConfig();
  res.json({ templates: BUILT_IN_TEMPLATES, variables: TEMPLATE_VARS, configured: mc.provider !== 'none', from: mc.fromEmail ? `${mc.fromName ?? ''} <${mc.fromEmail}>` : '' });
}));

async function varsFor(candidateId: string, userName: string): Promise<{ email: string | null; name: string; vars: TemplateVars }> {
  const c = await prisma.candidate.findUniqueOrThrow({ where: { id: candidateId }, include: { requirement: true } });
  const mc = await getMailConfig();
  return { email: c.email, name: c.name, vars: {
    firstName: c.name.split(/\s+/)[0], name: c.name, position: c.requirement?.position ?? 'the role', location: c.requirement?.location ?? c.location ?? '',
    workMode: c.requirement?.workMode ? c.requirement.workMode.charAt(0) + c.requirement.workMode.slice(1).toLowerCase() : '', recruiter: userName, companyName: mc.fromName ?? '' } };
}

emailRoutes.post('/preview', ah(async (req, res) => {
  const b = z.object({ candidateId: z.string(), subject: z.string(), body: z.string() }).parse(req.body);
  const v = await varsFor(b.candidateId, req.user!.name);
  res.json({ to: v.email, subject: render(b.subject, v.vars), body: render(b.body, v.vars) });
}));

/** Sends one personalised email per candidate (never one email to many people). Max 100 per request. */
emailRoutes.post('/send', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = z.object({ candidateIds: z.array(z.string()).min(1).max(100), subject: z.string().min(1, 'Add a subject').max(200), body: z.string().min(1, 'Write a message').max(20000), template: z.string().optional() }).parse(req.body);
  const mc = await getMailConfig();
  if (mc.provider === 'none') throw new HttpError(400, 'Email is not set up. An admin can connect it under Integrations → Email.');
  const results: { id: string; name: string; ok: boolean; error?: string }[] = [];
  for (const id of b.candidateIds) {
    const v = await varsFor(id, req.user!.name).catch(() => null);
    if (!v) { results.push({ id, name: '?', ok: false, error: 'Candidate not found' }); continue; }
    if (!v.email) { results.push({ id, name: v.name, ok: false, error: 'No email address' }); continue; }
    const subject = render(b.subject, v.vars), text = render(b.body, v.vars);
    try {
      const unfilled = [...`${subject} ${text}`.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
      if (unfilled.length) throw new Error(`Placeholder not filled: {{${unfilled[0]}}}`);
      await sendMail({ to: v.email, subject, text, html: textToHtml(text), replyTo: req.user!.email.includes('@') ? req.user!.email : undefined });
      await prisma.communication.create({ data: { candidateId: id, channel: 'EMAIL', outcome: 'Sent', notes: `Subject: ${subject}\n\n${text}`.slice(0, 5000), userId: req.user!.id } });
      await activity(id, 'communication', `Email sent: ${subject}`, req.user!.id);
      results.push({ id, name: v.name, ok: true });
    } catch (e: any) {
      await prisma.communication.create({ data: { candidateId: id, channel: 'EMAIL', outcome: 'Failed', notes: `Subject: ${subject}\nError: ${e.message}`.slice(0, 2000), userId: req.user!.id } }).catch(() => undefined);
      results.push({ id, name: v.name, ok: false, error: e.message });
    }
  }
  await audit(req.user!.id, 'email.send', 'Candidate', undefined, { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, template: b.template });
  res.json({ sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
}));
