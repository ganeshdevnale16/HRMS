const BASE = (import.meta as any).env?.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) { super(message); }
}

export const auth = {
  get token() { return localStorage.getItem('hrms_token'); },
  get user() { const u = localStorage.getItem('hrms_user'); return u ? JSON.parse(u) : null; },
  set(token: string, user: unknown) { localStorage.setItem('hrms_token', token); localStorage.setItem('hrms_user', JSON.stringify(user)); },
  clear() { localStorage.removeItem('hrms_token'); localStorage.removeItem('hrms_user'); },
};

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'), headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  if (res.status === 401 && !path.startsWith('/auth/login')) { auth.clear(); location.href = '/login'; }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details);
  return data as T;
}

/** Opens a protected file (e.g. a resume) in a new tab. */
export async function openFile(path: string) {
  const res = await fetch(BASE + path, { headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.error ?? 'Could not open the file');
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Downloads a protected file (e.g. a CSV export) with the user's login. */
export async function downloadFile(path: string, fallbackName: string) {
  const res = await fetch(BASE + path, { headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.error ?? 'Download failed');
  const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob()); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

export const STAGES = ['SOURCED', 'SCREENING', 'COMMUNICATION', 'INTERVIEW', 'SELECTION', 'HIRING', 'BGV', 'JOINING', 'BILLING'] as const;
export const ROUNDS = ['L1 Technical', 'L2 Technical', 'Managerial', 'Client round', 'HR'];
export const PROVIDER_LABEL: Record<string, string> = { TEAMS: 'Microsoft Teams', ZOOM: 'Zoom', GOOGLE_MEET: 'Google Meet', WEBEX: 'Cisco Webex', TEAMS_MANUAL: 'Teams (from my Outlook)', LINK: 'Own meeting link', JITSI: 'Jitsi Meet (free)', IN_PERSON: 'In person', PHONE: 'Phone call' };
export const human = (s?: string | null) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '—');
export const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDT = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
export const fmtTime = (d: string) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
export const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
