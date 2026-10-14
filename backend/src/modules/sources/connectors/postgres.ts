import pg from 'pg';
import type { Connector } from './types.js';

/**
 * SQL database connector (PostgreSQL; add mssql/oracle drivers the same way).
 *   config: { query }  — may use $1 for the last sync time, e.g. WHERE updated_at > COALESCE($1, '1970-01-01')
 *   secret: { connectionString }
 * Use a read-only database user.
 */
async function run(sql: string, cs: string, since: Date | null) {
  const client = new pg.Client({ connectionString: cs, statement_timeout: 60000 } as any);
  await client.connect();
  try { return (await client.query(sql, sql.includes('$1') ? [since] : [])).rows; }
  finally { await client.end(); }
}

export const postgresConnector: Connector = {
  type: 'postgres', label: 'Database (PostgreSQL)', pull: true,
  async fetch(src, secret) {
    const { query } = src.config as any;
    return { records: await run(query, secret?.connectionString ?? '', src.lastSyncAt) };
  },
  async test(src, secret) {
    const rows = await run(`SELECT * FROM (${(src.config as any).query.replace(/;\s*$/, '')}) q LIMIT 1`, secret?.connectionString ?? '', null);
    return `Connected. Columns: ${rows[0] ? Object.keys(rows[0]).join(', ') : 'query returned no rows'}.`;
  },
};
