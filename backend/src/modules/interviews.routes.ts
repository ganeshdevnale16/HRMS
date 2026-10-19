import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah, HttpError } from '../middleware/http.js';
import { requireRole } from '../middleware/auth.js';
import { activity, audit } from '../lib/audit.js';
import { ai } from './ai/ai.service.js';
import { cancelInterview, findSlots, rescheduleInterview, scheduleInterview, setMeetingLink } from './scheduling/scheduler.service.js';

export const interviewRoutes = Router();
const include = { candidate: { select: { id: true, name: true, email: true } }, requirement: { select: { id: true, code: true, client: true, position: true, skills: true } }, panel: { include: { interviewer: { select: { id: true, name: true, email: true } } } } };

interviewRoutes.get('/', ah(async (req, res) => {
  const q = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), interviewerId: z.string().optional(), status: z.string().optional(), candidateId: z.string().optional() }).parse(req.query);
  const where: any = {
    ...(q.from || q.to ? { startAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    ...(q.status ? { status: q.status } : {}), ...(q.candidateId ? { candidateId: q.candidateId } : {}),
    ...(q.interviewerId ? { panel: { some: { interviewerId: q.interviewerId } } } : {}),
  };
  if (req.user!.role === 'INTERVIEWER') {
    const me = await prisma.interviewer.findUnique({ where: { userId: req.user!.id } });
    where.panel = { some: { interviewerId: me?.id ?? '-' } };
  }
  res.json(await prisma.interview.findMany({ where, include, orderBy: { startAt: 'desc' }, take: 300 }));
}));

interviewRoutes.get('/:id', ah(async (req, res) => {
  res.json(await prisma.interview.findUniqueOrThrow({ where: { id: req.params.id }, include }));
}));

interviewRoutes.post('/slots', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = z.object({ interviewerIds: z.array(z.string()).min(1).max(6), durationMins: z.coerce.number().int().min(15).max(240), from: z.coerce.date(), to: z.coerce.date() }).parse(req.body);
  if (b.to.getTime() - b.from.getTime() > 21 * 864e5) throw new HttpError(400, 'Search at most three weeks at a time');
  res.json(await findSlots(b));
}));

interviewRoutes.post('/', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = z.object({
    candidateId: z.string(), round: z.string().min(1), interviewerIds: z.array(z.string()).min(1).max(6), start: z.coerce.date(),
    durationMins: z.coerce.number().int().min(15).max(240), provider: z.enum(['TEAMS', 'ZOOM', 'GOOGLE_MEET', 'WEBEX', 'JITSI', 'TEAMS_MANUAL', 'LINK', 'IN_PERSON', 'PHONE']),
    location: z.string().optional(), notes: z.string().optional(), force: z.boolean().optional(), timezone: z.string().optional(), meetingLink: z.string().optional(),
  }).parse(req.body);
  res.status(201).json(await scheduleInterview(b, req.user!.id));
}));

interviewRoutes.post('/:id/reschedule', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = z.object({ start: z.coerce.date(), durationMins: z.coerce.number().int().min(15).max(240), force: z.boolean().optional() }).parse(req.body);
  res.json(await rescheduleInterview(req.params.id, b.start, b.durationMins, b.force, req.user!.id));
}));

interviewRoutes.post('/:id/link', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = z.object({ url: z.string().nullable(), notify: z.boolean().default(false) }).parse(req.body);
  res.json(await setMeetingLink(req.params.id, b.url, b.notify, req.user!.id));
}));

interviewRoutes.post('/:id/cancel', requireRole('RECRUITER'), ah(async (req, res) => {
  const { reason } = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
  res.json(await cancelInterview(req.params.id, reason, req.user!.id));
}));

interviewRoutes.post('/:id/status', requireRole('RECRUITER', 'INTERVIEWER'), ah(async (req, res) => {
  const { status } = z.object({ status: z.enum(['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'NO_SHOW']) }).parse(req.body);
  const iv = await prisma.interview.update({ where: { id: req.params.id }, data: { status } });
  await activity(iv.candidateId, 'interview', `${iv.round} marked ${status.toLowerCase().replace('_', '-')}`, req.user!.id);
  res.json(iv);
}));

/** Each panelist submits their own scorecard. */
interviewRoutes.post('/:id/feedback', requireRole('RECRUITER', 'INTERVIEWER'), ah(async (req, res) => {
  const b = z.object({
    interviewerId: z.string(), feedback: z.string().min(10, 'Write at least a couple of sentences'),
    ratings: z.object({ technical: z.number().min(1).max(5), communication: z.number().min(1).max(5), roleFit: z.number().min(1).max(5) }).partial().optional(),
    recommendation: z.enum(['Hire', 'Next round', 'Hold', 'Reject']), analyse: z.boolean().optional(),
  }).parse(req.body);
  const iv = await prisma.interview.findUniqueOrThrow({ where: { id: req.params.id }, include: { requirement: true } });
  if (req.user!.role === 'INTERVIEWER') {
    const me = await prisma.interviewer.findUnique({ where: { userId: req.user!.id } });
    if (me?.id !== b.interviewerId) throw new HttpError(403, 'You can only submit your own feedback');
  }
  let aiAnalysis: any = undefined;
  if (b.analyse) {
    aiAnalysis = await ai.feedback({ position: iv.requirement.position, skills: iv.requirement.skills }, iv.round, b.feedback, { userId: req.user!.id }).catch((e) => ({ error: e.message }));
  }
  const p = await prisma.interviewPanelist.update({
    where: { interviewId_interviewerId: { interviewId: iv.id, interviewerId: b.interviewerId } },
    data: { feedback: b.feedback, ratings: b.ratings, recommendation: b.recommendation, submittedAt: new Date(), ...(aiAnalysis ? { aiAnalysis } : {}) },
    include: { interviewer: { select: { name: true } } },
  });
  if (iv.status !== 'COMPLETED') await prisma.interview.update({ where: { id: iv.id }, data: { status: 'COMPLETED' } });
  await activity(iv.candidateId, 'interview', `${iv.round} feedback from ${p.interviewer.name}: ${b.recommendation}`, req.user!.id);
  await audit(req.user!.id, 'interview.feedback', 'Interview', iv.id, { interviewerId: b.interviewerId, recommendation: b.recommendation });
  res.json(p);
}));
