import { env } from '../../../config.js';
import { http, ProviderError } from './types.js';

let cached: { token: string; exp: number } | null = null;

/** App-only (client credentials) token for Microsoft Graph. */
export async function graphToken() {
  if (!env.MS_TENANT_ID || !env.MS_CLIENT_ID || !env.MS_CLIENT_SECRET) throw new ProviderError('Microsoft', 'Graph credentials are not configured');
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const body = new URLSearchParams({
    client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
  });
  const r = await http('Microsoft', `https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  cached = { token: r.access_token, exp: Date.now() + r.expires_in * 1000 };
  return cached.token;
}

export async function graph(method: string, path: string, json?: unknown, headers: Record<string, string> = {}) {
  const token = await graphToken();
  return http('Microsoft Teams', `https://graph.microsoft.com/v1.0${path}`, {
    method, json, headers: { Authorization: `Bearer ${token}`, ...headers },
  });
}
