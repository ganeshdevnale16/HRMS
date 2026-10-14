import crypto from 'node:crypto';
import { env } from '../config.js';

const key = Buffer.from(env.ENCRYPTION_KEY, 'hex');

/** AES-256-GCM. Used for data-source credentials stored in the database. */
export function encrypt(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decrypt<T = any>(payload?: string | null): T | null {
  if (!payload) return null;
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
}
