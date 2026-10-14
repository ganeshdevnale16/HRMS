/**
 * Pure resume text helpers (no database). Unit-tested in backend/tests/resume.test.ts.
 * PDF text uses Mozilla pdf.js (pdfjs-dist), which handles PDFs from Word, Google Docs, LaTeX, Canva, ReportLab etc.
 * DOCX text is read directly from the document XML (no extra dependency).
 */
export const RESUME_EXT = /\.(pdf|docx|txt|rtf)$/i;
export const isResume = (name: string, mime?: string) => RESUME_EXT.test(name) || /pdf|wordprocessingml|text\/plain/.test(mime ?? '');

import { inflateRawSync } from 'node:zlib';

/** Reads one entry from a ZIP archive (DOCX files are ZIP archives). No dependency needed. */
function unzipEntry(buf: Buffer, wanted: string): Buffer | null {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a valid DOCX (zip) file');
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let k = 0; k < count && buf.readUInt32LE(p) === 0x02014b50; k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loc = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (name === wanted) {
      const start = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28);
      const data = buf.subarray(start, start + csize);
      return method === 0 ? data : inflateRawSync(data);
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

function docxText(data: Buffer): string {
  const xml = unzipEntry(data, 'word/document.xml');
  if (!xml) throw new Error('not a Word document (word/document.xml missing)');
  return xml.toString('utf8')
    .replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
}

async function pdfText(data: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, 15); i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let line = '';
      const lines: string[] = [];
      for (const it of tc.items as any[]) {
        if (typeof it.str !== 'string') continue;
        line += it.str;
        if (it.hasEOL) { lines.push(line); line = ''; } else if (it.str && !it.str.endsWith(' ')) line += ' ';
      }
      if (line.trim()) lines.push(line);
      pages.push(lines.map((l) => l.replace(/\s+/g, ' ').trim()).join('\n'));
    }
    return pages.join('\n');
  } finally { await doc.destroy(); }
}

export async function extractText(data: Buffer, name: string, mime?: string): Promise<string> {
  const n = name.toLowerCase();
  let text: string;
  try {
    if (n.endsWith('.pdf') || mime === 'application/pdf') text = await pdfText(data);
    else if (n.endsWith('.docx') || mime?.includes('wordprocessingml')) text = docxText(data);
    else if (n.endsWith('.txt') || n.endsWith('.rtf') || mime?.startsWith('text/')) text = data.toString('utf8');
    else if (n.endsWith('.doc')) throw new Error('old .doc files are not supported — save it as PDF or DOCX');
    else throw new Error('unsupported file type — use PDF, DOCX or TXT');
  } catch (e: any) {
    if (/not supported|unsupported/.test(e.message)) throw e;
    if (/password/i.test(e.message)) throw new Error('the PDF is password-protected');
    throw new Error(`the file could not be read (${e.message})`);
  }
  text = text.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').trim();
  if (text.replace(/\s/g, '').length < 40) throw new Error('no readable text — it looks like a scanned image. Ask for a PDF exported from Word/Google Docs.');
  return text;
}

export const BASE_SKILLS = ['Java', 'Spring Boot', 'Hibernate', 'Python', 'JavaScript', 'TypeScript', 'React', 'Redux', 'Angular', 'Next.js', 'Node.js', 'SQL', 'PostgreSQL', 'MySQL', 'MongoDB',
  'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Microservices', 'Kafka', 'Spark', 'Databricks', 'Airflow', 'Hadoop', 'Power BI', 'Tableau', 'Excel', 'SAP', 'SAP FICO',
  'S/4HANA', 'Salesforce', '.NET', 'C#', 'C++', 'Golang', 'Machine Learning', 'Data Science', 'DevOps', 'Jenkins', 'Git', 'Linux', 'Selenium', 'Jest', 'REST APIs',
  'HTML', 'CSS', 'PHP', 'Tally', 'GST', 'Accounting', 'Taxation', 'Audit', 'IFRS', 'Recruitment', 'Payroll'];

const esc = (s: string) => s.replace(/[.+*?^$()[\]{}|\\/]/g, '\\$&');
const SECTION = /^(summary|profile|objective|skills?|technical skills|experience|work experience|employment|education|projects|certifications?|contact|other details|personal details)\b/i;

/** Rule-based parser: always runs; AI results (when configured) take priority field by field. */
export function heuristicParse(text: string, skills: string[] = BASE_SKILLS) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/)?.[0];
  const phoneRaw = text.match(/(?:\+?91[\s-]?)?[6-9]\d{2}[\s-]?\d{2}[\s-]?\d{5}|(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}|(?:\+?91[\s-]?)?[6-9]\d{9}/)?.[0];
  const phone = phoneRaw ? phoneRaw.replace(/\D/g, '').slice(-10) : undefined;
  const name = lines.slice(0, 8).find((l) => /^[A-Za-z][A-Za-z .'-]{2,40}$/.test(l) && l.split(/\s+/).length >= 2 && l.split(/\s+/).length <= 4
    && !SECTION.test(l) && !/resume|curriculum|vitae|engineer|developer|consultant|manager|analyst/i.test(l));
  const exp = text.match(/(\d{1,2}(?:\.\d)?)\+?\s*(?:years|yrs)/i)?.[1];
  const low = ` ${text.toLowerCase()} `;
  const found = skills.filter((s) => new RegExp(`(^|[^a-z0-9])${esc(s.toLowerCase())}([^a-z0-9]|$)`).test(low));
  const lpa = (label: RegExp) => { const m = text.match(new RegExp(`${label.source}[^\\d]{0,20}(\\d{1,3}(?:\\.\\d+)?)\\s*(?:lpa|lakhs?|l\\b)`, 'i')); return m ? Number(m[1]) : undefined; };
  const notice = /immediate/i.test(text.match(/notice[^\n]{0,40}/i)?.[0] ?? '') ? 0
    : (() => { const m = text.match(/notice(?:\s*period)?[^\d\n]{0,15}(\d{1,3})\s*(days?|months?)/i); return m ? Number(m[1]) * (/month/i.test(m[2]) ? 30 : 1) : undefined; })();
  const cityLine = lines.slice(0, 6).find((l) => l.includes('|') || l.includes('@'));
  const location = cityLine?.split('|').map((x) => x.trim()).find((x) => /^[A-Za-z][A-Za-z ,.-]{2,40}$/.test(x) && !x.includes('@'))?.split(',')[0];
  const eduLine = lines.find((l) => /\b(B\.?\s?E\.?|B\.?\s?Tech|M\.?\s?Tech|B\.?\s?Com|M\.?\s?Com|MBA|MCA|BCA|B\.?\s?Sc|M\.?\s?Sc|CA\b|Ph\.?D)/.test(l) && l.length < 160);
  return { name, email: email?.toLowerCase(), phone, location, expYears: exp ? Number(exp) : undefined, skills: found,
    currentCtc: lpa(/current\s*ctc/), expectedCtc: lpa(/expected\s*ctc/), noticeDays: notice, education: eduLine };
}
