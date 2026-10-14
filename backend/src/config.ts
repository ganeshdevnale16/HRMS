import 'dotenv/config';
import { z } from 'zod';

const opt = z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined));

const Env = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  APP_URL: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string(),
  REDIS_URL: opt,
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY must be 64 hex characters'),
  DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),

  MS_TENANT_ID: opt, MS_CLIENT_ID: opt, MS_CLIENT_SECRET: opt, MS_ORGANIZER_UPN: opt,
  ZOOM_ACCOUNT_ID: opt, ZOOM_CLIENT_ID: opt, ZOOM_CLIENT_SECRET: opt, ZOOM_HOST_USER: z.string().default('me'),
  GOOGLE_SA_EMAIL: opt, GOOGLE_SA_PRIVATE_KEY: opt, GOOGLE_ORGANIZER_EMAIL: opt,
  WEBEX_ACCESS_TOKEN: opt,
  JITSI_ENABLED: z.string().default('true').transform((v) => v !== 'false'),
  JITSI_DOMAIN: z.string().default('meet.jit.si'),
  CRON_SECRET: opt,
  SERVE_WEB: z.string().default('false').transform((v) => v === 'true'),
  PUBLIC_CAREERS: z.string().default('false').transform((v) => v === 'true'),

  SMTP_HOST: opt, SMTP_PORT: z.coerce.number().default(587), SMTP_USER: opt, SMTP_PASS: opt,
  MAIL_FROM: z.string().default('HRMS <no-reply@hrms.local>'),

  AI_PROVIDER: z.enum(['openai', 'anthropic', 'gemini', 'azure', 'none']).default('none'),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'), OPENAI_API_KEY: opt, OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  GEMINI_API_KEY: opt, GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  STORAGE_DRIVER: z.enum(['db', 's3']).default('db'),
  S3_ENDPOINT: opt, S3_REGION: z.string().default('auto'), S3_BUCKET: opt, S3_ACCESS_KEY: opt, S3_SECRET_KEY: opt,
  MAX_RESUME_MB: z.coerce.number().default(5),
  AZURE_OPENAI_ENDPOINT: opt, AZURE_OPENAI_KEY: opt, AZURE_OPENAI_DEPLOYMENT: opt,
  AZURE_OPENAI_API_VERSION: z.string().default('2024-10-21'),
  ANTHROPIC_API_KEY: opt, ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),
});

export const env = Env.parse(process.env);

export const integrations = {
  teams: !!(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET && env.MS_ORGANIZER_UPN),
  outlookCalendar: !!(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET),
  zoom: !!(env.ZOOM_ACCOUNT_ID && env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET),
  googleMeet: !!(env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_PRIVATE_KEY && env.GOOGLE_ORGANIZER_EMAIL),
  googleCalendar: !!(env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_PRIVATE_KEY),
  webex: !!env.WEBEX_ACCESS_TOKEN,
  jitsi: env.JITSI_ENABLED,
  queue: !!env.REDIS_URL,
};
