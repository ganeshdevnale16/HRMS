import { Router, raw } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { ah, HttpError } from '../../middleware/http.js';
import { requireRole } from '../../middleware/auth.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { audit } from '../../lib/audit.js';
import { CANONICAL_FIELDS, guessField } from '../../lib/normalise.js';
import { ai } from '../ai/ai.service.js';
import { connectors, templates } from './connectors/index.js';
import { ingest } from './ingest.service.js';
import { syncSource } from './sync.service.js';
import { fetchSheet } from './connectors/csvurl.js';
import { parseResume } from '../../lib/resume.js';
import { env } from '../../config.js';

export const sourceRoutes = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const safe = (s: any) => { const { secretEnc, ...rest } = s; return { ...rest, hasSecret: !!secretEnc }; };
const flatten = (o: any, p = ''): string[] => Object.entries(o ?? {}).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? flatten(v, `${p}${k}.`) : [`${p}${k}`]));

sourceRoutes.get('/', ah(async (_req, res) => {
  res.json((await prisma.dataSource.findMany({ where: env.PUBLIC_CAREERS ? {} : { connector: { not: 'careers' } }, orderBy: { createdAt: 'asc' } })).map(safe));
}));
sourceRoutes.get('/meta', (_req, res) => res.json({ templates, connectors: Object.values(connectors).map((c) => ({ type: c.type, label: c.label, pull: c.pull, canonical: !!c.canonical })), fields: CANONICAL_FIELDS }));
sourceRoutes.get('/runs', ah(async (_req, res) => {
  res.json(await prisma.ingestionRun.findMany({ orderBy: { startedAt: 'desc' }, take: 50, include: { source: { select: { name: true } } } }));
}));

const Body = z.object({
  name: z.string().min(2), connector: z.string().refine((c) => !!connectors[c], 'Unknown connector type'), template: z.string().optional(),
  schedule: z.string().optional().nullable(), config: z.record(z.any()).default({}), mapping: z.record(z.string()).default({}),
  secret: z.record(z.string()).optional(), defaultRequirementId: z.string().optional().nullable(), status: z.enum(['ACTIVE', 'PAUSED']).optional(),
});

sourceRoutes.post('/', requireRole('ADMIN'), ah(async (req, res) => {
  const { secret, ...b } = Body.parse(req.body);
  const sec: Record<string, string> = { ...(secret ?? {}) };
  if (b.connector === 'webhook' && !sec.webhookSecret) sec.webhookSecret = crypto.randomBytes(24).toString('hex');
  const s = await prisma.dataSource.create({ data: { ...b, secretEnc: Object.keys(sec).length ? encrypt(sec) : null } });
  await audit(req.user!.id, 'source.create', 'DataSource', s.id, { connector: b.connector });
  res.status(201).json({ ...safe(s), webhook: b.connector === 'webhook' ? { url: `/api/webhooks/sources/${s.id}`, secret: sec.webhookSecret } : undefined });
}));

sourceRoutes.patch('/:id', requireRole('ADMIN'), ah(async (req, res) => {
  const { secret, ...b } = Body.partial().parse(req.body);
  const cur = await prisma.dataSource.findUniqueOrThrow({ where: { id: req.params.id } });
  const data: any = { ...b };
  if (secret) data.secretEnc = encrypt({ ...(decrypt(cur.secretEnc) ?? {}), ...secret });
  const s = await prisma.dataSource.update({ where: { id: cur.id }, data });
  await audit(req.user!.id, 'source.update', 'DataSource', s.id);
  res.json(safe(s));
}));

const SYSTEM_SOURCES = ['careers', 'resume', 'manual'];

/**
 * Deletes a configured source. Candidates it brought in are KEPT by default (only the link to the source is removed).
 * With ?deleteCandidates=true, candidates that came ONLY from this source and are still at Sourced/Screening are deleted too;
 * anyone who has progressed further, or also exists in another source, is always kept.
 */
sourceRoutes.delete('/:id', requireRole('ADMIN'), ah(async (req, res) => {
  const s = await prisma.dataSource.findUniqueOrThrow({ where: { id: req.params.id } });
  if (SYSTEM_SOURCES.includes(s.connector)) throw new HttpError(400, `${s.name} is built in and cannot be deleted. You can pause it instead.`);
  let deleted = 0;
  if (req.query.deleteCandidates === 'true') {
    const r = await prisma.candidate.deleteMany({
      where: { stage: { in: ['SOURCED', 'SCREENING'] }, sources: { some: { sourceId: s.id }, every: { sourceId: s.id } }, interviews: { none: {} } },
    });
    deleted = r.count;
  }
  const kept = await prisma.candidateSource.count({ where: { sourceId: s.id } });
  await prisma.dataSource.delete({ where: { id: s.id } });
  await audit(req.user!.id, 'source.delete', 'DataSource', s.id, { name: s.name, deletedCandidates: deleted, keptCandidates: kept });
  res.json({ ok: true, deletedCandidates: deleted, keptCandidates: kept });
}));

sourceRoutes.post('/:id/test', requireRole('ADMIN'), ah(async (req, res) => {
  const s = await prisma.dataSource.findUniqueOrThrow({ where: { id: req.params.id } });
  const c = connectors[s.connector];
  if (!c.test) return res.json({ ok: true, message: `${c.label} sources receive data; nothing to test.` });
  try { res.json({ ok: true, message: await c.test(s, decrypt(s.secretEnc)) }); }
  catch (e: any) { res.json({ ok: false, message: e.message }); }
}));

sourceRoutes.post('/:id/sync', requireRole('RECRUITER'), ah(async (req, res) => {
  res.json(await syncSource(req.params.id, req.user!.id));
}));

/** Detect fields from a pasted sample record or an uploaded file, with a first-guess mapping. */
sourceRoutes.post('/detect', requireRole('RECRUITER'), upload.single('file'), ah(async (req, res) => {
  let rows: Record<string, unknown>[] = [];
  if (req.file) {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  } else if (req.body.csvUrl) {
    rows = await fetchSheet(req.body.csvUrl).catch((e) => { throw new HttpError(400, e.message); });
  } else if (req.body.sample) {
    let o: any;
    try { o = typeof req.body.sample === 'string' ? JSON.parse(req.body.sample) : req.body.sample; }
    catch { throw new HttpError(400, 'The sample is not valid JSON'); }
    rows = Array.isArray(o) ? o : [o];
  }
  if (!rows.length) throw new HttpError(400, 'No records found. Upload a file with a header row, or paste a JSON record.');
  const fields = req.file ? Object.keys(rows[0]) : flatten(rows[0]);
  res.json({ fields, mapping: Object.fromEntries(fields.map((f) => [f, guessField(f)])), preview: rows.slice(0, 5), total: rows.length });
}));

/** Connects with unsaved settings and returns the first records, so admins see real data before saving. */
sourceRoutes.post('/preview', requireRole('ADMIN'), ah(async (req, res) => {
  const b = z.object({ connector: z.string(), config: z.record(z.any()).default({}), secret: z.record(z.string()).optional(), sourceId: z.string().optional() }).parse(req.body);
  const c = connectors[b.connector];
  if (!c?.fetch) throw new HttpError(400, 'This source type receives data; there is nothing to preview');
  let secret = b.secret ?? null;
  if (b.sourceId) { const s = await prisma.dataSource.findUniqueOrThrow({ where: { id: b.sourceId } }); secret = { ...(decrypt(s.secretEnc) ?? {}), ...(b.secret ?? {}) }; }
  try {
    const { records } = await c.fetch({ config: b.config, lastSyncAt: null } as any, secret, { preview: true });
    const clean = records.slice(0, 5).map(({ __resume, ...r }: any) => r);
    const fields = c.canonical ? [] : [...new Set(clean.flatMap((r) => flatten(r)))];
    res.json({ ok: true, count: records.length, fields, mapping: Object.fromEntries(fields.map((f) => [f, guessField(f)])), preview: clean });
  } catch (e: any) { res.json({ ok: false, message: e.message }); }
}));

/** Bulk resume upload: PDF / DOCX / TXT, up to 50 at a time. Each file is parsed into a candidate. */
const resumeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_RESUME_MB * 1024 * 1024, files: 50 } });
sourceRoutes.post('/resumes', requireRole('RECRUITER'), resumeUpload.array('files', 50), ah(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) throw new HttpError(400, 'Choose at least one PDF or DOCX resume');
  let src = await prisma.dataSource.findFirst({ where: { connector: 'resume' } });
  if (!src) src = await prisma.dataSource.create({ data: { name: 'Resume upload', connector: 'resume', mapping: {} } });
  const records: Record<string, unknown>[] = [];
  const failed: { file: string; error: string }[] = [];
  let aiUsed = false;
  let aiBy: any = null;
  for (const f of files) {
    try {
      const p = await parseResume(f.buffer, f.originalname, f.mimetype, req.user!.id);
      aiUsed ||= p.usedAI;
      aiBy ||= p.ai;
      records.push({ ...p.fields, __resume: { name: f.originalname, mime: f.mimetype, data: f.buffer, text: p.text } });
    } catch (e: any) { failed.push({ file: f.originalname, error: String(e.message).replace(`${f.originalname}: `, '') }); }
  }
  const r = records.length ? await ingest({ ...src, mapping: {} }, records, { requirementId: req.body.requirementId || null, userId: req.user!.id }) : { added: 0, merged: 0, rejected: 0, errors: [] };
  res.json({ ...r, failed, aiUsed, aiBy, files: files.length });
}));

sourceRoutes.post('/ai/map', requireRole('RECRUITER'), ah(async (req, res) => {
  const b = z.object({ fields: z.array(z.string()).min(1), sample: z.any().optional() }).parse(req.body);
  const r = await ai.mapFields(b.fields, CANONICAL_FIELDS, b.sample, { userId: req.user!.id });
  res.json(Object.fromEntries(b.fields.map((f) => [f, (CANONICAL_FIELDS as readonly string[]).includes(r[f]) ? r[f] : ''])));
}));

/** Upload a CSV/Excel file into a file source using a mapping chosen for this upload. */
sourceRoutes.post('/:id/upload', requireRole('RECRUITER'), upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a .csv, .xlsx or .xls file');
  const s = await prisma.dataSource.findUniqueOrThrow({ where: { id: req.params.id } });
  const mapping = req.body.mapping ? JSON.parse(req.body.mapping) : s.mapping;
  if (!Object.values(mapping).includes('name')) throw new HttpError(400, 'Map a column to Full name');
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  if (req.body.saveMapping === 'true') await prisma.dataSource.update({ where: { id: s.id }, data: { mapping } });
  res.json(await ingest({ ...s, mapping }, rows, { requirementId: req.body.requirementId || null, userId: req.user!.id }));
}));

/** Public endpoint for push sources (vendors, LinkedIn RSC, Indeed Apply, any system). HMAC-SHA256 of the raw body in X-Signature. */
export const webhookRoutes = Router();
webhookRoutes.post('/sources/:id', raw({ type: '*/*', limit: '5mb' }), ah(async (req, res) => {
  const s = await prisma.dataSource.findUnique({ where: { id: req.params.id } });
  if (!s || s.connector !== 'webhook' || s.status === 'PAUSED') throw new HttpError(404, 'Unknown or paused source');
  const secret = decrypt<{ webhookSecret: string }>(s.secretEnc)?.webhookSecret ?? '';
  const sig = String(req.headers['x-signature'] ?? '').replace(/^sha256=/, '');
  const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new HttpError(401, 'Invalid signature');
  const body = JSON.parse(req.body.toString('utf8'));
  const records = Array.isArray(body) ? body : Array.isArray(body.records) ? body.records : [body];
  const r = await ingest(s, records);
  res.status(202).json({ accepted: records.length, added: r.added, merged: r.merged, rejected: r.rejected });
}));
