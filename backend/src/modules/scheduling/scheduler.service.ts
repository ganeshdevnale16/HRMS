import { DateTime } from 'luxon';
import type { Interviewer, MeetingProviderId, Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { env } from '../../config.js';
import { HttpError } from '../../middleware/http.js';
import { activity, audit } from '../../lib/audit.js';
import { buildIcs } from '../../lib/ics.js';
import { getMailConfig, sendMail } from '../../lib/mailer.js';
import { getBusy, type Busy } from './calendar/availability.js';
import { getProvider, meetingProviders } from './providers/index.js';
import type { MeetingRequest } from './providers/types.js';

const STAGE_ORDER = ['SOURCED', 'SCREENING', 'COMMUNICATION', 'INTERVIEW', 'SELECTION', 'HIRING', 'BGV', 'JOINING', 'BILLING'];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, '');

/** Ranks interviewers for a requirement and round: skill overlap (65%) and spare weekly capacity (35%). */
export async function suggestInterviewers(requirementId: string, round?: string) {
  const req = await prisma.requirement.findUniqueOrThrow({ where: { id: requirementId } });
  const all = await prisma.interviewer.findMany({ where: { active: true } });
  const weekStart = DateTime.now().setZone(env.DEFAULT_TIMEZONE).startOf('week');
  const counts = await prisma.interviewPanelist.groupBy({
    by: ['interviewerId'], _count: { _all: true },
    where: { interview: { status: { not: 'CANCELLED' }, startAt: { gte: weekStart.toJSDate(), lt: weekStart.plus({ weeks: 1 }).toJSDate() } } },
  });
  const load = new Map(counts.map((c) => [c.interviewerId, c._count._all]));
  return all
    .filter((i) => !round || !i.rounds.length || i.rounds.includes(round))
    .map((i) => {
      const mine = i.skills.map(norm);
      const matched = req.skills.filter((s) => mine.some((m) => m === norm(s) || (m.length > 2 && norm(s).includes(m)) || (norm(s).length > 2 && m.includes(norm(s)))));
      const skill = req.skills.length ? matched.length / req.skills.length : 0;
      const thisWeek = load.get(i.id) ?? 0;
      const capacity = Math.max(0, 1 - thisWeek / Math.max(1, i.maxPerWeek));
      return { interviewer: i, score: Math.round(100 * (0.65 * skill + 0.35 * capacity)), matchedSkills: matched, thisWeek, atCapacity: thisWeek >= i.maxPerWeek };
    })
    .sort((a, b) => Number(a.atCapacity) - Number(b.atCapacity) || b.score - a.score);
}

const overlaps = (aS: Date, aE: Date, b: Busy, bufferMins: number) =>
  aS.getTime() < b.end.getTime() + bufferMins * 60000 && aE.getTime() > b.start.getTime() - bufferMins * 60000;

function withinWorkingHours(iv: Interviewer, start: Date, end: Date) {
  const s = DateTime.fromJSDate(start, { zone: iv.timezone });
  const e = DateTime.fromJSDate(end, { zone: iv.timezone });
  if (!iv.workDays.includes(s.weekday) || s.toISODate() !== e.toISODate()) return false;
  const [wsH, wsM] = iv.workStart.split(':').map(Number);
  const [weH, weM] = iv.workEnd.split(':').map(Number);
  return s >= s.set({ hour: wsH, minute: wsM, second: 0, millisecond: 0 }) && e <= s.set({ hour: weH, minute: weM, second: 0, millisecond: 0 });
}

function checkSlot(ivs: Interviewer[], busy: Map<string, Busy[]>, start: Date, end: Date) {
  const problems: string[] = [];
  for (const iv of ivs) {
    if (!withinWorkingHours(iv, start, end)) { problems.push(`${iv.name} is outside working hours`); continue; }
    const list = busy.get(iv.id) ?? [];
    const clash = list.find((b) => overlaps(start, end, b, iv.bufferMins));
    if (clash) { problems.push(`${iv.name} is busy (${clash.source === 'calendar' ? 'calendar' : 'another interview'})`); continue; }
    const day = DateTime.fromJSDate(start, { zone: iv.timezone }).toISODate();
    const sameDay = list.filter((b) => b.source === 'hrms' && DateTime.fromJSDate(b.start, { zone: iv.timezone }).toISODate() === day).length;
    if (sameDay >= iv.maxPerDay) problems.push(`${iv.name} already has ${sameDay} interviews that day`);
  }
  return problems;
}

/** Common free slots for the whole panel. */
export async function findSlots(o: { interviewerIds: string[]; durationMins: number; from: Date; to: Date; stepMins?: number; limit?: number }) {
  const ivs = await prisma.interviewer.findMany({ where: { id: { in: o.interviewerIds }, active: true } });
  if (ivs.length !== o.interviewerIds.length) throw new HttpError(400, 'One or more interviewers are inactive or missing');
  const { busy, warnings } = await getBusy(ivs, o.from, o.to);
  const step = (o.stepMins ?? 30) * 60000;
  const earliest = Math.max(o.from.getTime(), Date.now() + 2 * 3600000);
  let t = Math.ceil(earliest / step) * step;
  const slots: { start: string; end: string }[] = [];
  while (t + o.durationMins * 60000 <= o.to.getTime() && slots.length < (o.limit ?? 80)) {
    const s = new Date(t), e = new Date(t + o.durationMins * 60000);
    if (!checkSlot(ivs, busy, s, e).length) slots.push({ start: s.toISOString(), end: e.toISOString() });
    t += step;
  }
  return { slots, warnings };
}

export interface ScheduleInput {
  candidateId: string; round: string; interviewerIds: string[]; start: Date; durationMins: number;
  provider: MeetingProviderId; location?: string; notes?: string; force?: boolean; timezone?: string; meetingLink?: string;
}

async function loadContext(candidateId: string, interviewerIds: string[]) {
  const candidate = await prisma.candidate.findUniqueOrThrow({ where: { id: candidateId }, include: { requirement: true } });
  if (!candidate.requirement) throw new HttpError(400, 'Link this candidate to a requirement before scheduling');
  const ivs = await prisma.interviewer.findMany({ where: { id: { in: interviewerIds } } });
  if (!ivs.length) throw new HttpError(400, 'Choose at least one interviewer');
  return { candidate, requirement: candidate.requirement, ivs };
}

function buildRequest(ctx: Awaited<ReturnType<typeof loadContext>>, i: { id: string; round: string; start: Date; end: Date; timezone: string; location?: string | null; notes?: string | null; meetingLink?: string | null }): MeetingRequest {
  const { candidate: c, requirement: r, ivs } = ctx;
  const when = DateTime.fromJSDate(i.start, { zone: i.timezone }).toFormat("ccc d LLL yyyy, h:mm a ZZZZ");
  return {
    subject: `Interview: ${c.name} – ${r.position} (${i.round})`,
    bodyHtml: `<p><b>${i.round}</b> for <b>${r.position}</b> (${r.code}).</p><p>Candidate: ${c.name}${c.title ? `, ${c.title}` : ''}${c.company ? ` at ${c.company}` : ''}<br>When: ${when}<br>Panel: ${ivs.map((x) => x.name).join(', ')}</p>${i.location ? `<p>Location: ${i.location}</p>` : ''}${i.notes ? `<p>${i.notes}</p>` : ''}<p>Interviewers: submit feedback in HRMS after the interview: ${env.APP_URL}/interviews/${i.id}</p>`,
    start: i.start, end: i.end, timezone: i.timezone, idempotencyKey: i.id, location: i.location ?? undefined, meetingLink: i.meetingLink ?? null,
    attendees: [
      ...ivs.map((x) => ({ email: x.email, name: x.name, role: 'interviewer' as const })),
      ...(c.email ? [{ email: c.email, name: c.name, role: 'candidate' as const }] : []),
    ],
  };
}

async function emailIcs(req: MeetingRequest, uid: string, sequence: number, method: 'REQUEST' | 'CANCEL', joinUrl?: string | null) {
  const mc = await getMailConfig();
  const organizerEmail = mc.fromEmail || env.MS_ORGANIZER_UPN || env.GOOGLE_ORGANIZER_EMAIL || 'no-reply@hrms.local';
  const ics = buildIcs({
    uid: `${uid}@hrms`, sequence, method, start: req.start, end: req.end, summary: req.subject,
    description: req.bodyHtml.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '') + (joinUrl ? `\nJoin: ${joinUrl}` : ''),
    location: joinUrl ?? req.location, organizer: { name: 'Recruiting', email: organizerEmail }, attendees: req.attendees,
  });
  const html = method === 'CANCEL' ? `<p>This interview has been cancelled.</p>${req.bodyHtml}` : `${req.bodyHtml}${joinUrl ? `<p><a href="${joinUrl}">Join the meeting</a></p>` : ''}`;
  await sendMail({ to: req.attendees.map((a) => a.email), subject: (method === 'CANCEL' ? 'Cancelled: ' : sequence ? 'Updated: ' : '') + req.subject, html, ics: { method, content: ics } });
}

export async function scheduleInterview(input: ScheduleInput, userId?: string) {
  const ctx = await loadContext(input.candidateId, input.interviewerIds);
  const start = input.start, end = new Date(start.getTime() + input.durationMins * 60000);
  const timezone = input.timezone ?? env.DEFAULT_TIMEZONE;
  if (start.getTime() < Date.now()) throw new HttpError(400, 'Pick a time in the future');

  const { busy, warnings } = await getBusy(ctx.ivs, new Date(start.getTime() - 86400000), new Date(end.getTime() + 86400000));
  const problems = checkSlot(ctx.ivs, busy, start, end);
  if (problems.length && !input.force) throw new HttpError(409, 'This time does not work for the panel', { problems, warnings });

  const provider = getProvider(input.provider);
  if (input.meetingLink && !/^https:\/\/\S+$/i.test(input.meetingLink.trim())) throw new HttpError(400, 'The meeting link must start with https://');
  if (input.provider === 'LINK' && !input.meetingLink) throw new HttpError(400, 'Paste the meeting link (Teams, Zoom, Google Meet…)');
  const row = await prisma.interview.create({
    data: {
      candidateId: ctx.candidate.id, requirementId: ctx.requirement.id, round: input.round, startAt: start, endAt: end, timezone,
      provider: input.provider, location: input.location, notes: input.notes, createdById: userId,
      panel: { create: ctx.ivs.map((i) => ({ interviewerId: i.id })) },
    },
  });
  const mreq = buildRequest(ctx, { ...row, meetingLink: input.meetingLink?.trim() || null });
  let result;
  try { result = await provider.create(mreq); }
  catch (e: any) { await prisma.interview.delete({ where: { id: row.id } }); throw new HttpError(502, `Could not create the ${provider.label} meeting: ${e.message}`); }

  const saved = await prisma.interview.update({
    where: { id: row.id },
    data: { externalId: result.externalId, joinUrl: result.joinUrl, webLink: result.webLink, meetingPassword: result.password },
    include: { panel: { include: { interviewer: true } }, candidate: true, requirement: true },
  });
  if (!result.sendsInvites) await emailIcs(mreq, row.id, 0, 'REQUEST', result.joinUrl);

  if (STAGE_ORDER.indexOf(ctx.candidate.stage) < STAGE_ORDER.indexOf('INTERVIEW'))
    await prisma.candidate.update({ where: { id: ctx.candidate.id }, data: { stage: 'INTERVIEW', status: 'ACTIVE' } });
  await activity(ctx.candidate.id, 'interview', `${input.round} scheduled on ${provider.label} for ${DateTime.fromJSDate(start, { zone: timezone }).toFormat('d LLL, h:mm a')} with ${ctx.ivs.map((i) => i.name).join(', ')}`, userId);
  await audit(userId, 'interview.schedule', 'Interview', row.id, { provider: input.provider, forced: !!(problems.length && input.force) });
  return { interview: saved, warnings: [...warnings, ...(problems.length ? problems.map((p) => `Scheduled anyway: ${p}`) : [])] };
}

export async function rescheduleInterview(id: string, start: Date, durationMins: number, force = false, userId?: string) {
  const iv = await prisma.interview.findUniqueOrThrow({ where: { id }, include: { panel: true } });
  if (iv.status === 'CANCELLED' || iv.status === 'COMPLETED') throw new HttpError(400, 'Only upcoming interviews can be rescheduled');
  const ctx = await loadContext(iv.candidateId, iv.panel.map((p) => p.interviewerId));
  const end = new Date(start.getTime() + durationMins * 60000);
  const { busy } = await getBusy(ctx.ivs, new Date(start.getTime() - 86400000), new Date(end.getTime() + 86400000), id);
  const problems = checkSlot(ctx.ivs, busy, start, end);
  if (problems.length && !force) throw new HttpError(409, 'This time does not work for the panel', { problems });

  const mreq = buildRequest(ctx, { ...iv, start, end, meetingLink: iv.joinUrl });
  const provider = meetingProviders[iv.provider];
  let result = { joinUrl: iv.joinUrl, webLink: iv.webLink, sendsInvites: false } as any;
  if (iv.externalId) result = await provider.update(iv.externalId, mreq);
  else result = { ...(await provider.update('', mreq)), joinUrl: iv.joinUrl };
  const saved = await prisma.interview.update({
    where: { id }, data: { startAt: start, endAt: end, sequence: { increment: 1 }, status: 'SCHEDULED', joinUrl: result.joinUrl ?? iv.joinUrl, webLink: result.webLink ?? iv.webLink },
  });
  if (!result.sendsInvites) await emailIcs(mreq, id, saved.sequence, 'REQUEST', saved.joinUrl);
  await activity(iv.candidateId, 'interview', `${iv.round} rescheduled to ${DateTime.fromJSDate(start, { zone: iv.timezone }).toFormat('d LLL, h:mm a')}`, userId);
  await audit(userId, 'interview.reschedule', 'Interview', id);
  return saved;
}

export async function cancelInterview(id: string, reason: string | undefined, userId?: string) {
  const iv = await prisma.interview.findUniqueOrThrow({ where: { id }, include: { panel: true } });
  if (iv.status === 'CANCELLED') return iv;
  const ctx = await loadContext(iv.candidateId, iv.panel.map((p) => p.interviewerId));
  const provider = meetingProviders[iv.provider];
  if (iv.externalId) await provider.cancel(iv.externalId, reason).catch((e) => console.warn('provider cancel failed', e.message));
  const mreq = buildRequest(ctx, { ...iv, start: iv.startAt, end: iv.endAt });
  // TEAMS_MANUAL: the real meeting lives in the recruiter's own Teams — they cancel it there (the UI reminds them).
  if (!['TEAMS', 'GOOGLE_MEET', 'WEBEX', 'TEAMS_MANUAL'].includes(iv.provider)) await emailIcs(mreq, id, iv.sequence + 1, 'CANCEL');
  const saved = await prisma.interview.update({ where: { id }, data: { status: 'CANCELLED', sequence: { increment: 1 }, notes: reason ? `${iv.notes ?? ''}\nCancelled: ${reason}`.trim() : iv.notes } });
  await activity(iv.candidateId, 'interview', `${iv.round} cancelled${reason ? `: ${reason}` : ''}`, userId);
  await audit(userId, 'interview.cancel', 'Interview', id, { reason });
  return saved;
}

/** Save a meeting link created outside HRMS (e.g. the Teams link from the recruiter's own invite). Optionally email it. */
export async function setMeetingLink(id: string, url: string | null, notify: boolean, userId?: string) {
  if (url && !/^https:\/\/\S+$/i.test(url.trim())) throw new HttpError(400, 'The meeting link must start with https://');
  const iv = await prisma.interview.findUniqueOrThrow({ where: { id }, include: { panel: true } });
  const saved = await prisma.interview.update({ where: { id }, data: { joinUrl: url?.trim() || null, webLink: url?.trim() || null, ...(notify ? { sequence: { increment: 1 } } : {}) } });
  if (notify && url) {
    const ctx = await loadContext(iv.candidateId, iv.panel.map((p) => p.interviewerId));
    await emailIcs(buildRequest(ctx, { ...iv, start: iv.startAt, end: iv.endAt, meetingLink: url }), id, saved.sequence, 'REQUEST', url);
  }
  await activity(iv.candidateId, 'interview', `${iv.round}: meeting link ${url ? 'added' : 'removed'}${notify && url ? ' and emailed to attendees' : ''}`, userId);
  return saved;
}

export type InterviewWithPanel = Prisma.InterviewGetPayload<{ include: { panel: { include: { interviewer: true } } } }>;
