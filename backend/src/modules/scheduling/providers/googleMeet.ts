import { env, integrations } from '../../../config.js';
import { gcal } from './google.js';
import type { MeetingProvider, MeetingRequest } from './types.js';

/** Google Meet: a Google Calendar event with a Meet conference. Google emails invites (sendUpdates=all). */
const cal = () => encodeURIComponent(env.GOOGLE_ORGANIZER_EMAIL!);
const body = (req: MeetingRequest, withConference: boolean) => ({
  summary: req.subject,
  description: req.bodyHtml,
  start: { dateTime: req.start.toISOString(), timeZone: req.timezone },
  end: { dateTime: req.end.toISOString(), timeZone: req.timezone },
  attendees: req.attendees.map((a) => ({ email: a.email, displayName: a.name })),
  guestsCanModify: false,
  guestsCanInviteOthers: false,
  ...(withConference ? { conferenceData: { createRequest: { requestId: req.idempotencyKey, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
});

export const googleMeet: MeetingProvider = {
  id: 'GOOGLE_MEET',
  label: 'Google Meet',
  isConfigured: () => integrations.googleMeet,
  async create(req) {
    const ev = await gcal(env.GOOGLE_ORGANIZER_EMAIL!, 'POST', `/calendars/${cal()}/events?conferenceDataVersion=1&sendUpdates=all`, body(req, true));
    return { externalId: ev.id, joinUrl: ev.hangoutLink ?? null, webLink: ev.htmlLink, sendsInvites: true };
  },
  async update(id, req) {
    const ev = await gcal(env.GOOGLE_ORGANIZER_EMAIL!, 'PATCH', `/calendars/${cal()}/events/${encodeURIComponent(id)}?sendUpdates=all`, body(req, false));
    return { externalId: ev.id, joinUrl: ev.hangoutLink ?? null, webLink: ev.htmlLink, sendsInvites: true };
  },
  async cancel(id) {
    await gcal(env.GOOGLE_ORGANIZER_EMAIL!, 'DELETE', `/calendars/${cal()}/events/${encodeURIComponent(id)}?sendUpdates=all`);
  },
  async test() {
    const c = await gcal(env.GOOGLE_ORGANIZER_EMAIL!, 'GET', `/calendars/${cal()}`);
    return `Connected to calendar ${c.summary ?? env.GOOGLE_ORGANIZER_EMAIL}.`;
  },
};
