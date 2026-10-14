import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah } from '../middleware/http.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { ai } from './ai/ai.service.js';

export const requirementRoutes = Router();

const Body = z.object({
  client: z.string().min(1), position: z.string().min(1), openings: z.coerce.number().int().min(1),
  expMin: z.coerce.number().min(0), expMax: z.coerce.number().min(0), skills: z.array(z.string().min(1)).min(1),
  location: z.string().min(1), workMode: z.enum(['HYBRID', 'ONSITE', 'REMOTE']), ctcMin: z.coerce.number(), ctcMax: z.coerce.number(),
  noticeMax: z.coerce.number().int(), priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  recruiterId: z.string().optional().nullable(), targetDate: z.coerce.date().optional().nullable(),
  status: z.enum(['OPEN', 'ON_HOLD', 'CLOSED']).optional(), description: z.string().optional().nullable(),
});

requirementRoutes.get('/', ah(async (_req, res) => {
  const reqs = await prisma.requirement.findMany({ orderBy: { createdAt: 'desc' }, include: { recruiter: { select: { id: true, name: true } }, _count: { select: { candidates: true } } } });
  res.json(reqs);
}));

requirementRoutes.get('/:id', ah(async (req, res) => {
  res.json(await prisma.requirement.findUniqueOrThrow({ where: { id: req.params.id }, include: { recruiter: { select: { id: true, name: true } } } }));
}));

requirementRoutes.post('/', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = Body.parse(req.body);
  const count = await prisma.requirement.count();
  const r = await prisma.requirement.create({ data: { ...b, code: `R-${String(1001 + count).padStart(4, '0')}`, recruiterId: b.recruiterId ?? req.user!.id } });
  await audit(req.user!.id, 'requirement.create', 'Requirement', r.id);
  res.status(201).json(r);
}));

requirementRoutes.patch('/:id', requireRole('RECRUITER'), ah(async (req, res) => {
  const r = await prisma.requirement.update({ where: { id: req.params.id }, data: Body.partial().parse(req.body) });
  await audit(req.user!.id, 'requirement.update', 'Requirement', r.id);
  res.json(r);
}));

requirementRoutes.post('/ai/extract', requireRole('RECRUITER'), ah(async (req, res) => {
  const { jd } = z.object({ jd: z.string().min(30, 'Paste the full job description') }).parse(req.body);
  res.json(await ai.extractJd(jd, { userId: req.user!.id }));
}));
