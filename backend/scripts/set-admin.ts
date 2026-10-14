/**
 * Set or change the admin login.
 *   npm run set-admin -- <username-or-email> <password>
 * Example: npm run set-admin -- admin 54321
 * Renames the existing admin account if there is one; otherwise creates it.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const [login, password] = process.argv.slice(2);

async function main() {
  if (!login || !password) { console.error('Usage: npm run set-admin -- <username-or-email> <password>'); process.exit(1); }
  const id = login.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({ where: { email: id } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, role: 'ADMIN', active: true } });
  } else {
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
    if (admin) await prisma.user.update({ where: { id: admin.id }, data: { email: id, passwordHash, active: true } });
    else await prisma.user.create({ data: { email: id, name: 'Administrator', role: 'ADMIN', passwordHash } });
  }
  console.log(`Done. Sign in with username "${id}" and your new password.`);
  if (password.length < 10) console.log('Note: this password is short. Use a stronger one before putting HRMS online.');
}
main().finally(() => prisma.$disconnect());
