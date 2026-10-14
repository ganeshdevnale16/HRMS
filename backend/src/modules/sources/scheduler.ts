import cronParser from 'cron-parser';
import { env } from '../../config.js';
import { prisma } from '../../db.js';
import { connectors } from './connectors/index.js';
import { syncSource } from './sync.service.js';

/**
 * FREE MODE (no Redis): the API itself runs due source syncs every 5 minutes, and an external
 * free pinger (cron-job.org / GitHub Actions) can call POST /api/cron/run to wake a sleeping
 * free server and catch up.
 * PAID MODE: set REDIS_URL and run the separate worker (`npm run worker`) — this in-process
 * scheduler then switches itself off.
 */
let running = false;

export async function runDueSyncs() {
  if (running) return { skipped: true, ran: [] as string[] };
  running = true;
  const ran: string[] = [];
  try {
    const sources = await prisma.dataSource.findMany({ where: { status: { in: ['ACTIVE', 'ERROR'] }, schedule: { not: null } } });
    for (const s of sources) {
      if (!connectors[s.connector]?.pull) continue;
      let due = !s.lastSyncAt;
      try {
        const prev = cronParser.parseExpression(s.schedule!, { tz: env.DEFAULT_TIMEZONE }).prev().toDate();
        due = due || prev > s.lastSyncAt!;
      } catch { continue; }
      if (!due) continue;
      try { await syncSource(s.id); ran.push(s.name); } catch (e: any) { console.warn(`[sync] ${s.name}: ${e.message}`); }
    }
  } finally { running = false; }
  return { skipped: false, ran };
}

export function startInProcessScheduler() {
  if (env.REDIS_URL) { console.info('[sync] REDIS_URL set: scheduled syncs run in the separate worker'); return; }
  console.info('[sync] Free mode: scheduled syncs run inside the API every 5 minutes');
  setInterval(() => runDueSyncs().catch((e) => console.error(e)), 5 * 60 * 1000);
}
