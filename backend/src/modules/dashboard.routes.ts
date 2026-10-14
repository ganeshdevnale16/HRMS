import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah } from '../middleware/http.js';
import { matchScore } from '../lib/matching.js';
import { ai } from './ai/ai.service.js';
import { STAGES } from './candidates.routes.js';

export const dashboardRoutes = Router();

async function summary() {
  const [reqs, cands, upcoming, sources] = await Promise.all([
    prisma.requirement.findMany({ where: { status: 'OPEN' }, include: { recruiter: { select: { name: true } } } }),
    prisma.candidate.findMany({ where: { status: { not: 'REJECTED' } }, select: { id: true, name: true, stage: true, status: true, requirementId: true, skills: true, expYears: true, location: true, noticeDays: true, expectedCtc: true, joining: true, bgv: true, offer: true } }),
    prisma.interview.findMany({ where: { status: { in: ['SCHEDULED', 'CONFIRMED'] }, startAt: { gte: new Date() } }, orderBy: { startAt: 'asc' }, take: 8, include: { candidate: { select: { id: true, name: true } }, panel: { include: { interviewer: { select: { name: true } } } } } }),
    prisma.candidateSource.groupBy({ by: ['sourceName'], _count: { _all: true } }),
  ]);
  const idx = (s: string) => STAGES.indexOf(s as any);
  const inStage = Object.fromEntries(STAGES.map((s) => [s, cands.filter((c) => c.stage === s).length]));
  const reached = Object.fromEntries(STAGES.map((s) => [s, cands.filter((c) => idx(c.stage) >= idx(s)).length]));
  const health = reqs.map((r) => {
    const cs = cands.filter((c) => c.requirementId === r.id);
    const top = cs.map((c) => matchScore(c as any, r).score).sort((a, b) => b - a).slice(0, 5);
    return {
      id: r.id, code: r.code, client: r.client, position: r.position, priority: r.priority, openings: r.openings, recruiter: r.recruiter?.name,
      targetDate: r.targetDate, inPipeline: cs.length, selected: cs.filter((c) => idx(c.stage) >= idx('SELECTION')).length,
      joined: cs.filter((c) => c.joining?.actualDate).length, topFit: top.length ? Math.round(top.reduce((a, b) => a + b, 0) / top.length) : 0,
      byStage: Object.fromEntries(STAGES.map((s) => [s, cs.filter((c) => c.stage === s).length])),
    };
  });
  const attention = [
    ...cands.filter((c) => c.offer?.status === 'APPROVAL_PENDING').map((c) => ({ candidateId: c.id, text: `Offer approval pending for ${c.name}` })),
    ...cands.filter((c) => c.bgv && ['PENDING', 'DISCREPANCY'].includes(c.bgv.status)).map((c) => ({ candidateId: c.id, text: `BGV ${c.bgv!.status.toLowerCase()} for ${c.name}` })),
    ...cands.filter((c) => c.status === 'HOLD').map((c) => ({ candidateId: c.id, text: `${c.name} is on hold` })),
  ].slice(0, 10);
  const feedbackPending = await prisma.interviewPanelist.count({ where: { submittedAt: null, interview: { endAt: { lt: new Date() }, status: { not: 'CANCELLED' } } } });
  return { openRequirements: reqs.length, inStage, reached, health, upcoming, sources: sources.map((s) => ({ name: s.sourceName, count: s._count._all })), attention, feedbackPending };
}

dashboardRoutes.get('/summary', ah(async (_req, res) => res.json(await summary())));

dashboardRoutes.post('/ask', ah(async (req, res) => {
  const { question } = z.object({ question: z.string().min(3).max(500) }).parse(req.body);
  const s = await summary();
  const data = { today: new Date().toISOString().slice(0, 10), stageCounts: s.inStage, requirements: s.health.map(({ id, ...h }) => h), feedbackPending: s.feedbackPending, upcomingInterviews: s.upcoming.length };
  const answer = await ai.text('ask', 'You are a recruitment operations analyst. Answer only from the data given. Be specific with numbers. Under 170 words, plain text.', `DATA: ${JSON.stringify(data)}\nQUESTION: ${question}`, req.user!.id);
  res.json({ answer });
}));
