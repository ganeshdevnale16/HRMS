import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../config.js';
import { ah, HttpError } from '../middleware/http.js';
import { parseResume } from '../lib/resume.js';
import { ingest } from './sources/ingest.service.js';

/**
 * Public careers page: candidates apply directly (free, unlimited, works today).
 * Every open requirement gets a link: /apply/<requirement code>. No login.
 */
export const publicRoutes = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_RESUME_MB * 1024 * 1024, files: 1 } });
const job = (r: any) => ({ code: r.code, position: r.position, location: r.location, workMode: r.workMode, expMin: r.expMin, expMax: r.expMax, skills: r.skills, description: r.description, openings: r.openings });

publicRoutes.get('/jobs', ah(async (_req, res) => {
  res.json((await prisma.requirement.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' } })).map(job));
}));

publicRoutes.get('/jobs/:code', ah(async (req, res) => {
  const r = await prisma.requirement.findFirst({ where: { code: req.params.code, status: 'OPEN' } });
  if (!r) throw new HttpError(404, 'This job is no longer open');
  res.json(job(r));
}));

publicRoutes.post('/jobs/:code/apply', rateLimit({ windowMs: 60 * 60_000, limit: 20 }), upload.single('resume'), ah(async (req, res) => {
  const r = await prisma.requirement.findFirst({ where: { code: req.params.code, status: 'OPEN' } });
  if (!r) throw new HttpError(404, 'This job is no longer open');
  if (req.body.website) return res.json({ ok: true }); // honeypot: bots fill hidden fields
  const b = z.object({
    name: z.string().min(2).max(120), email: z.string().email(), phone: z.string().min(8).max(20), location: z.string().max(80).optional(),
    expYears: z.string().optional(), currentCtc: z.string().optional(), expectedCtc: z.string().optional(), noticeDays: z.string().optional(),
    consent: z.literal('true', { errorMap: () => ({ message: 'Please accept the privacy notice to apply' }) }),
  }).parse(req.body);
  if (!req.file) throw new HttpError(400, 'Attach your resume (PDF or DOCX)');

  let parsed: Record<string, unknown> = {}, text = '';
  try { const p = await parseResume(req.file.buffer, req.file.originalname, req.file.mimetype); parsed = p.fields; text = p.text; }
  catch (e: any) { throw new HttpError(400, `We couldn't read your resume: ${e.message}`); }

  let src = await prisma.dataSource.findFirst({ where: { connector: 'careers' } });
  if (!src) src = await prisma.dataSource.create({ data: { name: 'Careers page', connector: 'careers', mapping: {} } });
  const { consent, ...form } = b;
  const record = { ...parsed, ...Object.fromEntries(Object.entries(form).filter(([, v]) => v)), __resume: { name: req.file.originalname, mime: req.file.mimetype, data: req.file.buffer, text } };
  const out = await ingest({ ...src, mapping: {} }, [record], { requirementId: r.id });
  if (out.rejected) throw new HttpError(400, 'We could not process your application. Check your details and try again.');
  res.json({ ok: true });
}));
