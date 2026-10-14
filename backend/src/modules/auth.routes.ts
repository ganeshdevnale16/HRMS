import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah, HttpError } from '../middleware/http.js';
import { requireAuth, requireRole, signToken } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

export const authRoutes = Router();

authRoutes.post('/login', ah(async (req, res) => {
  const { email, password } = z.object({ email: z.string().trim().min(1, 'Enter your username or email'), password: z.string().min(1) }).parse(req.body);
  const u = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!u || !u.active || !(await bcrypt.compare(password, u.passwordHash))) throw new HttpError(401, 'Email or password is incorrect');
  await audit(u.id, 'auth.login', 'User', u.id);
  res.json({ token: signToken({ id: u.id, role: u.role, name: u.name, email: u.email }), user: { id: u.id, name: u.name, email: u.email, role: u.role } });
}));

authRoutes.get('/me', requireAuth, (req, res) => res.json(req.user));

authRoutes.get('/users', requireAuth, ah(async (_req, res) => {
  res.json(await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, active: true }, orderBy: { name: 'asc' } }));
}));

authRoutes.post('/users', requireAuth, requireRole('ADMIN'), ah(async (req, res) => {
  const b = z.object({ name: z.string().min(1), email: z.string().email(), password: z.string().min(10), role: z.enum(['ADMIN', 'RECRUITER', 'INTERVIEWER', 'FINANCE', 'VIEWER']) }).parse(req.body);
  const u = await prisma.user.create({ data: { name: b.name, email: b.email.toLowerCase(), role: b.role, passwordHash: await bcrypt.hash(b.password, 12) } });
  await audit(req.user!.id, 'user.create', 'User', u.id, { role: b.role });
  res.status(201).json({ id: u.id, name: u.name, email: u.email, role: u.role });
}));
