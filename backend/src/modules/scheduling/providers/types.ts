import type { MeetingProviderId } from '@prisma/client';

export interface Attendee { email: string; name: string; role: 'candidate' | 'interviewer' }

export interface MeetingRequest {
  subject: string;
  bodyHtml: string;
  start: Date;
  end: Date;
  timezone: string;
  attendees: Attendee[];
  /** Stable key so a retried request does not create a second meeting. */
  idempotencyKey: string;
  location?: string;
}

export interface MeetingResult {
  externalId: string | null;
  joinUrl?: string | null;
  webLink?: string | null;
  password?: string | null;
  /** True when the platform itself emails calendar invites to attendees (Teams, Google Meet, Webex). */
  sendsInvites: boolean;
}

export interface MeetingProvider {
  id: MeetingProviderId;
  label: string;
  isConfigured(): boolean;
  create(req: MeetingRequest): Promise<MeetingResult>;
  update(externalId: string, req: MeetingRequest): Promise<MeetingResult>;
  cancel(externalId: string, reason?: string): Promise<void>;
  /** Lightweight call proving the credentials work. Returns a human-readable status. */
  test(): Promise<string>;
}

export class ProviderError extends Error {
  constructor(public provider: string, message: string, public status?: number) { super(`${provider}: ${message}`); }
}

export async function http(provider: string, url: string, init: RequestInit & { json?: unknown } = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(init.headers as any) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const msg = (data as any)?.error?.message || (data as any)?.message || (typeof data === 'string' ? data : res.statusText);
    throw new ProviderError(provider, `${res.status} ${msg}`, res.status);
  }
  return data as any;
}
