import { Router } from 'express';
import { z } from 'zod';
import { Prisma, type Stage } from '@prisma/client';
import { prisma } from '../db.js';
import { ah, HttpError } from '../middleware/http.js';
import { requireRole } from '../middleware/auth.js';
import { activity, audit } from '../lib/audit.js';
import { matchScore } from '../lib/matching.js';
import { ai } from './ai/ai.service.js';
import { ingest } from './sources/ingest.service.js';
import multer from 'multer';
import { deleteFile, readFile, saveFile } from '../lib/storage.js';
import { parseResume } from '../lib/resume.js';
import { env } from '../config.js';

export const candidateRoutes = Router();
export const STAGES: Stage[] = ['SOURCED', 'SCREENING', 'COMMUNICATION', 'INTERVIEW', 'SELECTION', 'HIRING', 'BGV', 'JOINING', 'BILLING'];
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

const roleBrief = (r: any) => ({ position: r.position, client: r.client, experience: `${r.expMin}-${r.expMax} years`, skills: r.skills, location: r.location, workMode: r.workMode, ctcRangeLpa: `${r.ctcMin}-${r.ctcMax}`, maxNoticeDays: r.noticeMax });
const candBrief = (c: any) => ({ experienceYears: c.expYears, skills: c.skills, location: c.location, title: c.title, currentCompany: c.company, currentCtcLpa: c.currentCtc, expectedCtcLpa: c.expectedCtc, noticeDays: c.noticeDays, education: c.education,
  ...(c.resumeText ? { resumeExcerpt: String(c.resumeText).slice(0, 6000) } : {}) });

candidateRoutes.get('/', ah(async (req, res) => {
  const q = z.object({ requirementId: z.string().optional(), stage: z.string().optional(), status: z.string().optional(), source: z.string().optional(), search: z.string().optional(), take: z.coerce.number().max(500).default(200) }).parse(req.query);
  const where: Prisma.CandidateWhereInput = {
    ...(q.requirementId ? { requirementId: q.requirementId === 'none' ? null : q.requirementId } : {}),
    ...(q.stage ? { stage: q.stage as Stage } : {}),
    ...(q.status ? { status: q.status as any } : {}),
    ...(q.source ? { sources: { some: { sourceName: q.source } } } : {}),
    ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }, { company: { contains: q.search, mode: 'insensitive' } }, { skills: { hasSome: [q.search] } }] } : {}),
  };
  const rows = await prisma.candidate.findMany({ where, take: q.take, orderBy: { updatedAt: 'desc' }, include: { requirement: true, sources: { select: { sourceName: true } }, offer: true, bgv: true, joining: true, billing: true } });
  res.json(rows.map(({ resumeText, ...c }) => ({ ...c, match: c.requirement ? matchScore(c, c.requirement) : null })).sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0)));
}));

/* ---------------- Talent database: every candidate ever sourced, whatever happened to them ---------------- */
const DbQuery = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(10).max(200).default(50),
  search: z.string().optional(), skill: z.string().optional(), location: z.string().optional(),
  outcome: z.enum(['', 'IN_PROCESS', 'HIRED', 'SELECTED', 'REJECTED', 'HOLD']).default(''),
  stage: z.string().optional(), requirementId: z.string().optional(), source: z.string().optional(),
  minExp: z.coerce.number().optional(), maxExp: z.coerce.number().optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  sort: z.enum(['recent', 'oldest', 'name', 'exp']).default('recent'),
});

function dbWhere(q: z.infer<typeof DbQuery>): Prisma.CandidateWhereInput {
  const and: Prisma.CandidateWhereInput[] = [];
  if (q.search) {
    const s = q.search.trim();
    and.push({ OR: [{ name: { contains: s, mode: 'insensitive' } }, { email: { contains: s, mode: 'insensitive' } }, { phone: { contains: s.replace(/\D/g, '') || s } },
      { company: { contains: s, mode: 'insensitive' } }, { title: { contains: s, mode: 'insensitive' } }, { resumeText: { contains: s, mode: 'insensitive' } }] });
  }
  if (q.skill) for (const sk of q.skill.split(',').map((x) => x.trim()).filter(Boolean))
    and.push({ OR: [{ skills: { has: sk } }, { skills: { has: sk.toLowerCase() } }, { skills: { has: sk.charAt(0).toUpperCase() + sk.slice(1) } }, { resumeText: { contains: sk, mode: 'insensitive' } }] });
  if (q.location) and.push({ location: { contains: q.location, mode: 'insensitive' } });
  if (q.stage) and.push({ stage: q.stage as Stage });
  if (q.requirementId) and.push({ requirementId: q.requirementId === 'none' ? null : q.requirementId });
  if (q.source) and.push({ sources: { some: { sourceName: q.source } } });
  if (q.minExp != null) and.push({ expYears: { gte: q.minExp } });
  if (q.maxExp != null) and.push({ expYears: { lte: q.maxExp } });
  if (q.from) and.push({ createdAt: { gte: q.from } });
  if (q.to) and.push({ createdAt: { lte: new Date(q.to.getTime() + 864e5) } });
  const hired: Prisma.CandidateWhereInput = { OR: [{ stage: 'BILLING' }, { joining: { is: { actualDate: { not: null } } } }] };
  if (q.outcome === 'REJECTED') and.push({ status: 'REJECTED' });
  if (q.outcome === 'HOLD') and.push({ status: 'HOLD' });
  if (q.outcome === 'HIRED') and.push({ status: { not: 'REJECTED' } }, hired);
  if (q.outcome === 'SELECTED') and.push({ status: { not: 'REJECTED' }, stage: { in: ['SELECTION', 'HIRING', 'BGV', 'JOINING'] } }, { NOT: hired });
  if (q.outcome === 'IN_PROCESS') and.push({ status: 'ACTIVE', stage: { in: ['SOURCED', 'SCREENING', 'COMMUNICATION', 'INTERVIEW'] } });
  return and.length ? { AND: and } : {};
}

function outcomeOf(c: { status: string; stage: string; joining?: { actualDate: Date | null } | null }) {
  if (c.status === 'REJECTED') return 'Rejected';
  if (c.stage === 'BILLING' || c.joining?.actualDate) return 'Hired';
  if (c.status === 'HOLD') return 'On hold';
  if (['SELECTION', 'HIRING', 'BGV', 'JOINING'].includes(c.stage)) return 'Selected';
  return 'In process';
}

const dbSelect = {
  id: true, name: true, email: true, phone: true, location: true, expYears: true, skills: true, company: true, title: true,
  currentCtc: true, expectedCtc: true, noticeDays: true, education: true, stage: true, status: true, createdAt: true, updatedAt: true, resumeFileId: true,
  requirement: { select: { id: true, code: true, position: true, client: true } }, sources: { select: { sourceName: true } }, joining: { select: { actualDate: true } },
} satisfies Prisma.CandidateSelect;
const dbOrder = (s: string): Prisma.CandidateOrderByWithRelationInput[] =>
  s === 'oldest' ? [{ createdAt: 'asc' }] : s === 'name' ? [{ name: 'asc' }] : s === 'exp' ? [{ expYears: 'desc' }] : [{ updatedAt: 'desc' }];

candidateRoutes.get('/database', ah(async (req, res) => {
  const q = DbQuery.parse(req.query);
  const where = dbWhere(q);
  const [total, rows, counts] = await Promise.all([
    prisma.candidate.count({ where }),
    prisma.candidate.findMany({ where, select: dbSelect, orderBy: dbOrder(q.sort), skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    Promise.all((['', 'IN_PROCESS', 'SELECTED', 'HIRED', 'HOLD', 'REJECTED'] as const).map((o) => prisma.candidate.count({ where: dbWhere({ ...q, outcome: o }) }))),
  ]);
  const [all, inProcess, selected, hired, hold, rejected] = counts;
  res.json({ total, page: q.page, pageSize: q.pageSize, counts: { all, inProcess, selected, hired, hold, rejected },
    rows: rows.map((c) => ({ ...c, outcome: outcomeOf(c), sources: [...new Set(c.sources.map((s) => s.sourceName))] })) });
}));

/** CSV export of the current filter (max 20,000 rows). Opens in Excel. */
candidateRoutes.get('/database/export', ah(async (req, res) => {
  const q = DbQuery.parse(req.query);
  const rows = await prisma.candidate.findMany({ where: dbWhere(q), select: dbSelect, orderBy: dbOrder(q.sort), take: 20000 });
  const head = ['Name', 'Email', 'Phone', 'Location', 'Experience (yrs)', 'Skills', 'Company', 'Title', 'Current CTC (LPA)', 'Expected CTC (LPA)', 'Notice (days)', 'Education', 'Requirement', 'Stage', 'Status', 'Outcome', 'Sources', 'Added on', 'Last updated'];
  const cell = (v: unknown) => { const s = v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = rows.map((c) => [c.name, c.email, c.phone, c.location, c.expYears, c.skills.join('; '), c.company, c.title, c.currentCtc, c.expectedCtc, c.noticeDays, c.education,
    c.requirement ? `${c.requirement.code} ${c.requirement.position}` : '', c.stage, c.status, outcomeOf(c), [...new Set(c.sources.map((s) => s.sourceName))].join('; '), c.createdAt, c.updatedAt].map(cell).join(','));
  await audit(req.user!.id, 'candidate.export', 'Candidate', undefined, { rows: rows.length });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="talent-database-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('\uFEFF' + [head.join(','), ...lines].join('\r\n'));
}));

candidateRoutes.get('/:id', ah(async (req, res) => {
  const c = await prisma.candidate.findUniqueOrThrow({
    where: { id: req.params.id },
    include: {
      requirement: true, sources: true, offer: true, bgv: true, joining: true, billing: true,
      activities: { orderBy: { createdAt: 'desc' } }, communications: { orderBy: { createdAt: 'desc' } },
      interviews: { orderBy: { startAt: 'desc' }, include: { panel: { include: { interviewer: { select: { id: true, name: true, email: true } } } } } },
    },
  });
  const { resumeText, ...rest } = c;
  res.json({ ...rest, hasResumeText: !!resumeText, match: c.requirement ? matchScore(c, c.requirement) : null });
}));

candidateRoutes.get('/:id/resume', ah(async (req, res) => {
  const c = await prisma.candidate.findUniqueOrThrow({ where: { id: req.params.id }, select: { resumeFileId: true } });
  if (!c.resumeFileId) throw new HttpError(404, 'No resume on file');
  const f = await readFile(c.resumeFileId);
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `inline; filename="${f.name.replace(/"/g, '')}"`);
  res.send(f.data);
}));

/** Replace (or add) a candidate's resume. Skills found in the new resume are added; other details are filled only if empty. */
const oneResume = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_RESUME_MB * 1024 * 1024, files: 1 } });
candidateRoutes.post('/:id/resume', requireRole('RECRUITER'), oneResume.single('file'), ah(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a PDF or DOCX file');
  const c = await prisma.candidate.findUniqueOrThrow({ where: { id: req.params.id } });
  let p;
  try { p = await parseResume(req.file.buffer, req.file.originalname, req.file.mimetype, req.user!.id); }
  catch (e: any) { throw new HttpError(400, e.message); }
  const fileId = await saveFile(req.file.originalname, req.file.mimetype, req.file.buffer);
  const skills = String(p.fields.skills ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const fill: any = { resumeFileId: fileId, resumeText: p.text.slice(0, 50000), skills: [...new Set([...c.skills, ...skills])] };
  for (const k of ['location', 'company', 'title', 'education'] as const) if (!c[k] && p.fields[k]) fill[k] = String(p.fields[k]);
  if (!c.expYears && p.fields.expYears) fill.expYears = Number(p.fields.expYears) || 0;
  await prisma.candidate.update({ where: { id: c.id }, data: fill });
  await deleteFile(c.resumeFileId);
  await activity(c.id, 'resume', `Resume ${c.resumeFileId ? 'replaced' : 'added'}: ${req.file.originalname}`, req.user!.id);
  res.json({ ok: true });
}));

candidateRoutes.delete('/:id/resume', requireRole('RECRUITER'), ah(async (req, res) => {
  const c = await prisma.candidate.findUniqueOrThrow({ where: { id: req.params.id } });
  if (!c.resumeFileId) throw new HttpError(404, 'No resume on file');
  await prisma.candidate.update({ where: { id: c.id }, data: { resumeFileId: null, resumeText: null } });
  await deleteFile(c.resumeFileId);
  await activity(c.id, 'resume', 'Resume removed', req.user!.id);
  await audit(req.user!.id, 'candidate.resume.delete', 'Candidate', c.id);
  res.json({ ok: true });
}));

/** Permanently deletes candidates with their interviews, notes, offer/BGV/joining/billing records and resume files. */
async function deleteCandidates(ids: string[], userId: string) {
  const cs = await prisma.candidate.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, resumeFileId: true } });
  await prisma.candidate.deleteMany({ where: { id: { in: cs.map((c) => c.id) } } });
  for (const c of cs) await deleteFile(c.resumeFileId);
  await audit(userId, 'candidate.delete', 'Candidate', undefined, { count: cs.length, names: cs.map((c) => c.name) });
  return cs.length;
}

candidateRoutes.delete('/:id', requireRole('RECRUITER'), ah(async (req, res) => {
  res.json({ deleted: await deleteCandidates([req.params.id], req.user!.id) });
}));

candidateRoutes.post('/bulk-delete', requireRole('RECRUITER'), ah(async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string()).min(1).max(500) }).parse(req.body);
  res.json({ deleted: await deleteCandidates(ids, req.user!.id) });
}));

const CandBody = z.object({
  name: z.string().min(1), email: z.string().email().optional().or(z.literal('')), phone: z.string().optional(), location: z.string().optional(),
  expYears: z.coerce.number().optional(), skills: z.union([z.array(z.string()), z.string()]).optional(), company: z.string().optional(), title: z.string().optional(),
  currentCtc: z.coerce.number().optional(), expectedCtc: z.coerce.number().optional(), noticeDays: z.coerce.number().optional(), education: z.string().optional(),
  requirementId: z.string().optional(),
});

candidateRoutes.post('/', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = CandBody.parse(req.body);
  let src = await prisma.dataSource.findUnique({ where: { name: 'Manual entry' } });
  if (!src) src = await prisma.dataSource.create({ data: { name: 'Manual entry', connector: 'manual', mapping: {} } });
  const ident = Object.fromEntries(['name', 'email', 'phone', 'location', 'expYears', 'skills', 'company', 'title', 'currentCtc', 'expectedCtc', 'noticeDays', 'education'].map((k) => [k, k]));
  const raw = { ...b, skills: Array.isArray(b.skills) ? b.skills.join(', ') : b.skills };
  const r = await ingest({ ...src, mapping: ident as any }, [raw as any], { requirementId: b.requirementId, userId: req.user!.id });
  if (r.rejected) throw new HttpError(400, 'Add an email or phone number so the candidate can be contacted and de-duplicated');
  res.status(201).json(r);
}));

/**
 * Assigns candidates to a requirement (or removes the link with requirementId = null).
 * Earlier AI screening/questions belonged to the old requirement, so they are cleared. Stage is kept unless resetStage is set.
 */
export async function assignRequirement(ids: string[], requirementId: string | null, userId: string, resetStage = false) {
  const req = requirementId ? await prisma.requirement.findUniqueOrThrow({ where: { id: requirementId } }) : null;
  const cs = await prisma.candidate.findMany({ where: { id: { in: ids } }, include: { requirement: { select: { code: true, position: true } } } });
  let changed = 0;
  for (const c of cs) {
    if (c.requirementId === requirementId) continue;
    await prisma.candidate.update({ where: { id: c.id }, data: { requirementId, aiScreening: Prisma.DbNull, aiQuestions: Prisma.DbNull, ...(resetStage ? { stage: 'SCREENING', status: 'ACTIVE' } : {}) } });
    const from = c.requirement ? `${c.requirement.code} ${c.requirement.position}` : 'no requirement';
    const to = req ? `${req.code} ${req.position}` : 'no requirement';
    await activity(c.id, 'requirement', `Moved from ${from} to ${to}${resetStage ? ' · stage reset to Screening' : ''}`, userId);
    changed++;
  }
  await audit(userId, 'candidate.assign', 'Requirement', requirementId ?? undefined, { count: changed });
  return changed;
}

candidateRoutes.post('/bulk-assign', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = z.object({ ids: z.array(z.string()).min(1).max(500), requirementId: z.string().nullable(), resetStage: z.boolean().optional() }).parse(req.body);
  res.json({ changed: await assignRequirement(b.ids, b.requirementId, req.user!.id, b.resetStage) });
}));

candidateRoutes.post('/:id/requirement', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = z.object({ requirementId: z.string().nullable(), resetStage: z.boolean().optional() }).parse(req.body);
  res.json({ changed: await assignRequirement([req.params.id], b.requirementId, req.user!.id, b.resetStage) });
}));

candidateRoutes.patch('/:id', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = CandBody.partial().omit({ requirementId: true }).parse(req.body);
  const data: any = { ...b, skills: typeof b.skills === 'string' ? b.skills.split(',').map((s) => s.trim()).filter(Boolean) : b.skills };
  const c = await prisma.candidate.update({ where: { id: req.params.id }, data });
  await audit(req.user!.id, 'candidate.update', 'Candidate', c.id);
  res.json(c);
}));

/** Moves a candidate between lifecycle stages and creates the records each stage needs. */
export async function moveStage(id: string, to: Stage, reason: string | undefined, userId?: string) {
  const c = await prisma.candidate.findUniqueOrThrow({ where: { id }, include: { requirement: true, offer: true, bgv: true, joining: true, billing: true } });
  const ti = STAGES.indexOf(to);
  await prisma.$transaction(async (tx) => {
    await tx.candidate.update({ where: { id }, data: { stage: to, status: 'ACTIVE' } });
    if (ti >= STAGES.indexOf('HIRING') && !c.offer) await tx.offer.create({ data: { candidateId: id, finalCtc: c.expectedCtc, expectedJoining: new Date(Date.now() + 30 * 864e5) } });
    if (ti >= STAGES.indexOf('BGV') && !c.bgv) await tx.bgv.create({ data: { candidateId: id, initiatedAt: new Date() } });
    if (ti >= STAGES.indexOf('JOINING') && !c.joining) await tx.joining.create({ data: { candidateId: id, expectedDate: c.offer?.expectedJoining ?? null, project: c.requirement ? `${c.requirement.client} – ${c.requirement.position}` : null, location: c.requirement?.location } });
    if (ti >= STAGES.indexOf('BILLING') && !c.billing) await tx.billing.create({ data: { candidateId: id } });
    await tx.activity.create({ data: { candidateId: id, type: 'stage', message: `${label(c.stage)} → ${label(to)}${reason ? ` · ${reason}` : ''}`, userId } });
  });
  await audit(userId, 'candidate.stage', 'Candidate', id, { from: c.stage, to });
}

candidateRoutes.post('/:id/stage', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = z.object({ stage: z.enum(STAGES as [Stage, ...Stage[]]), reason: z.string().optional() }).parse(req.body);
  await moveStage(req.params.id, b.stage, b.reason, req.user!.id);
  res.json({ ok: true });
}));

candidateRoutes.post('/:id/status', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = z.object({ status: z.enum(['ACTIVE', 'HOLD', 'REJECTED']), reason: z.string().optional() }).parse(req.body);
  const c = await prisma.candidate.update({ where: { id: req.params.id }, data: { status: b.status } });
  await activity(c.id, 'status', `${b.status === 'ACTIVE' ? 'Reactivated' : b.status === 'HOLD' ? 'Put on hold' : `Rejected at ${label(c.stage)}`}${b.reason ? ` · ${b.reason}` : ''}`, req.user!.id);
  await audit(req.user!.id, 'candidate.status', 'Candidate', c.id, b);
  res.json(c);
}));

candidateRoutes.post('/bulk-stage', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = z.object({ ids: z.array(z.string()).min(1).max(200), stage: z.enum(STAGES as [Stage, ...Stage[]]), reason: z.string().optional() }).parse(req.body);
  for (const id of b.ids) await moveStage(id, b.stage, b.reason, req.user!.id);
  res.json({ moved: b.ids.length });
}));

candidateRoutes.post('/:id/communications', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = z.object({ channel: z.enum(['CALL', 'EMAIL', 'WHATSAPP', 'NOTE']), outcome: z.string(), notes: z.string().optional(), nextAction: z.string().optional(), followUpAt: z.coerce.date().optional() }).parse(req.body);
  const cm = await prisma.communication.create({ data: { ...b, candidateId: req.params.id, userId: req.user!.id } });
  await activity(req.params.id, 'communication', `${label(b.channel)} · ${b.outcome}`, req.user!.id);
  const c = await prisma.candidate.findUniqueOrThrow({ where: { id: req.params.id } });
  if (STAGES.indexOf(c.stage) < STAGES.indexOf('COMMUNICATION') && b.outcome === 'Connected') await moveStage(c.id, 'COMMUNICATION', 'Candidate contacted', req.user!.id);
  res.status(201).json(cm);
}));

/* ---- Offer to billing ---- */
const dt = z.coerce.date().optional().nullable();
const postOffer = {
  offer: z.object({ finalCtc: z.coerce.number().optional(), status: z.enum(['PREPARATION', 'APPROVAL_PENDING', 'APPROVED', 'RELEASED', 'ACCEPTED', 'DECLINED']).optional(), documents: z.enum(['PENDING', 'PARTIAL', 'COMPLETE']).optional(), expectedJoining: dt, remarks: z.string().optional() }),
  bgv: z.object({ caseId: z.string().optional(), provider: z.string().optional(), initiatedAt: dt, status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISCREPANCY', 'FAILED']).optional(), result: z.string().optional().nullable(), remarks: z.string().optional() }),
  joining: z.object({ expectedDate: dt, actualDate: dt, employeeId: z.string().optional(), project: z.string().optional(), location: z.string().optional(), confirmed: z.boolean().optional() }),
  billing: z.object({ startDate: dt, rate: z.coerce.number().optional(), status: z.enum(['ELIGIBLE', 'START_DATE_SET', 'ACTIVE', 'ON_HOLD', 'STOPPED']).optional(), invoiceRef: z.string().optional() }),
};
for (const [key, schema] of Object.entries(postOffer)) {
  candidateRoutes.patch(`/:id/${key}`, requireRole(key === 'billing' ? 'FINANCE' : 'RECRUITER'), ah(async (req, res) => {
    const data: any = schema.parse(req.body);
    const id = req.params.id;
    const model: any = (prisma as any)[key];
    const row = await model.upsert({ where: { candidateId: id }, create: { candidateId: id, ...data }, update: data });
    if (key === 'offer' && data.status === 'ACCEPTED') await moveStage(id, 'BGV', 'Offer accepted', req.user!.id);
    if (key === 'bgv' && data.status === 'COMPLETED') { const c = await prisma.candidate.findUniqueOrThrow({ where: { id } }); if (c.stage === 'BGV') await moveStage(id, 'JOINING', 'BGV completed', req.user!.id); }
    if (key === 'joining' && data.actualDate) { await moveStage(id, 'BILLING', 'Joined', req.user!.id); }
    if (key === 'billing' && data.startDate && row.status === 'ELIGIBLE') await prisma.billing.update({ where: { candidateId: id }, data: { status: 'START_DATE_SET' } });
    await activity(id, key, `${key.toUpperCase()} updated: ${Object.entries(data).map(([k, v]) => `${k}=${v instanceof Date ? v.toISOString().slice(0, 10) : v}`).join(', ')}`, req.user!.id);
    await audit(req.user!.id, `${key}.update`, 'Candidate', id, data);
    res.json(row);
  }));
}

/* ---- AI assistance (advisory only) ---- */
/**
 * AI screening for many candidates at once (max 25 per call). Each candidate is compared with their requirement
 * using profile + resume text; the result (Shortlist / Hold / Reject with reasons) is saved on the candidate.
 * Nothing moves automatically — the recruiter reviews and decides.
 */
candidateRoutes.post('/ai/screen-bulk', requireRole('RECRUITER'), ah(async (req, res) => {
  const { ids, provider } = z.object({ ids: z.array(z.string()).min(1).max(25), provider: z.string().optional() }).parse(req.body);
  const cs = await prisma.candidate.findMany({ where: { id: { in: ids } }, include: { requirement: true } });
  const results: any[] = [];
  for (const c of cs) {
    if (!c.requirement) { results.push({ id: c.id, name: c.name, error: 'No requirement linked' }); continue; }
    try {
      const out = await ai.screen(roleBrief(c.requirement), candBrief(c), { userId: req.user!.id, provider });
      await prisma.candidate.update({ where: { id: c.id }, data: { aiScreening: { ...out, at: new Date().toISOString() } as any } });
      await activity(c.id, 'screening', `AI screening suggested: ${out.decision} (${out._ai.label} · ${out._ai.model})`, req.user!.id);
      results.push({ id: c.id, name: c.name, fit: matchScore(c, c.requirement).score, ...out });
    } catch (e: any) {
      results.push({ id: c.id, name: c.name, error: e.message });
      if (/not configured|API key|401|403/.test(e.message)) break; // no point continuing with a broken setup
    }
  }
  res.json({ results });
}));

candidateRoutes.post('/:id/ai/screen', requireRole('RECRUITER'), ah(async (req, res) => {
  const c = await prisma.candidate.findUniqueOrThrow({ where: { id: req.params.id }, include: { requirement: true } });
  if (!c.requirement) throw new HttpError(400, 'Link the candidate to a requirement first');
  const { provider } = z.object({ provider: z.string().optional() }).parse(req.body ?? {});
  const out = await ai.screen(roleBrief(c.requirement), candBrief(c), { userId: req.user!.id, provider });
  await prisma.candidate.update({ where: { id: c.id }, data: { aiScreening: { ...out, at: new Date().toISOString() } as any } });
  await activity(c.id, 'screening', `AI screening suggested: ${out.decision} (${out._ai.label} · ${out._ai.model})`, req.user!.id);
  res.json(out);
}));

candidateRoutes.post('/:id/ai/questions', requireRole('RECRUITER', 'INTERVIEWER'), ah(async (req, res) => {
  const { round } = z.object({ round: z.string().default('L1 Technical') }).parse(req.body ?? {});
  const c = await prisma.candidate.findUniqueOrThrow({ where: { id: req.params.id }, include: { requirement: true } });
  if (!c.requirement) throw new HttpError(400, 'Link the candidate to a requirement first');
  const m = matchScore(c, c.requirement);
  const out = await ai.questions(roleBrief(c.requirement), candBrief(c), m.missing, round, { userId: req.user!.id });
  await prisma.candidate.update({ where: { id: c.id }, data: { aiQuestions: { ...out, round, at: new Date().toISOString() } as any } });
  res.json(out);
}));

candidateRoutes.post('/:id/ai/outreach', requireRole('RECRUITER'), ah(async (req, res) => {
  const { channel } = z.object({ channel: z.enum(['EMAIL', 'WHATSAPP']).default('EMAIL') }).parse(req.body ?? {});
  const c = await prisma.candidate.findUniqueOrThrow({ where: { id: req.params.id }, include: { requirement: true } });
  if (!c.requirement) throw new HttpError(400, 'Link the candidate to a requirement first');
  const text = await ai.text('outreach', 'You write short, warm, professional recruiter outreach. No exaggerated claims. Do not reveal the client name.',
    `Channel: ${channel}. Recruiter: ${req.user!.name}. Candidate first name: ${c.name.split(' ')[0]}. Their skills: ${c.skills.slice(0, 4).join(', ')}. Role: ${c.requirement.position}, ${c.requirement.expMin}-${c.requirement.expMax} years, ${c.requirement.workMode.toLowerCase()} in ${c.requirement.location}. Ask for a good time to talk. Under ${channel === 'WHATSAPP' ? 60 : 110} words. Plain text.`, req.user!.id);
  res.json({ text });
}));
