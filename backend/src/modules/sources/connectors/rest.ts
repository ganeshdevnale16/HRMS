import type { DataSource } from '@prisma/client';
import type { Connector } from './types.js';

/**
 * Generic REST/JSON connector — configured, not coded. Works with ATS/HR APIs such as Greenhouse, Lever,
 * Workable, Zoho Recruit, SmartRecruiters, BambooHR, an agency's API or your own.
 *
 * config:
 *   url, method?, headers?, body?, recordsPath?            where the list is in the response, e.g. "data" or "candidates"
 *   authType: none | apiKey | bearer | basic | oauth2 | oauth2_refresh
 *   apiKeyHeader?, apiKeyInQuery?, authScheme?             e.g. "Zoho-oauthtoken" instead of "Bearer"
 *   tokenUrl?, scope?                                      for oauth2 / oauth2_refresh
 *   sinceParam?, sinceFormat?: iso | epochMs | epoch       incremental sync after the first run
 *   pagination?: none | page | offset | cursor | nextUrl
 *   pageParam?, pageSizeParam?, pageSize?, offsetParam?, cursorParam?, cursorPath?, nextUrlPath?, maxPages?
 * secret: apiKey | token | username+password | clientId+clientSecret(+refreshToken)
 */
export interface RestConfig {
  url: string; method?: string; headers?: Record<string, string>; body?: unknown; recordsPath?: string;
  authType?: 'none' | 'apiKey' | 'bearer' | 'basic' | 'oauth2' | 'oauth2_refresh'; apiKeyHeader?: string; apiKeyInQuery?: string; authScheme?: string;
  tokenUrl?: string; scope?: string;
  sinceParam?: string; sinceFormat?: 'iso' | 'epochMs' | 'epoch';
  pagination?: 'none' | 'page' | 'offset' | 'cursor' | 'nextUrl';
  pageParam?: string; pageSizeParam?: string; pageSize?: number; offsetParam?: string; cursorParam?: string; cursorPath?: string; nextUrlPath?: string; maxPages?: number;
}

const pick = (o: any, path?: string) => (path ? path.split('.').reduce((a, k) => a?.[k], o) : o);

async function token(c: RestConfig, s: Record<string, string> | null) {
  const grant = c.authType === 'oauth2_refresh'
    ? { grant_type: 'refresh_token', refresh_token: s?.refreshToken ?? '' }
    : { grant_type: 'client_credentials', ...(c.scope ? { scope: c.scope } : {}) };
  const r = await fetch(c.tokenUrl!, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: s?.clientId ?? '', client_secret: s?.clientSecret ?? '', ...grant }) });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`Token request failed (${r.status}) ${d.error ?? ''}`);
  return d.access_token as string;
}

async function authHeaders(c: RestConfig, s: Record<string, string> | null): Promise<Record<string, string>> {
  const scheme = c.authScheme || 'Bearer';
  switch (c.authType) {
    case 'apiKey': return c.apiKeyInQuery ? {} : { [c.apiKeyHeader || 'x-api-key']: s?.apiKey ?? '' };
    case 'bearer': return { Authorization: `${scheme} ${s?.token ?? ''}` };
    case 'basic': return { Authorization: `Basic ${Buffer.from(`${s?.username ?? ''}:${s?.password ?? ''}`).toString('base64')}` };
    case 'oauth2': case 'oauth2_refresh': return { Authorization: `${scheme} ${await token(c, s)}` };
    default: return {};
  }
}

const sinceValue = (d: Date, f?: string) => (f === 'epochMs' ? String(d.getTime()) : f === 'epoch' ? String(Math.floor(d.getTime() / 1000)) : d.toISOString());

export async function restFetch(src: Pick<DataSource, 'config' | 'lastSyncAt'>, secret: Record<string, string> | null, maxPagesOverride?: number) {
  const c = src.config as unknown as RestConfig;
  if (!c?.url) throw new Error('Endpoint URL is missing');
  const mode = c.pagination ?? (c.pageParam ? 'page' : 'none');
  const size = c.pageSize ?? 100;
  const maxPages = maxPagesOverride ?? c.maxPages ?? 50;
  const headers = { Accept: 'application/json', ...(c.body ? { 'Content-Type': 'application/json' } : {}), ...(c.headers ?? {}), ...(await authHeaders(c, secret)) };
  const all: Record<string, unknown>[] = [];
  let nextUrl: string | null = null, cursor: string | null = null;

  for (let page = 1; page <= maxPages; page++) {
    let url: URL;
    if (mode === 'nextUrl' && nextUrl) url = new URL(nextUrl);
    else {
      url = new URL(c.url);
      if (c.sinceParam && src.lastSyncAt) url.searchParams.set(c.sinceParam, sinceValue(src.lastSyncAt, c.sinceFormat));
      if (c.pageSizeParam) url.searchParams.set(c.pageSizeParam, String(size));
      if (mode === 'page') url.searchParams.set(c.pageParam || 'page', String(page));
      if (mode === 'offset') url.searchParams.set(c.offsetParam || 'offset', String((page - 1) * size));
      if (mode === 'cursor' && cursor) url.searchParams.set(c.cursorParam || 'cursor', cursor);
      if (c.authType === 'apiKey' && c.apiKeyInQuery) url.searchParams.set(c.apiKeyInQuery, secret?.apiKey ?? '');
    }
    const r = await fetch(url, { method: c.method ?? 'GET', headers, body: c.body ? JSON.stringify(c.body) : undefined });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 3000)); page--; continue; }
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} from ${url.host}${r.status === 401 || r.status === 403 ? ' — check the credentials' : ''}`);
    const data = await r.json();
    const recs = pick(data, c.recordsPath);
    if (!Array.isArray(recs)) throw new Error(`No list found at "${c.recordsPath || '(response root)'}". Set "Records are at" to the right path.`);
    all.push(...recs);
    if (mode === 'none') break;
    if (mode === 'page' || mode === 'offset') { if (recs.length < size) break; continue; }
    if (mode === 'cursor') { cursor = pick(data, c.cursorPath || 'next') ?? null; if (!cursor || !recs.length) break; continue; }
    if (mode === 'nextUrl') { nextUrl = pick(data, c.nextUrlPath || 'next') ?? null; if (!nextUrl) break; }
  }
  return all;
}

export const restConnector: Connector = {
  type: 'rest', label: 'REST API', pull: true,
  async fetch(src, secret, opts) { return { records: await restFetch(src, secret, opts?.preview ? 1 : undefined) }; },
  async test(src, secret) {
    const recs = await restFetch({ ...src, lastSyncAt: null }, secret, 1);
    return `Connected. The first page returned ${recs.length} records.`;
  },
};
