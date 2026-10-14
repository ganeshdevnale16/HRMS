const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line: string) => line.match(/.{1,73}/g)!.join('\r\n ');

export interface IcsEvent {
  uid: string; sequence: number; method: 'REQUEST' | 'CANCEL';
  start: Date; end: Date; summary: string; description: string; location?: string | null;
  organizer: { name: string; email: string }; attendees: { name: string; email: string }[];
}

/** RFC 5545 invite that Outlook, Gmail and Apple Calendar accept. */
export function buildIcs(e: IcsEvent) {
  const lines = [
    'BEGIN:VCALENDAR', 'PRODID:-//HRMS//Recruitment//EN', 'VERSION:2.0', 'CALSCALE:GREGORIAN', `METHOD:${e.method}`,
    'BEGIN:VEVENT', `UID:${e.uid}`, `SEQUENCE:${e.sequence}`, `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(e.start)}`, `DTEND:${fmt(e.end)}`, `SUMMARY:${esc(e.summary)}`, `DESCRIPTION:${esc(e.description)}`,
    ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
    `ORGANIZER;CN=${esc(e.organizer.name)}:mailto:${e.organizer.email}`,
    ...e.attendees.map((a) => `ATTENDEE;CN=${esc(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`),
    `STATUS:${e.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(e.method === 'REQUEST' ? ['BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:Interview reminder', 'END:VALARM'] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n');
}
