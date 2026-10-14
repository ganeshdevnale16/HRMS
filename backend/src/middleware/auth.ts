import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config.js';
import { HttpError } from './http.js';

export interface AuthUser { id: string; role: Role; name: string; email: string }
declare global { namespace Express { interface Request { user?: AuthUser } } }

export const signToken = (u: AuthUser) => jwt.sign(u, env.JWT_SECRET, { expiresIn: '12h' });

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(new HttpError(401, 'Sign in to continue'));
  try { req.user = jwt.verify(h.slice(7), env.JWT_SECRET) as AuthUser; next(); }
  catch { next(new HttpError(401, 'Your session has expired. Sign in again.')); }
}

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) =>
  req.user && (req.user.role === 'ADMIN' || roles.includes(req.user.role)) ? next() : next(new HttpError(403, 'You do not have access to this action'));
