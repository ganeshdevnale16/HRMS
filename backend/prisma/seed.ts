import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const days = (n: number) => new Date(Date.now() + n * 864e5);

async function main() {
  const pw = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026', 12);
  const admin = await prisma.user.upsert({ where: { email: 'admin@hrms.local' }, update: {}, create: { email: 'admin@hrms.local', name: 'Platform Admin', role: 'ADMIN', passwordHash: pw } });
  for (const s of [
    { name: 'Careers page', connector: 'careers' },
    { name: 'Resume upload', connector: 'resume' },
    { name: 'Spreadsheet upload', connector: 'file', template: 'file' },
    { name: 'Manual entry', connector: 'manual' },
  ]) await prisma.dataSource.upsert({ where: { name: s.name }, update: { connector: s.connector }, create: s });

  if (process.env.SEED_DEMO !== 'true') {
    console.log(`Ready. Sign in as ${admin.email} / ${process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026'} and change the password. (Set SEED_DEMO=true for sample data.)`);
    return;
  }

  // ---------------- Demo data (only with SEED_DEMO=true) ----------------
  const rec = await prisma.user.upsert({ where: { email: 'ananya@hrms.local' }, update: {}, create: { email: 'ananya@hrms.local', name: 'Ananya Kulkarni', role: 'RECRUITER', passwordHash: pw } });

  const reqs = [
    { code: 'R-1001', client: 'ABC Technologies', position: 'Java Developer', openings: 10, expMin: 3, expMax: 6, skills: ['Java', 'Spring Boot', 'SQL', 'Microservices'], location: 'Pune', workMode: 'HYBRID', ctcMin: 8, ctcMax: 18, noticeMax: 60, priority: 'HIGH', targetDate: days(60) },
    { code: 'R-1002', client: 'Nimbus Retail', position: 'Data Engineer', openings: 4, expMin: 4, expMax: 8, skills: ['Python', 'Spark', 'Azure Data Factory', 'SQL'], location: 'Bengaluru', workMode: 'REMOTE', ctcMin: 14, ctcMax: 26, noticeMax: 45, priority: 'MEDIUM', targetDate: days(50) },
    { code: 'R-1003', client: 'Orion Bank', position: 'SAP FICO Consultant', openings: 3, expMin: 5, expMax: 10, skills: ['SAP FICO', 'S/4HANA', 'GL', 'AP/AR'], location: 'Mumbai', workMode: 'ONSITE', ctcMin: 16, ctcMax: 30, noticeMax: 60, priority: 'HIGH', targetDate: days(40) },
  ] as const;
  for (const r of reqs) await prisma.requirement.upsert({ where: { code: r.code }, update: {}, create: { ...r, skills: [...r.skills], recruiterId: rec.id } });

  const interviewers = [
    { name: 'Rajesh Iyer', email: 'rajesh.iyer@yourcompany.com', title: 'Principal Engineer', department: 'Engineering', skills: ['Java', 'Spring Boot', 'Microservices', 'Kafka'], rounds: ['L1 Technical', 'L2 Technical'], meetingProvider: 'TEAMS', calendarProvider: 'OUTLOOK' },
    { name: 'Meghna Shah', email: 'meghna.shah@yourcompany.com', title: 'Data Architect', department: 'Data', skills: ['Python', 'Spark', 'Azure Data Factory', 'SQL'], rounds: ['L1 Technical', 'L2 Technical'], meetingProvider: 'TEAMS', calendarProvider: 'OUTLOOK' },
    { name: 'Vivek Rao', email: 'vivek.rao@yourcompany.com', title: 'SAP Practice Lead', department: 'Enterprise Apps', skills: ['SAP FICO', 'S/4HANA', 'GL', 'AP/AR'], rounds: ['L1 Technical', 'Managerial'], meetingProvider: 'ZOOM', calendarProvider: 'GOOGLE' },
    { name: 'Farah Khan', email: 'farah.khan@yourcompany.com', title: 'Engineering Manager', department: 'Engineering', skills: ['Java', 'SQL', 'React'], rounds: ['Managerial', 'Client round'], meetingProvider: 'TEAMS', calendarProvider: 'OUTLOOK' },
    { name: 'Neha Joshi', email: 'neha.joshi@yourcompany.com', title: 'HR Business Partner', department: 'HR', skills: [], rounds: ['HR'], meetingProvider: 'GOOGLE_MEET', calendarProvider: 'GOOGLE', maxPerDay: 6 },
  ] as const;
  for (const i of interviewers) await prisma.interviewer.upsert({ where: { email: i.email }, update: {}, create: { ...i, skills: [...i.skills], rounds: [...i.rounds] } as any });


  const java = await prisma.requirement.findUniqueOrThrow({ where: { code: 'R-1001' } });
  const src = await prisma.dataSource.findUniqueOrThrow({ where: { name: 'Spreadsheet upload' } });
  const sample = [
    ['Aarav Sharma', 'aarav.sharma@example.com', '9876500001', 'Pune', 4.5, ['Java', 'Spring Boot', 'SQL', 'Kafka'], 'Persistent', 11, 15, 30, 'COMMUNICATION'],
    ['Priya Patil', 'priya.patil@example.com', '9876500002', 'Pune', 5, ['Java', 'Microservices', 'SQL', 'AWS'], 'Infosys', 13, 17, 60, 'SCREENING'],
    ['Rahul Iyer', 'rahul.iyer@example.com', '9876500003', 'Mumbai', 3, ['Java', 'Spring Boot'], 'TCS', 7, 10, 45, 'SOURCED'],
    ['Sneha Deshmukh', 'sneha.d@example.com', '9876500004', 'Pune', 6, ['Java', 'Spring Boot', 'SQL', 'Microservices'], 'Wipro', 15, 19, 30, 'INTERVIEW'],
  ] as const;
  for (const [name, email, phone, location, expYears, skills, company, currentCtc, expectedCtc, noticeDays, stage] of sample) {
    const exists = await prisma.candidate.findFirst({ where: { email } });
    if (exists) continue;
    await prisma.candidate.create({
      data: { name, email, phone, location, expYears, skills: [...skills], company, title: 'Software Engineer', currentCtc, expectedCtc, noticeDays, stage, requirementId: java.id,
        sources: { create: { sourceId: src.id, sourceName: src.name } }, activities: { create: { type: 'sourcing', message: 'Sourced from Resume upload (seed)' } } },
    });
  }
  console.log(`Seeded. Sign in as ${admin.email} / ${process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026'} and change the password.`);
}

main().finally(() => prisma.$disconnect());
