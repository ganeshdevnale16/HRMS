import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { prisma } from '../db.js';
import { ah } from '../middleware/http.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { env } from '../config.js';
import { suggestInterviewers } from './scheduling/scheduler.service.js';

export const interviewerRoutes = Router();

const time = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM');
const Body = z.object({
  name: z.string().min(1), email: z.string().email(), title: z.string().optional().nullable(), department: z.string().optional().nullable(),
  skills: z.array(z.string()).default([]), rounds: z.array(z.string()).default([]),
  timezone: z.string().default('Asia/Kolkata'), workStart: time.default('10:00'), workEnd: time.default('19:00'),
  workDays: z.array(z.number().int().min(1).max(7)).default([1, 2, 3, 4, 5]),
  maxPerDay: z.coerce.number().int().min(1).max(12).default(4), maxPerWeek: z.coerce.number().int().min(1).max(50).default(12),
  bufferMins: z.coerce.number().int().min(0).max(120).default(15),
  calendarProvider: z.enum(['OUTLOOK', 'GOOGLE', 'NONE']).default('NONE'),
  meetingProvider: z.enum(['TEAMS', 'ZOOM', 'GOOGLE_MEET', 'WEBEX', 'JITSI', 'TEAMS_MANUAL', 'LINK', 'IN_PERSON', 'PHONE']).default('TEAMS'),
  active: z.boolean().default(true), userId: z.string().optional().nullable(),
});

interviewerRoutes.get('/', ah(async (_req, res) => {
  const list = await prisma.interviewer.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  const weekStart = DateTime.now().setZone(env.DEFAULT_TIMEZONE).startOf('week');
  const counts = await prisma.interviewPanelist.groupBy({
    by: ['interviewerId'], _count: { _all: true },
    where: { interview: { status: { not: 'CANCELLED' }, startAt: { gte: weekStart.toJSDate(), lt: weekStart.plus({ weeks: 1 }).toJSDate() } } },
  });
  const pending = await prisma.interviewPanelist.groupBy({
    by: ['interviewerId'], _count: { _all: true },
    where: { submittedAt: null, interview: { status: { in: ['COMPLETED', 'SCHEDULED', 'CONFIRMED'] }, endAt: { lt: new Date() } } },
  });
  const m = new Map(counts.map((c) => [c.interviewerId, c._count._all]));
  const p = new Map(pending.map((c) => [c.interviewerId, c._count._all]));
  res.json(list.map((i) => ({ ...i, thisWeek: m.get(i.id) ?? 0, feedbackPending: p.get(i.id) ?? 0 })));
}));

interviewerRoutes.get('/suggest', ah(async (req, res) => {
  const q = z.object({ requirementId: z.string(), round: z.string().optional() }).parse(req.query);
  res.json(await suggestInterviewers(q.requirementId, q.round));
}));

interviewerRoutes.get('/:id', ah(async (req, res) => {
  const i = await prisma.interviewer.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { panels: { take: 50, orderBy: { interview: { startAt: 'desc' } }, include: { interview: { include: { candidate: { select: { id: true, name: true } }, requirement: { select: { code: true, position: true } } } } } } },
  });
  res.json(i);
}));

interviewerRoutes.post('/', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = Body.parse(req.body);
  const i = await prisma.interviewer.create({ data: { ...b, email: b.email.toLowerCase() } });
  await audit(req.user!.id, 'interviewer.create', 'Interviewer', i.id);
  res.status(201).json(i);
}));

interviewerRoutes.patch('/:id', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = Body.partial().parse(req.body);
  const i = await prisma.interviewer.update({ where: { id: req.params.id }, data: { ...b, ...(b.email ? { email: b.email.toLowerCase() } : {}) } });
  await audit(req.user!.id, 'interviewer.update', 'Interviewer', i.id);
  res.json(i);
}));

/** Interviewers are deactivated, never deleted, so past interview records stay intact. */
interviewerRoutes.delete('/:id', requireRole('RECRUITER'), ah(async (req, res) => {
  const i = await prisma.interviewer.update({ where: { id: req.params.id }, data: { active: false } });
  await audit(req.user!.id, 'interviewer.deactivate', 'Interviewer', i.id);
  res.json(i);
}));
