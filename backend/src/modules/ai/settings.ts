/**
 * AI settings model (pure, unit-tested).
 * Several providers can be connected at once; one is the DEFAULT, and each feature can be routed to a
 * different provider (e.g. resume reading on Gemini, screening on Claude). A run can also override it.
 */
import type { AiConfig, AiProvider } from './providers.js';
import { DEFAULT_MODELS } from './providers.js';

export type RealProvider = Exclude<AiProvider, 'none'>;
export const PROVIDERS: RealProvider[] = ['openai', 'anthropic', 'gemini', 'azure'];
export const PROVIDER_LABEL: Record<RealProvider, string> = { openai: 'OpenAI', anthropic: 'Anthropic Claude', gemini: 'Google Gemini', azure: 'Azure OpenAI' };

export type AiFeature = 'parsing' | 'screening' | 'interviews' | 'general';
export const FEATURES: { id: AiFeature; label: string }[] = [
  { id: 'parsing', label: 'Resume reading' },
  { id: 'screening', label: 'AI screening' },
  { id: 'interviews', label: 'Interview questions & feedback check' },
  { id: 'general', label: 'Everything else (JD extraction, field mapping, outreach, pipeline Q&A)' },
];

export interface ProviderCreds { apiKey?: string; model?: string; baseUrl?: string; azureEndpoint?: string; azureDeployment?: string; azureApiVersion?: string }
export interface AiSettings {
  active: AiProvider;
  features: Partial<Record<AiFeature, RealProvider | ''>>;
  providers: Partial<Record<RealProvider, ProviderCreds & { source?: 'database' | 'environment' }>>;
}

export const isConfigured = (p: RealProvider, c?: ProviderCreds) => !!c?.apiKey && (p !== 'azure' || (!!c.azureEndpoint && (!!c.azureDeployment || /\/openai\/deployments\//.test(c.azureEndpoint))));

/** Old single-provider setting → new shape. */
export function fromLegacy(old: AiConfig): AiSettings {
  const s: AiSettings = { active: old.provider ?? 'none', features: {}, providers: {} };
  if (old.provider && old.provider !== 'none') {
    const { provider, ...creds } = old;
    s.providers[provider] = creds;
  }
  return s;
}

/** Settings saved in the app win; any provider key present only in .env is still available. */
export function merge(db: AiSettings | null, env: AiSettings): AiSettings {
  const providers: AiSettings['providers'] = {};
  for (const p of PROVIDERS) {
    const d = db?.providers[p], e = env.providers[p];
    if (d && isConfigured(p, d)) providers[p] = { ...d, source: 'database' };
    else if (e && isConfigured(p, e)) providers[p] = { ...e, source: 'environment' };
    else if (d) providers[p] = { ...d, source: 'database' };
  }
  return { active: db?.active ?? env.active, features: db?.features ?? {}, providers };
}

/** Which provider + model handles this feature (override > feature route > default > any connected provider). */
export function resolve(s: AiSettings, feature: AiFeature = 'general', override?: string): AiConfig & { source?: string; label?: string; reason: string } {
  const ok = (p?: string): p is RealProvider => !!p && (PROVIDERS as string[]).includes(p) && isConfigured(p as RealProvider, s.providers[p as RealProvider]);
  let p: RealProvider | undefined, reason = '';
  if (override) { if (!ok(override)) return { provider: override as AiProvider, reason: `${override} is not connected` }; p = override; reason = 'chosen for this run'; }
  else if (ok(s.features[feature] || undefined)) { p = s.features[feature] as RealProvider; reason = `set for ${feature}`; }
  else if (s.active !== 'none' && ok(s.active)) { p = s.active as RealProvider; reason = 'default'; }
  else if (s.active !== 'none') { p = PROVIDERS.find((x) => ok(x)); reason = p ? 'only connected provider' : ''; }
  if (!p) return { provider: 'none', reason: 'AI is off' };
  const c = s.providers[p]!;
  return { provider: p, ...c, model: c.model || DEFAULT_MODELS[p] || c.azureDeployment, label: PROVIDER_LABEL[p], reason };
}
