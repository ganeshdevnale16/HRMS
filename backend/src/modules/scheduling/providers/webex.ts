import { env, integrations } from '../../../config.js';
import { http, type MeetingProvider, type MeetingRequest } from './types.js';

/** Cisco Webex Meetings REST API. Webex emails invitees when sendEmail=true. */
const wx = (method: string, path: string, json?: unknown) =>
  http('Webex', `https://webexapis.com/v1${path}`, { method, json, headers: { Authorization: `Bearer ${env.WEBEX_ACCESS_TOKEN}` } });

const body = (req: MeetingRequest) => ({
  title: req.subject.slice(0, 128),
  agenda: req.bodyHtml.replace(/<[^>]+>/g, ' ').slice(0, 1300),
  start: req.start.toISOString(),
  end: req.end.toISOString(),
  timezone: req.timezone,
  enabledJoinBeforeHost: false,
  sendEmail: true,
  invitees: req.attendees.map((a) => ({ email: a.email, displayName: a.name })),
});

export const webex: MeetingProvider = {
  id: 'WEBEX',
  label: 'Cisco Webex',
  isConfigured: () => integrations.webex,
  async create(req) {
    const m = await wx('POST', '/meetings', body(req));
    return { externalId: m.id, joinUrl: m.webLink, webLink: m.webLink, password: m.password ?? null, sendsInvites: true };
  },
  async update(id, req) {
    const m = await wx('PUT', `/meetings/${encodeURIComponent(id)}`, body(req));
    return { externalId: m.id, joinUrl: m.webLink, webLink: m.webLink, password: m.password ?? null, sendsInvites: true };
  },
  async cancel(id) {
    await wx('DELETE', `/meetings/${encodeURIComponent(id)}?sendEmail=true`);
  },
  async test() {
    const me = await wx('GET', '/people/me');
    return `Connected as ${me.displayName}.`;
  },
};
