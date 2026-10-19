/**
 * Links that open the user's OWN Teams / Outlook pre-filled — no app registration or admin consent needed.
 * Teams deep link reference: https://learn.microsoft.com/microsoftteams/platform/concepts/build-and-test/deep-link-workflow
 */
const q = (o: Record<string, string | undefined>) =>
  Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');

export interface MeetingDraft { subject: string; start: Date; end: Date; attendees: string[]; body: string; location?: string }

/** Opens the Teams "New meeting" form with subject, time, attendees and details filled in. */
export const teamsMeetingLink = (m: MeetingDraft) =>
  `https://teams.microsoft.com/l/meeting/new?${q({ subject: m.subject, startTime: m.start.toISOString(), endTime: m.end.toISOString(), attendees: m.attendees.filter(Boolean).join(','), content: m.body })}`;

/** Opens a new event in Outlook on the web (turn on the "Teams meeting" switch there). */
export const outlookEventLink = (m: MeetingDraft) =>
  `https://outlook.office.com/calendar/deeplink/compose?${q({ subject: m.subject, startdt: m.start.toISOString(), enddt: m.end.toISOString(), to: m.attendees.filter(Boolean).join(','), body: m.body, location: m.location })}`;

/** Opens a new email in Outlook on the web. */
export const outlookMailLink = (to: string[], subject: string, body: string) =>
  `https://outlook.office.com/mail/deeplink/compose?${q({ to: to.join(','), subject, body })}`;

/** Opens a new email in the computer's default mail app (desktop Outlook, Mail, Gmail if set as default). */
export const mailtoLink = (to: string[], subject: string, body: string) =>
  `mailto:${to.map(encodeURIComponent).join(',')}?${q({ subject, body })}`;

/** Builds the interview invite text used in Teams/Outlook drafts. */
export function interviewDraft(iv: { round: string; startAt: string; endAt: string; candidate: { name: string; email?: string | null }; requirement?: { position?: string; code?: string } | null; panel: { interviewer: { name: string; email: string } }[]; location?: string | null; notes?: string | null }): MeetingDraft {
  const role = iv.requirement?.position ? ` – ${iv.requirement.position}` : '';
  return {
    subject: `Interview: ${iv.candidate.name}${role} (${iv.round})`,
    start: new Date(iv.startAt), end: new Date(iv.endAt),
    attendees: [...iv.panel.map((p) => p.interviewer.email), iv.candidate.email ?? ''].filter(Boolean),
    body: `${iv.round} for ${iv.requirement?.position ?? 'the role'}${iv.requirement?.code ? ` (${iv.requirement.code})` : ''}.\nCandidate: ${iv.candidate.name}\nPanel: ${iv.panel.map((p) => p.interviewer.name).join(', ')}${iv.notes ? `\n\n${iv.notes}` : ''}`,
    location: iv.location ?? undefined,
  };
}
