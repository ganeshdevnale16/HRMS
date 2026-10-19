import { useEffect, useState } from 'react';
import { api } from '../api';
import { Ext, Page, useAction, useApi } from '../ui';

const SETUP: Record<string, string> = {
  TEAMS: 'Azure app registration with Calendars.ReadWrite (application) and admin consent. Set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_ORGANIZER_UPN.',
  ZOOM: 'Zoom Server-to-Server OAuth app with meeting write/update/delete scopes. Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET. Invites go out by email, so connect email too.',
  GOOGLE_MEET: 'Google Workspace service account with domain-wide delegation for the calendar scope. Set GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, GOOGLE_ORGANIZER_EMAIL.',
  WEBEX: 'Webex service app or integration token with meeting scopes. Set WEBEX_ACCESS_TOKEN.',
  JITSI: 'Free video meetings, no account or keys. HRMS creates a private room link and emails invites. Set JITSI_ENABLED=false to hide it.',
  TEAMS_MANUAL: 'No admin setup. HRMS books the slot and opens your own Teams or Outlook pre-filled; you click Send. Use this when you cannot register an app in Microsoft Entra.',
  LINK: 'No setup. Paste a Teams, Zoom or Meet link you created yourself; HRMS emails the calendar invite (needs Email connected).',
  IN_PERSON: 'Always available. Invites are emailed as calendar files.',
  PHONE: 'Always available. Invites are emailed as calendar files.',
  OUTLOOK: 'Uses the same Microsoft app as Teams to read interviewers’ free/busy time.',
  GOOGLE: 'Uses the same Google service account as Meet to read free/busy time.',
};

const HELP: Record<string, { key: string; note?: string; link?: string }> = {
  openai: { key: 'platform.openai.com → API keys', link: 'https://platform.openai.com/api-keys', note: 'Only for keys from platform.openai.com (or Groq/OpenRouter via base URL). Keys from Microsoft Foundry / Azure go in the Azure OpenAI card.' },
  anthropic: { key: 'console.anthropic.com → API keys', link: 'https://console.anthropic.com/settings/keys' },
  gemini: { key: 'aistudio.google.com → Get API key (free tier)', link: 'https://aistudio.google.com/apikey', note: 'On the free tier Google may use your data to improve its products — test data only.' },
  azure: { key: 'Microsoft Foundry (ai.azure.com) → your deployment → Key + Endpoint / Target URI', link: 'https://ai.azure.com', note: 'Works with GPT-4o, GPT-4.1, GPT-5 and o-series deployments. Choose an India region for data residency.' },
};

function ProviderCard({ p, onSaved }: { p: any; onSaved: () => void }) {
  const [f, setF] = useState<any>({ apiKey: '', model: p.model, baseUrl: p.baseUrl, azureEndpoint: p.azureEndpoint, azureDeployment: p.azureDeployment, azureApiVersion: p.azureApiVersion });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const { run, busy } = useAction();
  const set = (k: string) => (e: any) => { setF({ ...f, [k]: e.target.value }); setMsg(null); };
  const body = () => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
  return <div className="panel" style={{ padding: 14 }}>
    <div className="spread">
      <div><b>{p.label}</b> {p.connected ? <span className="pill g">Connected</span> : <span className="pill">Not connected</span>}
        <div className="sub">{p.connected ? `Model: ${p.model || p.defaultModel || p.azureDeployment} · key ${p.keyHint}${p.source === 'environment' ? ' · from server .env' : ''}` : HELP[p.id].key}{HELP[p.id].link && <> · <Ext href={HELP[p.id].link!}>Get a key</Ext></>}</div></div>
      <div className="row">
        {p.connected && <button className="btn o sm" disabled={busy} onClick={async () => { const r = await run(() => api('/settings/ai/test', { body: { provider: p.id } })); if (r) setMsg({ ok: r.ok, text: r.message }); }}>Test</button>}
        <button className="btn o sm" onClick={() => setOpen(!open)}>{open ? 'Hide' : p.connected ? 'Change' : 'Connect'}</button>
        {p.connected && p.source === 'database' && <button className="btn danger sm" disabled={busy} onClick={async () => { if (confirm(`Remove the saved ${p.label} key?`) && await run(() => api(`/settings/ai/providers/${p.id}`, { method: 'DELETE' }), `${p.label} removed`)) onSaved(); }}>Remove</button>}
      </div>
    </div>
    {open && <div className="fgrid" style={{ marginTop: 12 }}>
      <label className="f">API key{p.connected ? ' (blank = keep saved key)' : ''}<input type="password" autoComplete="off" value={f.apiKey} onChange={set('apiKey')} placeholder={p.connected ? p.keyHint : 'Paste key'} /></label>
      {p.id !== 'azure' && <label className="f">Model<input value={f.model} onChange={set('model')} placeholder={p.defaultModel} /></label>}
      {p.id === 'openai' && <label className="f full">Base URL (only for OpenAI-compatible services)<input value={f.baseUrl} onChange={set('baseUrl')} placeholder="https://api.openai.com/v1  ·  Groq: https://api.groq.com/openai/v1" /></label>}
      {p.id === 'azure' && <>
        <div className="ai full small"><b>From Microsoft Foundry (ai.azure.com):</b> open your project → <b>Models + endpoints</b> (Deployments) → click your deployment. Copy the <b>Key</b>, and paste the <b>Endpoint</b> or the full <b>Target URI</b> below — HRMS reads the deployment name and API version from the Target URI automatically. Key and endpoint must come from the <b>same</b> resource. <Ext href="https://learn.microsoft.com/azure/ai-foundry/openai/quickstart">Microsoft guide</Ext></div>
        <label className="f full">Endpoint or Target URI<input value={f.azureEndpoint} onChange={set('azureEndpoint')} placeholder="https://your-resource.openai.azure.com   or   …/openai/deployments/gpt-4o-mini/chat/completions?api-version=…" /></label>
        <label className="f">Deployment name (not the model name, if you renamed it)<input value={f.azureDeployment} onChange={set('azureDeployment')} placeholder="read from Target URI, or e.g. gpt-4o-mini" /></label>
        <label className="f">API version (optional)<input value={f.azureApiVersion} onChange={set('azureApiVersion')} placeholder="leave blank — HRMS picks it" /></label></>}
      {HELP[p.id].note && <p className="small muted full" style={{ margin: 0 }}>{HELP[p.id].note}</p>}
      <div className="row full" style={{ justifyContent: 'flex-end' }}>
        <button className="btn o sm" disabled={busy} onClick={async () => { const r = await run(() => api('/settings/ai/test', { body: { provider: p.id, ...body() } })); if (r) setMsg({ ok: r.ok, text: r.message }); }}>Test before saving</button>
        <button className="btn g sm" disabled={busy} onClick={async () => { if (await run(() => api(`/settings/ai/providers/${p.id}`, { method: 'PUT', body: body() }), `${p.label} saved`)) { setOpen(false); setF({ ...f, apiKey: '' }); onSaved(); } }}>Save</button>
      </div>
    </div>}
    {msg && <div className={msg.ok ? 'ai' : 'error'}>{msg.text}</div>}
  </div>;
}

function AiSettings() {
  const { data, reload } = useApi('/settings/ai');
  const [route, setRoute] = useState<any>(null);
  const { run, busy } = useAction();
  useEffect(() => { if (data) setRoute({ active: data.active, features: { ...data.features } }); }, [data]);
  if (!data || !route) return null;
  const connected = data.providers.filter((p: any) => p.connected);
  return <section className="panel stack">
    <div><h2 style={{ marginBottom: 4 }}>AI</h2><p className="small muted" style={{ margin: 0 }}>Connect one or more AI providers, pick the default, and optionally choose a different one per feature. Keys are encrypted and never shown again.</p></div>

    <div><h3>In use right now</h3><div className="tw"><table><tbody>
      {data.featureList.map((f: any) => { const u = data.inUse[f.id]; return <tr key={f.id}><td>{f.label}</td><td>{u ? <><b>{u.label}</b> · {u.model} <span className="sub">({u.reason})</span></> : <span className="pill">AI off</span>}</td></tr>; })}
    </tbody></table></div></div>

    <div><h3>Providers</h3><div className="stack">{data.providers.map((p: any) => <ProviderCard key={p.id} p={p} onSaved={reload} />)}</div></div>

    <div><h3>Which AI to use</h3>
      <div className="fgrid">
        <label className="f">Default provider<select value={route.active} onChange={(e) => setRoute({ ...route, active: e.target.value })}>
          {connected.map((p: any) => <option key={p.id} value={p.id}>{p.label} · {p.model || p.defaultModel || p.azureDeployment}</option>)}<option value="none">Off — don’t use AI</option></select></label>
        <span />
        {data.featureList.map((f: any) => <label key={f.id} className="f">{f.label}<select value={route.features[f.id] ?? ''} onChange={(e) => setRoute({ ...route, features: { ...route.features, [f.id]: e.target.value } })}>
          <option value="">Use default</option>{connected.map((p: any) => <option key={p.id} value={p.id}>{p.label} · {p.model || p.defaultModel || p.azureDeployment}</option>)}</select></label>)}
      </div>
      {!connected.length && <div className="warn">Connect at least one provider above first.</div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn g" disabled={busy || !connected.length} onClick={async () => { if (await run(() => api('/settings/ai/routing', { method: 'PUT', body: route }), 'AI selection saved')) reload(); }}>Save selection</button></div>
    </div>
  </section>;
}

function EmailSettings() {
  const { data, reload } = useApi('/settings/email');
  const [f, setF] = useState<any>(null);
  const [preset, setPreset] = useState('');
  const [testTo, setTestTo] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { run, busy } = useAction();
  useEffect(() => { if (data) setF({ provider: data.provider === 'none' ? 'smtp' : data.provider, host: data.host, port: data.port, secure: data.secure, user: data.user, password: '', fromEmail: data.fromEmail, fromName: data.fromName, replyTo: data.replyTo }); }, [data]);
  if (!data || !f) return null;
  const set = (k: string) => (e: any) => { setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); setMsg(null); };
  const p = data.presets.find((x: any) => x.id === preset);
  function pick(id: string) {
    setPreset(id); setMsg(null);
    const x = data.presets.find((y: any) => y.id === id); if (!x) return;
    setF({ ...f, provider: x.provider ?? 'smtp', ...(x.provider === 'graph' ? {} : { host: x.host, port: x.port, secure: x.secure }), user: id === 'sendgrid' ? 'apikey' : f.user });
  }
  const body = () => ({ ...f, port: Number(f.port) || undefined, password: f.password || undefined, apiKey: f.apiKey || undefined, replyTo: f.replyTo || '' });
  const configured = data.provider !== 'none';
  return <section className="panel stack">
    <div className="spread"><div><h2 style={{ marginBottom: 4 }}>Email</h2><p className="small muted" style={{ margin: 0 }}>Used to email candidates and to send interview invites for Jitsi, Zoom, in-person and phone interviews (Teams, Google Meet and Webex send their own invites).</p></div>
      {configured ? <span className="pill g">Connected · {data.provider === 'brevo' ? 'Brevo API' : data.provider === 'graph' ? 'Microsoft 365' : 'SMTP'} · {data.fromEmail}{data.source === 'environment' ? ' (from .env)' : ''}</span> : <span className="pill">Not connected</span>}</div>
    <div className="fgrid">
      <label className="f">Email service<select value={preset} onChange={(e) => pick(e.target.value)}><option value="">{configured ? 'Keep current settings' : 'Choose your email service…'}</option>{data.presets.map((x: any) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
      <span />
      {p && (p.note || p.link) && <div className="ai full small">{p.note} {p.link && <Ext href={p.link}>{p.linkText ?? 'Open'}</Ext>}</div>}
      {f.provider === 'brevo' && <label className="f full">Brevo API key{data.hasApiKey ? ' (blank = keep saved)' : ''}<input type="password" value={f.apiKey ?? ''} onChange={set('apiKey')} autoComplete="off" placeholder="xkeysib-…" /></label>}
      {f.provider === 'smtp' && <>
        <label className="f">SMTP server<input value={f.host} onChange={set('host')} placeholder="smtp.gmail.com" /></label>
        <div className="row"><label className="f" style={{ width: 110 }}>Port<input type="number" value={f.port} onChange={set('port')} /></label><label className="row small" style={{ marginTop: 18 }}><input type="checkbox" checked={!!f.secure} onChange={set('secure')} /> SSL (port 465)</label></div>
        <label className="f">Username (usually your email)<input value={f.user} onChange={set('user')} autoComplete="off" /></label>
        <label className="f">Password / app password{data.hasPassword ? ' (blank = keep saved)' : ''}<input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" /></label>
      </>}
      {f.provider === 'graph' && !data.graphReady && <div className="error full">Microsoft Graph needs MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET in the server .env (same app as Teams), plus the Mail.Send permission.</div>}
      <label className="f">“From” email{f.provider === 'graph' ? ' (the mailbox that sends)' : ''}<input type="email" value={f.fromEmail} onChange={set('fromEmail')} placeholder="recruitment@yourcompany.com" /></label>
      <label className="f">“From” name (also used as {'{{companyName}}'})<input value={f.fromName} onChange={set('fromName')} placeholder="Deloitte Recruitment" /></label>
      <label className="f">Reply-to (optional; otherwise replies go to the sender)<input type="email" value={f.replyTo} onChange={set('replyTo')} /></label>
      <span />
      <label className="f">Send a test email to<input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" /></label>
    </div>
    {msg && <div className={msg.ok ? 'ai' : 'error'}>{msg.text}</div>}
    <div className="row" style={{ justifyContent: 'flex-end' }}>
      {data.source === 'database' && <button className="btn danger sm" disabled={busy} onClick={async () => { if (confirm('Disconnect email? Candidate emails and emailed invites will stop.') && await run(() => api('/settings/email', { method: 'DELETE' }), 'Email disconnected')) reload(); }}>Disconnect</button>}
      <button className="btn o" disabled={busy || !testTo} onClick={async () => { const r = await run(() => api('/settings/email/test', { body: { ...body(), to: testTo } })); if (r) setMsg({ ok: r.ok, text: r.message }); }}>{busy ? 'Testing…' : 'Send test email'}</button>
      <button className="btn g" disabled={busy} onClick={async () => { if (await run(() => api('/settings/email', { method: 'PUT', body: body() }), 'Email settings saved')) { setPreset(''); reload(); } }}>Save</button>
    </div>
  </section>;
}

export default function Integrations() {
  const { data } = useApi('/integrations');
  const { run, busy } = useAction();
  const test = async (id: string) => { const r = await run(() => api('/integrations/test', { body: { id } })); if (r) alert((r.ok ? 'Working. ' : 'Not working. ') + r.message); };
  const Row = ({ id, label, ok, extra }: { id: string; label: string; ok: boolean; extra?: string }) => (
    <tr><td><div className="nm">{label}</div><div className="sub">{extra ?? SETUP[id]}</div></td>
      <td>{ok ? <span className="pill g">Connected</span> : <span className="pill">Not connected</span>}</td>
      <td><button className="btn o sm" disabled={!ok || busy} onClick={() => test(id)}>Test connection</button></td></tr>);
  if (!data) return <Page title="Integrations"><p className="muted">Loading…</p></Page>;
  return (
    <Page title="Integrations" sub="AI providers, email, meeting platforms and calendars">
      <div className="stack">
        <AiSettings />
        <EmailSettings />
        <section className="panel"><h2>Meeting platforms</h2><table><tbody>{data.meeting.map((m: any) => <Row key={m.id} id={m.id} label={m.label} ok={m.configured} />)}</tbody></table></section>
        <section className="panel"><h2>Calendars for interviewer availability</h2><table><tbody>{data.calendar.map((c: any) => <Row key={c.id} id={c.id} label={c.label} ok={c.configured} />)}</tbody></table></section>
        <p className="small muted">Meeting and calendar credentials live in the server environment; AI and email settings are stored encrypted in the database. Default time zone: {data.timezone}.</p>
      </div>
    </Page>
  );
}
