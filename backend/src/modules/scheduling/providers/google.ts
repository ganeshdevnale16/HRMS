import { JWT } from 'google-auth-library';
import { env, integrations } from '../../../config.js';
import { ProviderError } from './types.js';

/**
 * Google Workspace service account with domain-wide delegation.
 * Delegated scope: https://www.googleapis.com/auth/calendar
 */
const clients = new Map<string, JWT>();
export function googleClient(subject: string) {
  if (!integrations.googleCalendar) throw new ProviderError('Google', 'Google service account is not configured');
  if (!clients.has(subject)) {
    clients.set(subject, new JWT({
      email: env.GOOGLE_SA_EMAIL,
      key: env.GOOGLE_SA_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/calendar'],
      subject,
    }));
  }
  return clients.get(subject)!;
}

export async function gcal<T = any>(subject: string, method: string, url: string, data?: unknown): Promise<T> {
  try {
    const r = await googleClient(subject).request<T>({ url: `https://www.googleapis.com/calendar/v3${url}`, method: method as any, data });
    return r.data;
  } catch (e: any) {
    throw new ProviderError('Google', e?.response?.data?.error?.message ?? e.message, e?.response?.status);
  }
}
