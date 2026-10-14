import { isResume, parseResume } from '../../../lib/resume.js';

/** Turns one email's resume attachments into candidate records, tagging the channel (Naukri, LinkedIn…). */
const CHANNELS: [RegExp, string][] = [[/naukri/i, 'Naukri'], [/linkedin/i, 'LinkedIn'], [/indeed/i, 'Indeed'], [/foundit|monster/i, 'Foundit'],
  [/shine\.com|shine/i, 'Shine'], [/timesjobs/i, 'TimesJobs'], [/instahyre/i, 'Instahyre'], [/apna/i, 'Apna'], [/hirist/i, 'Hirist'], [/iimjobs/i, 'IIMJobs']];

export async function recordsFromAttachments(meta: { id: string; from?: string; subject?: string },
  files: { name: string; mime: string; data: Buffer }[]) {
  const hay = `${meta.from ?? ''} ${meta.subject ?? ''}`;
  const via = CHANNELS.find(([re]) => re.test(hay))?.[1] ?? 'email';
  const out: Record<string, unknown>[] = [];
  const errors: string[] = [];
  for (const f of files) {
    if (!isResume(f.name, f.mime) || f.data.length > 10 * 1024 * 1024) continue;
    try {
      const { fields, text } = await parseResume(f.data, f.name, f.mime);
      out.push({ ...fields, externalId: `${meta.id}:${f.name}`, __via: via, __resume: { name: f.name, mime: f.mime, data: f.data, text } });
    } catch (e: any) { errors.push(e.message); }
  }
  return { records: out, errors };
}
