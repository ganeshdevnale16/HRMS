/**
 * Removes recruitment data so you can start clean.
 *   npm run reset-data -- --yes          candidates, requirements, interviews, interviewers, files, import history
 *   npm run reset-data -- --yes --all    the above + all configured data sources
 * Always kept: user logins, AI settings, built-in sources (Careers page, Resume upload, Manual entry).
 * This cannot be undone.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const args = process.argv.slice(2);

async function main() {
  if (!args.includes('--yes')) {
    console.log('This permanently deletes all candidates, requirements, interviews, interviewers and resumes.');
    console.log('Run again with --yes to confirm:  npm run reset-data -- --yes   (add --all to remove data sources too)');
    process.exit(1);
  }
  const n: Record<string, number> = {};
  n.interviews = (await prisma.interview.deleteMany()).count;
  n.candidates = (await prisma.candidate.deleteMany()).count;
  n.requirements = (await prisma.requirement.deleteMany()).count;
  n.interviewers = (await prisma.interviewer.deleteMany()).count;
  n.files = (await prisma.storedFile.deleteMany()).count;
  n.importRuns = (await prisma.ingestionRun.deleteMany()).count;
  if (args.includes('--all')) n.sources = (await prisma.dataSource.deleteMany({ where: { connector: { notIn: ['careers', 'resume', 'manual'] } } })).count;
  await prisma.dataSource.updateMany({ data: { records: 0, lastSyncAt: null, lastError: null } });
  await prisma.auditLog.create({ data: { action: 'data.reset', entity: 'System', data: n } });
  console.log('Removed:', n);
  console.log('Kept: users, AI settings' + (args.includes('--all') ? ', built-in sources.' : ', data sources.'));
}
main().finally(() => prisma.$disconnect());
