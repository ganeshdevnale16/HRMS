import type { MeetingProvider } from './types.js';

/** In-person and phone interviews: no meeting link, invites are sent as .ics email by the scheduler. */
const offline = (id: 'IN_PERSON' | 'PHONE', label: string): MeetingProvider => ({
  id, label,
  isConfigured: () => true,
  async create() { return { externalId: null, sendsInvites: false }; },
  async update() { return { externalId: null, sendsInvites: false }; },
  async cancel() {},
  async test() { return 'Always available. Invites are sent by email.'; },
});

export const inPerson = offline('IN_PERSON', 'In person');
export const phone = offline('PHONE', 'Phone call');
