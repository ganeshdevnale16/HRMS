import * as XLSX from 'xlsx';
import type { Connector } from './types.js';

/**
 * CSV / Excel at a URL — free and very practical:
 *  • Google Forms → responses Google Sheet → Share "Anyone with the link: Viewer" → paste the sheet link here
 *  • Microsoft Forms / Excel Online published links, agency-shared sheets, nightly exports from any system
 * config: { url }
 */
export function toDownloadUrl(u: string) {
  const g = u.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
  if (g) { const gid = u.match(/[#&?]gid=(\d+)/)?.[1] ?? '0'; return `https://docs.google.com/spreadsheets/d/${g[1]}/export?format=csv&gid=${gid}`; }
  return u;
}

export async function fetchSheet(url: string) {
  const r = await fetch(toDownloadUrl(url), { redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — is the sheet shared as "Anyone with the link"?`);
  const type = r.headers.get('content-type') ?? '';
  if (type.includes('text/html')) throw new Error('The link returned a web page, not a file. Share the sheet as "Anyone with the link: Viewer".');
  const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
}

export const csvUrlConnector: Connector = {
  type: 'csvurl', label: 'Google Sheet / CSV link', pull: true,
  async fetch(src, _s, opts) { const rows = await fetchSheet((src.config as any).url); return { records: opts?.preview ? rows.slice(0, 5) : rows }; },
  async test(src) { const rows = await fetchSheet((src.config as any).url); return `Connected. ${rows.length} rows, columns: ${Object.keys(rows[0] ?? {}).join(', ')}`; },
};
