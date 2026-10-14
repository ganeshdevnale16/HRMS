import { env, integrations } from '../../../config.js';
import { http, ProviderError, type MeetingProvider, type MeetingRequest } from './types.js';

/**
 * Zoom via a Server-to-Server OAuth app.
 * Zoom does not email calendar invites itself, so sendsInvites=false and the
 * scheduler sends .ics invites by email to the panel and the candidate.
 */
let cached: { token: string; exp: number } | null = null;
async function token() {
  if (!integrations.zoom) throw new ProviderError('Zoom', 'Zoom credentials are not configured');
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const basic = Buffer.from(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`).toString('base64');
  const r = await http('Zoom', `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${env.ZOOM_ACCOUNT_ID}`, {
    method: 'POST', headers: { Authorization: `Basic ${basic}` },
  });
  cached = { token: r.access_token, exp: Date.now() + r.expires_in * 1000 };
  return cached.token;
}
const zoom = async (method: string, path: string, json?: unknown) =>
  http('Zoom', `https://api.zoom.us/v2${path}`, { method, json, headers: { Authorization: `Bearer ${await token()}` } });

const body = (req: MeetingRequest) => ({
  topic: req.subject.slice(0, 200),
  type: 2,
  start_time: req.start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  duration: Math.round((req.end.getTime() - req.start.getTime()) / 60000),
  timezone: req.timezone,
  agenda: req.bodyHtml.replace(/<[^>]+>/g, ' ').slice(0, 1900),
  settings: { join_before_host: false, waiting_room: true, mute_upon_entry: true, approval_type: 2, auto_recording: 'none' },
});

export const zoomProvider: MeetingProvider = {
  id: 'ZOOM',
  label: 'Zoom',
  isConfigured: () => integrations.zoom,
  async create(req) {
    const m = await zoom('POST', `/users/${encodeURIComponent(env.ZOOM_HOST_USER)}/meetings`, body(req));
    return { externalId: String(m.id), joinUrl: m.join_url, webLink: m.join_url, password: m.password ?? null, sendsInvites: false };
  },
  async update(id, req) {
    await zoom('PATCH', `/meetings/${id}`, body(req));
    const m = await zoom('GET', `/meetings/${id}`);
    return { externalId: String(m.id), joinUrl: m.join_url, webLink: m.join_url, password: m.password ?? null, sendsInvites: false };
  },
  async cancel(id) {
    await zoom('DELETE', `/meetings/${id}?schedule_for_reminder=true`);
  },
  async test() {
    const u = await zoom('GET', `/users/${encodeURIComponent(env.ZOOM_HOST_USER)}`);
    return `Connected. Meetings will be hosted by ${u.email ?? env.ZOOM_HOST_USER}.`;
  },
};
