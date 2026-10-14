import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../../config.js';
import { prisma } from '../../db.js';
import { connectors } from './connectors/index.js';
import { syncSource } from './sync.service.js';

/**
 * Background worker: runs each active pull source on its cron schedule.
 * Start with `npm run worker`. Re-reads source schedules every 5 minutes, so new or edited
 * sources are picked up without a restart.
 */
if (!env.REDIS_URL) { console.error('REDIS_URL is required for the worker'); process.exit(1); }
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue('source-sync', { connection });

async function refreshSchedules() {
  const sources = await prisma.dataSource.findMany({ where: { status: { in: ['ACTIVE', 'ERROR'] }, schedule: { not: null } } });
  const wanted = new Set<string>();
  for (const s of sources) {
    if (!connectors[s.connector]?.pull) continue;
    wanted.add(s.id);
    await queue.upsertJobScheduler(s.id, { pattern: s.schedule!, tz: env.DEFAULT_TIMEZONE }, { name: 'sync', data: { sourceId: s.id } });
  }
  for (const j of await queue.getJobSchedulers()) if (j.key && !wanted.has(j.key)) await queue.removeJobScheduler(j.key);
  console.info(`[worker] ${wanted.size} scheduled sources`);
}

new Worker('source-sync', async (job) => {
  const r = await syncSource(job.data.sourceId);
  console.info(`[worker] ${job.data.sourceId}: +${r.added} new, ${r.merged} merged, ${r.rejected} rejected`);
  return r;
}, { connection, concurrency: 3 });

await refreshSchedules();
setInterval(() => refreshSchedules().catch((e) => console.error(e)), 5 * 60 * 1000);
