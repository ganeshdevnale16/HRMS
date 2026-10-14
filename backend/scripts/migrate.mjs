// Applies the database schema on start-up.
// - If prisma/migrations exists (recommended once you go to production): `prisma migrate deploy`.
// - Otherwise (quick free setup): `prisma db push`, which creates/updates tables directly from schema.prisma.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
const cmd = existsSync('prisma/migrations') ? 'npx prisma migrate deploy' : 'npx prisma db push --skip-generate';
console.log(`[db] ${cmd}`);
execSync(cmd, { stdio: 'inherit' });
