import type { MeetingProviderId } from '@prisma/client';
import { teams } from './teams.js';
import { zoomProvider } from './zoom.js';
import { googleMeet } from './googleMeet.js';
import { webex } from './webex.js';
import { inPerson, phone } from './offline.js';
import { jitsi } from './jitsi.js';
import type { MeetingProvider } from './types.js';
import { HttpError } from '../../../middleware/http.js';

/** Register a new meeting platform by adding it here. */
export const meetingProviders: Record<MeetingProviderId, MeetingProvider> = {
  TEAMS: teams, ZOOM: zoomProvider, GOOGLE_MEET: googleMeet, WEBEX: webex, JITSI: jitsi, IN_PERSON: inPerson, PHONE: phone,
};

export function getProvider(id: MeetingProviderId) {
  const p = meetingProviders[id];
  if (!p) throw new HttpError(400, `Unknown meeting platform ${id}`);
  if (!p.isConfigured()) throw new HttpError(400, `${p.label} is not connected. An admin can connect it under Integrations.`);
  return p;
}
