import { graph } from '../../scheduling/providers/msgraph.js';
import type { Connector } from './types.js';
import { recordsFromAttachments } from './mailParse.js';

/**
 * Microsoft 365 / Outlook resume mailbox via Microsoft Graph (uses the same Azure app as Teams).
 * Extra application permission needed: Mail.Read (admin consent). Restrict it to the recruiting mailbox
 * with an Exchange ApplicationAccessPolicy.
 * config: { mailbox: 'careers@company.com', folder: 'inbox', firstSyncDays: 7, maxMessages: 200 }
 */
export const graphMailConnector: Connector = {
  type: 'graphmail', label: 'Microsoft 365 mailbox', pull: true, canonical: true,
  async fetch(src, _secret, opts) {
    const cfg = src.config as any;
    const mb = encodeURIComponent(cfg.mailbox);
    const since = src.lastSyncAt ?? new Date(Date.now() - (cfg.firstSyncDays ?? 7) * 864e5);
    const limit = opts?.preview ? 5 : Number(cfg.maxMessages ?? 200);
    let url: string | null = `/users/${mb}/mailFolders/${encodeURIComponent(cfg.folder || 'inbox')}/messages?$filter=hasAttachments eq true and receivedDateTime ge ${since.toISOString()}&$select=id,subject,from,receivedDateTime&$top=25&$orderby=receivedDateTime desc`;
    const records: Record<string, unknown>[] = [];
    let seen = 0;
    while (url && seen < limit) {
      const page: any = await graph('GET', url);
      for (const m of page.value ?? []) {
        if (seen++ >= limit) break;
        const att: any = await graph('GET', `/users/${mb}/messages/${m.id}/attachments`);
        const files = (att.value ?? []).filter((a: any) => a['@odata.type'] === '#microsoft.graph.fileAttachment')
          .map((a: any) => ({ name: a.name, mime: a.contentType, data: Buffer.from(a.contentBytes, 'base64') }));
        const r = await recordsFromAttachments({ id: m.id, from: m.from?.emailAddress?.address, subject: m.subject }, files);
        records.push(...r.records);
      }
      url = page['@odata.nextLink'] ? page['@odata.nextLink'].replace('https://graph.microsoft.com/v1.0', '') : null;
    }
    return { records };
  },
  async test(src) {
    const cfg = src.config as any;
    const f: any = await graph('GET', `/users/${encodeURIComponent(cfg.mailbox)}/mailFolders/${encodeURIComponent(cfg.folder || 'inbox')}?$select=totalItemCount,unreadItemCount`);
    return `Connected. ${f.totalItemCount} messages, ${f.unreadItemCount} unread.`;
  },
};
