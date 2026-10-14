/**
 * Raw calls to each AI provider. Pure (no database/config imports) so it can be unit-tested with a mocked fetch.
 */
export type AiProvider = 'openai' | 'anthropic' | 'gemini' | 'azure' | 'none';
export interface AiConfig {
  provider: AiProvider; apiKey?: string; model?: string; baseUrl?: string;
  azureEndpoint?: string; azureDeployment?: string; azureApiVersion?: string;
}
export class AiError extends Error { constructor(public status: number, message: string) { super(message); } }

export const DEFAULT_MODELS: Record<string, string> = { openai: 'gpt-4o-mini', anthropic: 'claude-sonnet-5-5', gemini: 'gemini-2.5-flash', azure: '' };

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) throw failure(r.status, d, r.statusText);
  return d;
}

/** Turns provider errors into plain-language messages with the likely fix. */
function failure(status: number, d: any, statusText = '', azure = false) {
  const code = String(d?.error?.code ?? '');
  const msg = String(d?.error?.message ?? d?.message ?? statusText);
  let hint = '';
  if (status === 401 || status === 403) hint = azure ? ' — the key does not match this endpoint. Copy the key and the endpoint from the SAME resource (Foundry → your resource → Keys and Endpoint).' : ' — check the API key';
  else if (status === 404 && (/DeploymentNotFound/i.test(code + msg) || /deployment/i.test(msg))) hint = ' — deployment not found. Use the DEPLOYMENT name from Foundry → Deployments (it can differ from the model name).';
  else if (status === 404) hint = azure ? ' — endpoint or API version not found. Paste the endpoint shown in Foundry (…openai.azure.com or …cognitiveservices.azure.com).' : ' — check the model name';
  else if (status === 429) hint = ' — rate limit or quota reached; wait a minute or raise the quota in Foundry';
  const e = new AiError(502, `AI request failed (${status}${code ? ` ${code}` : ''}): ${msg}${hint}`);
  (e as any).httpStatus = status;
  return e;
}

/**
 * OpenAI-style /chat/completions with automatic adaptation for newer models (GPT-5, o-series):
 * they reject `max_tokens` (need `max_completion_tokens`), a custom `temperature`, or sometimes `response_format`.
 */
export async function chatCompletions(url: string, headers: Record<string, string>, base: Record<string, unknown>, json: boolean, azure = false): Promise<string> {
  let body: Record<string, unknown> = { ...base, temperature: 0.2, max_tokens: 2000, ...(json ? { response_format: { type: 'json_object' } } : {}) };
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const d: any = await r.json().catch(() => ({}));
    if (r.ok) return d.choices?.[0]?.message?.content ?? '';
    const msg = String(d?.error?.message ?? d?.message ?? '');
    if (r.status === 400) {
      if (/max_tokens/.test(msg) && 'max_tokens' in body) { const { max_tokens, ...rest } = body; body = { ...rest, max_completion_tokens: 4000 }; continue; }
      if (/temperature/.test(msg) && 'temperature' in body) { const { temperature, ...rest } = body; body = rest; continue; }
      if (/response_format/.test(msg) && 'response_format' in body) { const { response_format, ...rest } = body; body = rest; continue; }
    }
    throw failure(r.status, d, r.statusText, azure);
  }
  throw new AiError(502, 'AI request failed after several attempts');
}

export interface AzureTarget { mode: 'auto' | 'v1' | 'deployments' | 'models'; base: string; deployment: string; apiVersion: string }

/**
 * Accepts whatever Microsoft Foundry / Azure shows and works out the right call:
 *  - https://<res>.openai.azure.com  ·  https://<res>.cognitiveservices.azure.com
 *  - the full "Target URI" (…/openai/deployments/<name>/chat/completions?api-version=…) — deployment + version are read from it
 *  - https://<res>.openai.azure.com/openai/v1/
 *  - a Foundry project endpoint https://<res>.services.ai.azure.com/api/projects/<p>  → uses <res>.openai.azure.com
 *  - Foundry Models inference https://<res>.services.ai.azure.com/models, or serverless https://<x>.<region>.models.ai.azure.com
 */
export function parseAzure(endpoint: string, deployment?: string, apiVersion?: string): AzureTarget {
  const raw = endpoint.trim();
  const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  let host = u.host.toLowerCase();
  const path = u.pathname.replace(/\/+$/, '');
  const qv = u.searchParams.get('api-version') ?? '';
  const dep = (deployment ?? '').trim() || decodeURIComponent(path.match(/\/openai\/deployments\/([^/]+)/)?.[1] ?? '');
  if (/\.models\.ai\.azure\.com$/.test(host)) return { mode: 'models', base: `https://${host}`, deployment: dep, apiVersion: qv || apiVersion || '' };
  if (/\.services\.ai\.azure\.com$/.test(host) && /^\/models/.test(path)) return { mode: 'models', base: `https://${host}/models`, deployment: dep, apiVersion: qv || apiVersion || '2024-05-01-preview' };
  if (/\.services\.ai\.azure\.com$/.test(host)) host = host.replace(/\.services\.ai\.azure\.com$/, '.openai.azure.com');
  const base = `https://${host}`;
  if (/\/openai\/deployments\//.test(path)) return { mode: 'deployments', base, deployment: dep, apiVersion: qv || apiVersion || '2024-10-21' };
  if (/\/openai\/v1/.test(path)) return { mode: 'v1', base, deployment: dep, apiVersion: '' };
  if (apiVersion?.trim()) return { mode: 'deployments', base, deployment: dep, apiVersion: apiVersion.trim() };
  return { mode: 'auto', base, deployment: dep, apiVersion: '2024-10-21' };
}

async function callAzure(c: AiConfig, msgs: unknown[], json: boolean) {
  if (!c.azureEndpoint) throw new AiError(400, 'Azure OpenAI needs the endpoint from Foundry.');
  let t: AzureTarget;
  try { t = parseAzure(c.azureEndpoint, c.azureDeployment, c.azureApiVersion); } catch { throw new AiError(400, 'The Azure endpoint is not a valid URL. Paste it exactly as shown in Foundry.'); }
  if (!t.deployment) throw new AiError(400, 'Enter the deployment name (Foundry → Deployments), or paste the full Target URI as the endpoint.');
  const h = { 'api-key': c.apiKey! };
  const deploymentsUrl = `${t.base}/openai/deployments/${encodeURIComponent(t.deployment)}/chat/completions?api-version=${t.apiVersion || '2024-10-21'}`;
  if (t.mode === 'models') return chatCompletions(`${t.base}/chat/completions${t.apiVersion ? `?api-version=${t.apiVersion}` : ''}`, h, { model: t.deployment, messages: msgs }, json, true);
  if (t.mode === 'deployments') return chatCompletions(deploymentsUrl, h, { messages: msgs }, json, true);
  // v1 API (no api-version, supports the newest models); older resources fall back to the versioned deployments API.
  try { return await chatCompletions(`${t.base}/openai/v1/chat/completions`, h, { model: t.deployment, messages: msgs }, json, true); }
  catch (e: any) { if (t.mode === 'auto' && e.httpStatus === 404) return chatCompletions(deploymentsUrl, h, { messages: msgs }, json, true); throw e; }
}

export async function callProvider(c: AiConfig, system: string, user: string, json: boolean): Promise<string> {
  if (!c.provider || c.provider === 'none') throw new AiError(503, 'AI is not configured. An admin can set it up under Integrations → AI provider.');
  if (!c.apiKey) throw new AiError(503, `No API key saved for ${c.provider}.`);
  const sys = system + (json ? '\nRespond with a single JSON object only. No prose, no code fences.' : '');
  const msgs = [{ role: 'system', content: sys }, { role: 'user', content: user }];

  switch (c.provider) {
    case 'openai': {
      const base = (c.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
      if (/azure\.com/i.test(base)) throw new AiError(400, 'This is an Azure / Microsoft Foundry address. Use the "Azure OpenAI" card instead of OpenAI.');
      return chatCompletions(`${base}/chat/completions`, { Authorization: `Bearer ${c.apiKey}` }, { model: c.model || DEFAULT_MODELS.openai, messages: msgs }, json);
    }
    case 'azure': return callAzure(c, msgs, json);
    case 'anthropic': {
      const d = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' },
        { model: c.model || DEFAULT_MODELS.anthropic, max_tokens: 2000, system: sys, messages: [{ role: 'user', content: user }] });
      return (d.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    }
    case 'gemini': {
      const d = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model || DEFAULT_MODELS.gemini)}:generateContent`, { 'x-goog-api-key': c.apiKey }, {
        systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2000, ...(json ? { responseMimeType: 'application/json' } : {}) },
      });
      return (d.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
    }
    default: throw new AiError(400, `Unknown AI provider ${c.provider}`);
  }
}

/** Parses JSON even if the model wrapped it in prose or code fences. */
export function parseJsonLoose<T>(text: string): T {
  const t = text.replace(/```json|```/g, '').trim();
  try { return JSON.parse(t); } catch { /* try the outermost object */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new AiError(502, 'The AI returned an unreadable answer. Try again.');
}
