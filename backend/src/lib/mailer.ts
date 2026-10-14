import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config.js';
import { prisma } from '../db.js';
import { decrypt } from './crypto.js';
import { graph } from '../modules/scheduling/providers/msgraph.js';

/**
 * Outgoing email for HRMS: interview invites, candidate emails, notifications.
 * Configured in the app (Integrations → Email, stored encrypted) or in .env (SMTP_*).
 *  - smtp:  Gmail / Google Workspace (App Password), Outlook.com, Zoho, Brevo, SendGrid, Amazon SES, any SMTP server
 *  - graph: Microsoft 365 via Microsoft Graph (uses the Azure app from Teams + Mail.Send permission) — for tenants where SMTP AUTH is disabled
 */
export interface MailConfig {
  provider: 'smtp' | 'graph' | 'brevo' | 'none';
  apiKey?: string;
  host?: string; port?: number; secure?: boolean; user?: string; password?: string;
  fromEmail?: string; fromName?: string; replyTo?: string;
  source?: 'database' | 'environment';
}

let cache: { at: number; cfg: MailConfig; transport: Transporter | null } | null = null;
export function clearMailCache() { cache = null; }

function envConfig(): MailConfig {
  if (!env.SMTP_HOST) return { provider: 'none' };
  const m = env.MAIL_FROM.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  return { provider: 'smtp', host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, user: env.SMTP_USER, password: env.SMTP_PASS,
    fromName: m?.[1]?.trim() || 'Recruiting', fromEmail: m?.[2] ?? env.SMTP_USER, source: 'environment' };
}

export async function getMailConfig(): Promise<MailConfig> {
  if (cache && Date.now() - cache.at < 30_000) return cache.cfg;
  const row = await prisma.setting.findUnique({ where: { key: 'email' } }).catch(() => null);
  const cfg: MailConfig = row ? { ...decrypt<MailConfig>(row.valueEnc)!, source: 'database' } : envConfig();
  const transport = cfg.provider === 'smtp' && cfg.host ? createTransport(cfg) : null;
  cache = { at: Date.now(), cfg, transport };
  return cfg;
}

export const createTransport = (c: MailConfig) => nodemailer.createTransport({
  host: c.host, port: c.port ?? 587, secure: c.secure ?? c.port === 465,
  auth: c.user ? { user: c.user, pass: c.password } : undefined, connectionTimeout: 15_000, greetingTimeout: 15_000,
});

export interface Mail { to: string | string[]; subject: string; html: string; text?: string; replyTo?: string; ics?: { method: 'REQUEST' | 'CANCEL'; content: string } }

/** Sends with the current settings, or with an explicit (unsaved) config for "Test". */
export async function sendMail(m: Mail, override?: MailConfig): Promise<{ delivered: boolean; id?: string; reason?: string }> {
  const cfg = override ?? (await getMailConfig());
  const to = Array.isArray(m.to) ? m.to : [m.to];
  if (cfg.provider === 'none') {
    console.info(`[mail:not-configured] to=${to.join(',')} subject="${m.subject}"`);
    return { delivered: false, reason: 'Email is not set up. An admin can connect it under Integrations → Email.' };
  }
  const from = cfg.fromName ? `"${cfg.fromName.replace(/"/g, '')}" <${cfg.fromEmail}>` : cfg.fromEmail!;

  if (cfg.provider === 'brevo') {
    // HTTPS API (port 443) — works on hosts that block SMTP ports, e.g. Render's free plan.
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': cfg.apiKey ?? '', 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: cfg.fromEmail, ...(cfg.fromName ? { name: cfg.fromName } : {}) }, to: to.map((email) => ({ email })),
        subject: m.subject, htmlContent: m.html, ...(m.text ? { textContent: m.text } : {}),
        ...(m.replyTo || cfg.replyTo ? { replyTo: { email: m.replyTo || cfg.replyTo } } : {}),
        ...(m.ics ? { attachment: [{ name: 'invite.ics', content: Buffer.from(m.ics.content).toString('base64') }] } : {}),
      }),
    });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Brevo ${r.status}: ${d.message ?? r.statusText}${r.status === 401 ? ' — check the API key' : /sender/i.test(d.message ?? '') ? ' — verify the "From" address in Brevo → Senders' : ''}`);
    return { delivered: true, id: d.messageId };
  }

  if (cfg.provider === 'graph') {
    await graph('POST', `/users/${encodeURIComponent(cfg.fromEmail!)}/sendMail`, {
      message: {
        subject: m.subject, body: { contentType: 'HTML', content: m.html },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
        ...(m.replyTo || cfg.replyTo ? { replyTo: [{ emailAddress: { address: m.replyTo || cfg.replyTo } }] } : {}),
        ...(m.ics ? { attachments: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'invite.ics', contentType: `text/calendar; method=${m.ics.method}`, contentBytes: Buffer.from(m.ics.content).toString('base64') }] } : {}),
      },
      saveToSentItems: true,
    });
    return { delivered: true };
  }

  const transport = override ? createTransport(cfg) : (cache?.transport ?? createTransport(cfg));
  const info = await transport.sendMail({
    from, to, subject: m.subject, html: m.html, text: m.text, replyTo: m.replyTo || cfg.replyTo,
    icalEvent: m.ics ? { method: m.ics.method, content: m.ics.content, filename: 'invite.ics' } : undefined,
  });
  return { delivered: true, id: info.messageId };
}
