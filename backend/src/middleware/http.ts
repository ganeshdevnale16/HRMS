import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

export const ah = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) return res.status(400).json({ error: 'Some fields are invalid', details: err.flatten() });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err?.code === 'P2002') return res.status(409).json({ error: 'A record with these details already exists' });
  if (err?.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
}
