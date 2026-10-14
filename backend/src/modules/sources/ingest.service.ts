import { Prisma, type DataSource } from '@prisma/client';
import { prisma } from '../../db.js';
import { applyMapping, normalise, CANONICAL_FIELDS, type Mapping } from '../../lib/normalise.js';
import { saveFile } from '../../lib/storage.js';
import { matchScore } from '../../lib/matching.js';

export interface IngestOptions { requirementId?: string | null; userId?: string }

/** Records may carry a resume file and channel hint alongside their fields. */
export interface ResumeAttachment { name: string; mime: string; data: Buffer; text?: string }
const IDENTITY: Mapping = Object.fromEntries(CANONICAL_FIELDS.map((f) => [f, f])) as Mapping;

async function attachResume(candidateId: string, r: ResumeAttachment | undefined, replace: boolean) {
  if (!r) return;
  const fileId = await saveFile(r.name, r.mime, r.data);
  await prisma.candidate.update({ where: { id: candidateId }, data: replace ? { resumeFileId: fileId, resumeText: r.text?.slice(0, 50000) } : { resumeFileId: fileId, resumeText: r.text?.slice(0, 50000) } });
}

/**
 * The single pipeline every source goes through:
 * field mapping → normalisation → validation → duplicate check (email / phone / source id) → merge or create → auto-match to a requirement.
 */
export async function ingest(source: DataSource, raws: Record<string, unknown>[], opts: IngestOptions = {}) {
  const run = await prisma.ingestionRun.create({ data: { sourceId: source.id, fetched: raws.length } });
  const mapping = Object.keys((source.mapping as object) ?? {}).length ? (source.mapping as Mapping) : IDENTITY;
  const openReqs = await prisma.requirement.findMany({ where: { status: 'OPEN' } });
  const byCode = new Map((await prisma.requirement.findMany({ select: { id: true, code: true } })).map((r) => [r.code.toUpperCase(), r.id]));
  // fill (default): existing candidates only get fields that are empty in HRMS — recruiter edits are never overwritten.
  // overwrite: values from this source replace existing values (use when the source is the system of record).
  const overwrite = (source.config as any)?.updateMode === 'overwrite';
  let added = 0, merged = 0, rejected = 0;
  const errors: string[] = [];

  for (const rec of raws) {
    try {
      const { __resume, __via, ...raw } = rec as Record<string, unknown> & { __resume?: ResumeAttachment; __via?: string };
      const via = __via ? ` (via ${__via})` : '';
      const n = normalise(applyMapping(raw, mapping));
      if (!n.name || (!n.email && !n.phone && !n.externalId)) { rejected++; continue; }

      const or: any[] = [];
      if (n.email) or.push({ email: n.email });
      if (n.phone) or.push({ phone: n.phone });
      if (n.externalId) or.push({ sources: { some: { sourceName: source.name, externalId: n.externalId } } });
      const existing = await prisma.candidate.findFirst({ where: { OR: or } });
      const { externalId, requirementCode, ...fields } = n;
      // A "Requirement code" column (e.g. R-1001) assigns that row to a specific job; it beats auto-matching.
      const rowReqId = requirementCode ? byCode.get(requirementCode) : undefined;
      if (requirementCode && !rowReqId && errors.length < 5) errors.push(`Unknown requirement code ${requirementCode} for ${n.name} — auto-matched instead`);

      if (existing) {
        const fill: any = {};
        for (const [k, v] of Object.entries(fields)) {
          if (k === 'skills' || v == null || v === '') continue;
          if (overwrite || (existing as any)[k] == null || (existing as any)[k] === '') fill[k] = k === 'noticeDays' ? Math.round(v as number) : v;
        }
        fill.skills = [...new Set([...existing.skills, ...n.skills])];
        if (rowReqId && (overwrite || !existing.requirementId) && existing.requirementId !== rowReqId) { fill.requirementId = rowReqId; fill.aiScreening = Prisma.DbNull; fill.aiQuestions = Prisma.DbNull; }
        await prisma.candidate.update({ where: { id: existing.id }, data: fill });
        await prisma.candidateSource.upsert({
          where: { candidateId_sourceName: { candidateId: existing.id, sourceName: source.name } },
          create: { candidateId: existing.id, sourceId: source.id, sourceName: source.name, externalId, raw: raw as any },
          update: { raw: raw as any, externalId },
        });
        if (__resume && !existing.resumeFileId) await attachResume(existing.id, __resume, true);
        await prisma.activity.create({ data: { candidateId: existing.id, type: 'sourcing', message: `Also found in ${source.name}${via}; profile merged` } });
        merged++;
        continue;
      }

      let requirementId = rowReqId ?? opts.requirementId ?? source.defaultRequirementId ?? null;
      let note = rowReqId ? ` · assigned to ${requirementCode}` : '';
      if (!requirementId && openReqs.length) {
        const best = openReqs.map((r) => ({ r, s: matchScore({ ...fields, noticeDays: fields.noticeDays as number | null } as any, r).score })).sort((a, b) => b.s - a.s)[0];
        if (best.s >= 40) { requirementId = best.r.id; note = ` · auto-matched to ${best.r.code} (fit ${best.s})`; }
      }
      const c = await prisma.candidate.create({
        data: {
          ...fields, noticeDays: fields.noticeDays != null ? Math.round(fields.noticeDays) : null, requirementId,
          sources: { create: { sourceId: source.id, sourceName: source.name, externalId, raw: raw as any } },
          activities: { create: { type: 'sourcing', message: `Sourced from ${source.name}${via}${note}`, userId: opts.userId } },
        },
      });
      await attachResume(c.id, __resume, true);
      added++;
    } catch (e: any) {
      rejected++;
      if (errors.length < 5) errors.push(e.message);
    }
  }

  await prisma.ingestionRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), added, merged, rejected, error: errors.join(' | ') || null } });
  await prisma.dataSource.update({ where: { id: source.id }, data: { lastSyncAt: new Date(), records: { increment: added }, lastError: errors[0] ?? null, status: source.status === 'ERROR' ? 'ACTIVE' : source.status } });
  return { runId: run.id, fetched: raws.length, added, merged, rejected, errors, mode: overwrite ? 'overwrite' : 'fill' };
}
