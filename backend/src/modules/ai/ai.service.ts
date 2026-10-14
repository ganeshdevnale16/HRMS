import { env } from '../../config.js';
import { prisma } from '../../db.js';
import { decrypt } from '../../lib/crypto.js';
import { HttpError } from '../../middleware/http.js';
import { audit } from '../../lib/audit.js';

/**
 * One AI gateway for the whole platform.
 * Providers: OpenAI (and any OpenAI-compatible API: Groq, Together, Ollama, OpenRouter), Anthropic Claude,
 * Google Gemini, Azure OpenAI. The admin picks the provider and key under Integrations → AI (stored encrypted
 * in the database); if nothing is saved there, the .env values are used.
 * Guardrail: AI output is advisory. Nothing in the platform moves a candidate on AI output alone.
 */
import { callProvider, parseJsonLoose, DEFAULT_MODELS, AiError, type AiConfig, type AiProvider } from './providers.js';
export type { AiConfig, AiProvider };

export const AI_DEFAULT_MODELS: Record<string, string> = { ...DEFAULT_MODELS };

import { merge, fromLegacy, resolve, PROVIDERS, type AiFeature, type AiSettings } from './settings.js';
export type { AiFeature, AiSettings };

let cache: { at: number; s: AiSettings } | null = null;
export function clearAiCache() { cache = null; }

function envSettings(): AiSettings {
  return {
    active: env.AI_PROVIDER, features: {},
    providers: {
      openai: { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL, baseUrl: env.OPENAI_BASE_URL },
      anthropic: { apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL },
      gemini: { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL },
      azure: { apiKey: env.AZURE_OPENAI_KEY, azureEndpoint: env.AZURE_OPENAI_ENDPOINT, azureDeployment: env.AZURE_OPENAI_DEPLOYMENT, azureApiVersion: env.AZURE_OPENAI_API_VERSION },
    },
  };
}

/** Stored settings (row "ai.v2"; older single-provider row "ai" is upgraded automatically) merged with .env. */
export async function getAiSettings(): Promise<AiSettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.s;
  let db: AiSettings | null = null;
  const v2 = await prisma.setting.findUnique({ where: { key: 'ai.v2' } }).catch(() => null);
  if (v2) db = decrypt<AiSettings>(v2.valueEnc);
  else { const v1 = await prisma.setting.findUnique({ where: { key: 'ai' } }).catch(() => null); if (v1) db = fromLegacy(decrypt<AiConfig>(v1.valueEnc)!); }
  const s = merge(db, envSettings());
  cache = { at: Date.now(), s };
  return s;
}

/** Provider/model that will handle a feature. */
export async function getAiConfig(feature: AiFeature = 'general', override?: string) {
  return resolve(await getAiSettings(), feature, override);
}
export { PROVIDERS };

const FAIRNESS = 'Judge only job-related evidence. Ignore and never infer name, gender, age, religion, caste, marital status, nationality, disability or photo.';

export async function complete(system: string, user: string, json: boolean, cfgOverride?: AiConfig): Promise<string> {
  const c = cfgOverride ?? (await getAiConfig());
  try { return await callProvider(c, system, user, json); }
  catch (e: any) { if (e instanceof AiError) throw new HttpError(e.status, e.message); throw new HttpError(502, `AI request failed: ${e.message}`); }
}

export interface AiUsed { provider: string; model?: string; label?: string }
export interface AiOpts { userId?: string; provider?: string }

/** Calls the provider routed for this feature and tags the result with which AI produced it (`_ai`). */
async function json<T>(purpose: string, feature: AiFeature, system: string, user: string, o: AiOpts = {}): Promise<T & { _ai: AiUsed }> {
  const cfg = await getAiConfig(feature, o.provider);
  if (cfg.provider === 'none' || (o.provider && cfg.reason.endsWith('not connected'))) throw new HttpError(503, o.provider ? `${o.provider} is not connected. Add its key under Integrations → AI.` : 'AI is not configured. An admin can set it up under Integrations → AI.');
  const text = await complete(system, user, true, cfg);
  const used = { provider: cfg.provider, model: cfg.model, label: cfg.label };
  await audit(o.userId, 'ai.call', 'AI', purpose, used);
  let data: any;
  try { data = parseJsonLoose<T>(text); } catch { throw new HttpError(502, 'The AI returned an unreadable answer. Try again.'); }
  return { ...data, _ai: used };
}

export interface ParsedResume {
  name?: string; email?: string; phone?: string; location?: string; expYears?: number; skills?: string[];
  company?: string; title?: string; currentCtc?: number; expectedCtc?: number; noticeDays?: number; education?: string;
}

export const ai = {
  parseResume: (text: string, o: AiOpts = {}) => json<ParsedResume>('parse-resume', 'parsing',
    'You extract structured data from a resume. Use only what the text states; leave a field out if it is not there. Do not guess salaries.',
    `Return JSON {"name":string,"email":string,"phone":string,"location":"current city","expYears":number total professional years,"skills":[up to 25 technical/professional skills],"company":"current or latest employer","title":"current or latest job title","currentCtc":number in lakhs per annum if stated,"expectedCtc":number in LPA if stated,"noticeDays":number if stated,"education":"highest degree"}\n\nRESUME:\n${text.slice(0, 15000)}`, o),

  screen: (role: unknown, candidate: unknown, o: AiOpts = {}) => json<{ decision: string; summary: string; strengths: string[]; gaps: string[] }>('screen', 'screening',
    `You are a senior technical recruiter screening a profile. ${FAIRNESS}`,
    `ROLE: ${JSON.stringify(role)}\nCANDIDATE: ${JSON.stringify(candidate)}\nReturn JSON {"decision":"Shortlist"|"Hold"|"Reject","summary":"two sentences","strengths":[max 3],"gaps":[max 3 things to probe]}`, o),

  questions: (role: unknown, candidate: unknown, missing: string[], round: string, o: AiOpts = {}) => json<{ questions: { q: string; skill: string; level: string; lookFor: string }[] }>('questions', 'interviews',
    `You design structured interviews. Questions must be job-related, consistent for all candidates at this level, and probe evidence. ${FAIRNESS}`,
    `ROUND: ${round}\nROLE: ${JSON.stringify(role)}\nCANDIDATE: ${JSON.stringify(candidate)}\nSkills to probe hardest: ${missing.join(', ') || 'none'}\nReturn JSON {"questions":[{"q":string,"skill":string,"level":"Basic"|"Intermediate"|"Advanced","lookFor":"what a strong answer contains"}]} with 6-8 questions.`, o),

  feedback: (role: unknown, round: string, notes: string, o: AiOpts = {}) => json<{ technical: number; communication: number; roleFit: number; recommendation: string; summary: string; flags: string[] }>('feedback', 'interviews',
    `You structure interview feedback. Base ratings only on job-related evidence written in the notes. ${FAIRNESS}`,
    `ROLE: ${JSON.stringify(role)}\nROUND: ${round}\nNOTES:\n"""${notes}"""\nReturn JSON {"technical":1-5,"communication":1-5,"roleFit":1-5,"recommendation":"Hire"|"Next round"|"Hold"|"Reject","summary":"two sentences","flags":["vague, contradictory or non-job-related remarks the recruiter should check"]}`, o),

  extractJd: (jd: string, o: AiOpts = {}) => json<{ position: string; skills: string[]; expMin: number; expMax: number; location: string; workMode: string; noticeMax: number }>('jd', 'general',
    'Extract a structured hiring requirement from a job description.',
    `Return JSON {"position":string,"skills":[max 6, most important first],"expMin":number,"expMax":number,"location":string,"workMode":"HYBRID"|"ONSITE"|"REMOTE","noticeMax":number}. Use sensible defaults.\nJD:\n${jd.slice(0, 12000)}`, o),

  mapFields: (fields: string[], targets: readonly string[], sample: unknown, o: AiOpts = {}) => json<Record<string, string>>('map-fields', 'general',
    'You map fields from an external candidate data source onto a canonical candidate schema.',
    `Targets: ${targets.join(', ')}\nIncoming fields: ${JSON.stringify(fields)}\nSample: ${JSON.stringify(sample).slice(0, 2000)}\nReturn a JSON object {"<incoming>":"<target or empty string>"}. Several fields may map to "name" only if they are name parts.`, o),

  async text(purpose: string, system: string, user: string, userId?: string) {
    const cfg = await getAiConfig('general');
    if (cfg.provider === 'none') throw new HttpError(503, 'AI is not configured. An admin can set it up under Integrations → AI.');
    const t = await complete(system, user, false, cfg);
    await audit(userId, 'ai.call', 'AI', purpose, { provider: cfg.provider, model: cfg.model });
    return t;
  },
};
