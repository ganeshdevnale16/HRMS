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
  if (!r.ok) {
    const msg = d?.error?.message ?? d?.message ?? r.statusText;
    const hint = r.status === 401 || r.status === 403 ? ' — check the API key' : r.status === 404 ? ' — check the model / deployment name' : r.status === 429 ? ' — rate limit or quota reached' : '';
    throw new AiError(502, `AI request failed (${r.status}): ${msg}${hint}`);
  }
  return d;
}

export async function callProvider(c: AiConfig, system: string, user: string, json: boolean): Promise<string> {
  if (!c.provider || c.provider === 'none') throw new AiError(503, 'AI is not configured. An admin can set it up under Integrations → AI provider.');
  if (!c.apiKey) throw new AiError(503, `No API key saved for ${c.provider}.`);
  const sys = system + (json ? '\nRespond with a single JSON object only. No prose, no code fences.' : '');
  const msgs = [{ role: 'system', content: sys }, { role: 'user', content: user }];

  switch (c.provider) {
    case 'openai': {
      const d = await post(`${(c.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, { Authorization: `Bearer ${c.apiKey}` },
        { model: c.model || DEFAULT_MODELS.openai, temperature: 0.2, max_tokens: 2000, messages: msgs, ...(json ? { response_format: { type: 'json_object' } } : {}) });
      return d.choices?.[0]?.message?.content ?? '';
    }
    case 'azure': {
      if (!c.azureEndpoint || !c.azureDeployment) throw new AiError(400, 'Azure OpenAI needs an endpoint and a deployment name.');
      const d = await post(`${c.azureEndpoint.replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(c.azureDeployment)}/chat/completions?api-version=${c.azureApiVersion || '2024-10-21'}`,
        { 'api-key': c.apiKey }, { temperature: 0.2, max_tokens: 2000, messages: msgs, ...(json ? { response_format: { type: 'json_object' } } : {}) });
      return d.choices?.[0]?.message?.content ?? '';
    }
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
