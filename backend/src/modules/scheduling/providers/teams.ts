import { env, integrations } from '../../../config.js';
import { graph } from './msgraph.js';
import type { MeetingProvider, MeetingRequest } from './types.js';

/**
 * Microsoft Teams via Microsoft Graph calendar events.
 * Creating an Outlook event with isOnlineMeeting=true generates the Teams link and
 * Exchange sends the invite to every attendee (interviewers and the candidate).
 * Required application permission: Calendars.ReadWrite (admin consent).
 * Recommended: restrict the app to the recruiting mailbox with an Exchange ApplicationAccessPolicy.
 */
const organizer = () => encodeURIComponent(env.MS_ORGANIZER_UPN!);
const toGraph = (d: Date) => ({ dateTime: d.toISOString().replace('Z', ''), timeZone: 'UTC' });

function body(req: MeetingRequest) {
  return {
    subject: req.subject,
    body: { contentType: 'HTML', content: req.bodyHtml },
    start: toGraph(req.start),
    end: toGraph(req.end),
    attendees: req.attendees.map((a) => ({ emailAddress: { address: a.email, name: a.name }, type: 'required' })),
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness',
    allowNewTimeProposals: false,
    responseRequested: true,
    transactionId: req.idempotencyKey,
  };
}

export const teams: MeetingProvider = {
  id: 'TEAMS',
  label: 'Microsoft Teams',
  isConfigured: () => integrations.teams,
  async create(req) {
    const ev = await graph('POST', `/users/${organizer()}/events`, body(req));
    return { externalId: ev.id, joinUrl: ev.onlineMeeting?.joinUrl ?? null, webLink: ev.webLink, sendsInvites: true };
  },
  async update(id, req) {
    const b = body(req) as any;
    delete b.transactionId;
    const ev = await graph('PATCH', `/users/${organizer()}/events/${encodeURIComponent(id)}`, b);
    return { externalId: ev.id, joinUrl: ev.onlineMeeting?.joinUrl ?? null, webLink: ev.webLink, sendsInvites: true };
  },
  async cancel(id, reason) {
    await graph('POST', `/users/${organizer()}/events/${encodeURIComponent(id)}/cancel`, { comment: reason ?? 'This interview has been cancelled.' });
  },
  async test() {
    await graph('GET', `/users/${organizer()}/calendar?$select=id,name`);
    return `Connected. Interviews will be organised from ${env.MS_ORGANIZER_UPN}.`;
  },
};
