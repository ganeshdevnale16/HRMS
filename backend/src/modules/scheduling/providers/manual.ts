import type { MeetingProvider } from './types.js';

/**
 * No-admin options — work without any Microsoft/Zoom app registration.
 *
 * TEAMS_MANUAL: HRMS books the slot and opens Teams/Outlook pre-filled (deep link) so the recruiter sends the real
 *   Teams invite from their own account. The join link can be pasted back into HRMS afterwards.
 * LINK: the recruiter pastes any meeting link they already created (Teams, Zoom, Meet, Webex…); HRMS emails a calendar
 *   invite (.ics) containing that link to the candidate and panel.
 */
export const teamsManual: MeetingProvider = {
  id: 'TEAMS_MANUAL', label: 'Teams — send from my Outlook',
  isConfigured: () => true,
  async create(req) { return { externalId: null, joinUrl: req.meetingLink ?? null, sendsInvites: true }; },
  async update(_id, req) { return { externalId: null, joinUrl: req.meetingLink ?? null, sendsInvites: true }; },
  async cancel() {},
  async test() { return 'Always available. You send the Teams invite from your own Outlook/Teams; no admin setup.'; },
};

export const linkProvider: MeetingProvider = {
  id: 'LINK', label: 'My own meeting link',
  isConfigured: () => true,
  async create(req) {
    if (!req.meetingLink) throw new Error('Paste the meeting link (Teams, Zoom, Google Meet…)');
    return { externalId: null, joinUrl: req.meetingLink, webLink: req.meetingLink, sendsInvites: false };
  },
  async update(_id, req) { return { externalId: null, joinUrl: req.meetingLink ?? null, sendsInvites: false }; },
  async cancel() {},
  async test() { return 'Always available. Invites with your link are emailed as calendar files.'; },
};
