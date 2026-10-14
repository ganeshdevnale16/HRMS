import type { Interviewer } from '@prisma/client';
import { graph } from '../providers/msgraph.js';
import { gcal } from '../providers/google.js';
import { env, integrations } from '../../../config.js';
import { prisma } from '../../../db.js';

export interface Busy { start: Date; end: Date; source: 'calendar' | 'hrms' }

/**
 * Busy time for each interviewer, combining:
 *  - their Outlook calendar (Graph getSchedule) or Google calendar (freeBusy), when connected
 *  - interviews already booked in HRMS
 * A calendar lookup failure never blocks scheduling; it is reported as a warning.
 */
export async function getBusy(interviewers: Interviewer[], from: Date, to: Date, excludeInterviewId?: string) {
  const busy = new Map<string, Busy[]>(interviewers.map((i) => [i.id, []]));
  const warnings: string[] = [];

  const outlook = interviewers.filter((i) => i.calendarProvider === 'OUTLOOK');
  if (outlook.length && integrations.outlookCalendar && env.MS_ORGANIZER_UPN) {
    for (let k = 0; k < outlook.length; k += 20) {
      const batch = outlook.slice(k, k + 20);
      try {
        const r = await graph('POST', `/users/${encodeURIComponent(env.MS_ORGANIZER_UPN)}/calendar/getSchedule`, {
          schedules: batch.map((i) => i.email),
          startTime: { dateTime: from.toISOString().replace('Z', ''), timeZone: 'UTC' },
          endTime: { dateTime: to.toISOString().replace('Z', ''), timeZone: 'UTC' },
          availabilityViewInterval: 15,
        }, { Prefer: 'outlook.timezone="UTC"' });
        for (const s of r.value ?? []) {
          const iv = batch.find((i) => i.email.toLowerCase() === String(s.scheduleId).toLowerCase());
          if (!iv) continue;
          if (s.error) { warnings.push(`Outlook calendar unavailable for ${iv.name}: ${s.error.message}`); continue; }
          for (const it of s.scheduleItems ?? []) {
            if (it.status === 'free' || it.status === 'workingElsewhere') continue;
            busy.get(iv.id)!.push({ start: new Date(it.start.dateTime + 'Z'), end: new Date(it.end.dateTime + 'Z'), source: 'calendar' });
          }
        }
      } catch (e: any) { warnings.push(`Outlook availability check failed: ${e.message}`); }
    }
  } else if (outlook.length) warnings.push('Outlook calendar is not connected; only HRMS bookings were checked for some interviewers.');

  const google = interviewers.filter((i) => i.calendarProvider === 'GOOGLE');
  if (google.length && integrations.googleCalendar && env.GOOGLE_ORGANIZER_EMAIL) {
    try {
      const r = await gcal(env.GOOGLE_ORGANIZER_EMAIL, 'POST', '/freeBusy', {
        timeMin: from.toISOString(), timeMax: to.toISOString(), items: google.map((i) => ({ id: i.email })),
      });
      for (const iv of google) {
        const c = r.calendars?.[iv.email];
        if (c?.errors?.length) { warnings.push(`Google calendar unavailable for ${iv.name}`); continue; }
        for (const b of c?.busy ?? []) busy.get(iv.id)!.push({ start: new Date(b.start), end: new Date(b.end), source: 'calendar' });
      }
    } catch (e: any) { warnings.push(`Google availability check failed: ${e.message}`); }
  } else if (google.length) warnings.push('Google calendar is not connected; only HRMS bookings were checked for some interviewers.');

  const booked = await prisma.interviewPanelist.findMany({
    where: { interviewerId: { in: interviewers.map((i) => i.id) }, interview: { ...(excludeInterviewId ? { id: { not: excludeInterviewId } } : {}), status: { in: ['SCHEDULED', 'CONFIRMED'] }, startAt: { lt: to }, endAt: { gt: from } } },
    include: { interview: { select: { startAt: true, endAt: true } } },
  });
  for (const b of booked) busy.get(b.interviewerId)!.push({ start: b.interview.startAt, end: b.interview.endAt, source: 'hrms' });

  return { busy, warnings };
}
