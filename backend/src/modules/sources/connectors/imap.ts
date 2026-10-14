import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { Connector } from './types.js';
import { recordsFromAttachments } from './mailParse.js';

/**
 * Resume inbox over IMAP — works with Gmail / Google Workspace (App Password), Zoho Mail, GoDaddy, Hostinger,
 * Rediffmail Pro and any IMAP mailbox. Forward job-portal application emails (Naukri, LinkedIn, Indeed…) and
 * agency emails to this inbox; every attached resume becomes a candidate.
 * Microsoft 365 / Outlook mailboxes: use the "Microsoft 365 mailbox" connector instead (IMAP passwords are blocked there).
 *
 * config: { host, port=993, secure=true, mailbox='INBOX', firstSyncDays=7, maxMessages=200, markSeen=true, moveTo? }
 * secret: { user, password }   (Gmail: myaccount.google.com → Security → App passwords)
 */
async function withMailbox<T>(cfg: any, secret: Record<string, string> | null, fn: (c: ImapFlow) => Promise<T>) {
  const client = new ImapFlow({ host: cfg.host, port: Number(cfg.port ?? 993), secure: cfg.secure !== false, auth: { user: secret?.user ?? '', pass: secret?.password ?? '' }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock(cfg.mailbox || 'INBOX');
  try { return await fn(client); } finally { lock.release(); await client.logout().catch(() => undefined); }
}

export const imapConnector: Connector = {
  type: 'imap', label: 'Email inbox (IMAP)', pull: true, canonical: true,
  async fetch(src, secret, opts) {
    const cfg = src.config as any;
    const since = src.lastSyncAt ? new Date(src.lastSyncAt.getTime() - 864e5) : new Date(Date.now() - (cfg.firstSyncDays ?? 7) * 864e5);
    const limit = opts?.preview ? 5 : Number(cfg.maxMessages ?? 200);
    return withMailbox(cfg, secret, async (client) => {
      const found = await client.search({ since }, { uid: true });
      const uids = (Array.isArray(found) ? found : []).slice(-limit);
      const records: Record<string, unknown>[] = [];
      const done: number[] = [];
      if (!uids.length) return { records };
      for await (const msg of client.fetch(uids, { source: true, uid: true }, { uid: true })) {
        const mail = await simpleParser(msg.source as Buffer);
        const files = (mail.attachments ?? []).map((a) => ({ name: a.filename ?? 'resume', mime: a.contentType, data: a.content }));
        const r = await recordsFromAttachments({ id: mail.messageId ?? `uid-${msg.uid}`, from: mail.from?.text, subject: mail.subject }, files);
        records.push(...r.records);
        if (r.records.length) done.push(msg.uid);
      }
      if (!opts?.preview && done.length) {
        if (cfg.markSeen !== false) await client.messageFlagsAdd(done, ['\\Seen'], { uid: true });
        if (cfg.moveTo) await client.messageMove(done, cfg.moveTo, { uid: true }).catch(() => undefined);
      }
      return { records };
    });
  },
  async test(src, secret) {
    return withMailbox(src.config as any, secret, async (c) => {
      const st = await c.status((src.config as any).mailbox || 'INBOX', { messages: true, unseen: true });
      return `Connected. ${st.messages ?? 0} messages, ${st.unseen ?? 0} unread.`;
    });
  },
};
