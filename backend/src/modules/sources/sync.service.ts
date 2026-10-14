import { prisma } from '../../db.js';
import { decrypt } from '../../lib/crypto.js';
import { HttpError } from '../../middleware/http.js';
import { connectors } from './connectors/index.js';
import { ingest } from './ingest.service.js';

export async function syncSource(sourceId: string, userId?: string) {
  const src = await prisma.dataSource.findUniqueOrThrow({ where: { id: sourceId } });
  const conn = connectors[src.connector];
  if (!conn?.pull || !conn.fetch) throw new HttpError(400, `${src.name} receives data by ${conn?.label ?? src.connector}; it cannot be synced on demand`);
  try {
    const { records } = await conn.fetch(src, decrypt(src.secretEnc));
    return await ingest(src, records, { userId });
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    await prisma.dataSource.update({ where: { id: src.id }, data: { status: 'ERROR', lastError: e.message } });
    await prisma.ingestionRun.create({ data: { sourceId: src.id, finishedAt: new Date(), error: e.message } });
    throw new HttpError(502, `Sync failed for ${src.name}: ${e.message}`);
  }
}
