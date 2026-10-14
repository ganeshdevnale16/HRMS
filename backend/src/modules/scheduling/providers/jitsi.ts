import crypto from 'node:crypto';
import { env, integrations } from '../../../config.js';
import type { MeetingProvider } from './types.js';

/**
 * Jitsi Meet: free video meetings with no API or account. HRMS generates a hard-to-guess room URL
 * and emails .ics invites itself. On meet.jit.si the first person to join signs in to start the room.
 * For a private deployment, self-host Jitsi and set JITSI_DOMAIN.
 */
const room = (key: string) => `HRMS-${key.slice(-8)}-${crypto.randomBytes(6).toString('hex')}`;
const url = (r: string) => `https://${env.JITSI_DOMAIN}/${r}`;

export const jitsi: MeetingProvider = {
  id: 'JITSI',
  label: 'Jitsi Meet (free)',
  isConfigured: () => integrations.jitsi,
  async create(req) { const r = room(req.idempotencyKey); return { externalId: r, joinUrl: url(r), webLink: url(r), sendsInvites: false }; },
  async update(id) { return { externalId: id, joinUrl: url(id), webLink: url(id), sendsInvites: false }; },
  async cancel() {},
  async test() { return `Rooms are created on ${env.JITSI_DOMAIN}.`; },
};
