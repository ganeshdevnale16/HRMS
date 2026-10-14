import { useState } from 'react';
import { api, fmtDT, human } from '../api';
import { Empty, Ext, Modal, Page, useAction, useApi, useToast } from '../ui';
import FormatHelp from '../components/FormatHelp';

const FIELD_LABEL: Record<string, string> = { name: 'Full name', email: 'Email', phone: 'Phone', location: 'Current location', expYears: 'Experience (yrs)', skills: 'Skills', company: 'Current company', title: 'Current title', currentCtc: 'Current CTC', expectedCtc: 'Expected CTC', noticeDays: 'Notice period', education: 'Education', workMode: 'Work mode', externalId: 'Source record ID', resumeUrl: 'Resume / profile link', requirementCode: 'Requirement code (assigns the job)' };
const SCHEDULES: [string, string][] = [['', 'Manual only'], ['*/15 * * * *', 'Every 15 minutes'], ['0 * * * *', 'Hourly'], ['0 */4 * * *', 'Every 4 hours'], ['0 6 * * *', 'Daily at 6 am'], ['0 6 * * 1', 'Weekly (Monday 6 am)']];

function MappingEditor({ fields, mapping, preview, onChange }: { fields: string[]; mapping: Record<string, string>; preview?: any[]; onChange: (m: Record<string, string>) => void }) {
  const { run, busy } = useAction();
  return <div>
    <div className="spread"><p className="small muted" style={{ margin: 0 }}>Match each incoming field to a HRMS field. Fields mapped to the same target are combined (first + last name).</p>
      <button className="btn o sm" disabled={busy} onClick={async () => { const r = await run(() => api('/sources/ai/map', { body: { fields, sample: preview?.[0] } }), 'Mapping suggested. Check each row.'); if (r) onChange({ ...mapping, ...r }); }}>Suggest mapping with AI</button></div>
    <div className="maprow" style={{ fontWeight: 700, fontSize: 12 }}><span>Incoming field</span><span /><span>HRMS field</span><span>{preview ? 'Sample value' : ''}</span></div>
    {fields.map((f) => <div key={f} className="maprow"><code>{f}</code><span aria-hidden>→</span>
      <select value={mapping[f] ?? ''} onChange={(e) => onChange({ ...mapping, [f]: e.target.value })} aria-label={`Map ${f}`}><option value="">Ignore</option>{Object.entries(FIELD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <span className="small muted">{preview ? String(f.split('.').reduce((a: any, k) => a?.[k], preview[0]) ?? preview[0]?.[f] ?? '').slice(0, 40) : ''}</span></div>)}
  </div>;
}

const SECRET_LABEL: Record<string, string> = { user: 'Email address / username', password: 'Password or app password', username: 'Username (or API key)', apiKey: 'API key', token: 'Access token',
  clientId: 'Client ID', clientSecret: 'Client secret', refreshToken: 'Refresh token', connectionString: 'Connection string (read-only user)' };

const AUTH_SECRETS: Record<string, string[]> = { apiKey: ['apiKey'], bearer: ['token'], basic: ['username', 'password'], oauth2: ['clientId', 'clientSecret'], oauth2_refresh: ['clientId', 'clientSecret', 'refreshToken'] };
const secretFieldsFor = (tpl: any, connector: string, config: any): string[] =>
  connector === 'rest' ? AUTH_SECRETS[config?.authType] ?? [] : tpl?.secretFields ?? (connector === 'imap' ? ['user', 'password'] : connector === 'postgres' ? ['connectionString'] : []);

const UpdateMode = ({ value, onChange }: { value?: string; onChange: (v: string) => void }) => (
  <label className="f full">When a candidate already exists in HRMS (same email, phone or source ID)
    <select value={value ?? 'fill'} onChange={(e) => onChange(e.target.value)}>
      <option value="fill">Merge: only fill details that are empty in HRMS (recommended — recruiter edits are never overwritten)</option>
      <option value="overwrite">Overwrite: replace HRMS details with this source’s latest values</option>
    </select></label>
);

function AddSource({ meta, onClose, onDone }: { meta: any; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [tpl, setTpl] = useState<any>(null);
  const [s, setS] = useState<any>({});
  const [secret, setSecret] = useState<Record<string, string>>({});
  const [fields, setFields] = useState<string[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [created, setCreated] = useState<any>(null);
  const { run, busy } = useAction();
  const cfg = (k: string, v: any) => { setS({ ...s, config: { ...s.config, [k]: v } }); setPreview(null); };
  const conn = meta.connectors.find((c: any) => c.type === s.connector);
  const canonical = !!conn?.canonical;
  const groups = [...new Set(meta.templates.map((t: any) => t.group))] as string[];
  const secretFields = secretFieldsFor(tpl, s.connector, s.config);

  function choose(t: any) {
    setTpl(t); setSecret({}); setPreview(null);
    setS({ name: t.name, connector: t.connector, template: t.id, schedule: ['rest', 'postgres', 'csvurl'].includes(t.connector) ? '0 * * * *' : ['imap', 'graphmail'].includes(t.connector) ? '*/15 * * * *' : '', config: { ...t.config }, mapping: { ...t.mapping } });
    setFields(Object.keys(t.mapping)); setStep(2);
  }
  async function testPreview() {
    const r = await run(() => api('/sources/preview', { body: { connector: s.connector, config: s.config, secret } }));
    if (!r) return;
    setPreview(r);
    if (r.ok && !canonical && r.fields.length) {
      setFields(r.fields);
      setS((x: any) => ({ ...x, mapping: Object.fromEntries(r.fields.map((f: string) => [f, x.mapping?.[f] ?? r.mapping[f] ?? ''])) }));
    }
  }
  async function save() {
    const r = await run(() => api('/sources', { body: { ...s, mapping: canonical ? {} : s.mapping, schedule: s.schedule || null, secret: Object.keys(secret).length ? secret : undefined } }), `${s.name} connected`);
    if (r) { onDone(); if (r.webhook) setCreated(r); else onClose(); }
  }

  if (created) return <Modal title="Webhook ready" onClose={onClose} footer={<button className="btn g" onClick={onClose}>Done</button>}>
    <p>Give these to the sending system. The secret is shown only once.</p>
    <div className="kv" style={{ gridTemplateColumns: '1fr' }}><div><span>Endpoint (POST JSON)</span><code>{location.origin}{created.webhook.url}</code></div><div><span>Signing secret</span><code>{created.webhook.secret}</code></div>
      <div><span>Signature header</span><code>X-Signature: sha256=HMAC_SHA256(secret, raw request body)</code></div></div>
  </Modal>;

  const c = s.connector;
  const needsPreview = ['imap', 'graphmail', 'csvurl', 'rest', 'postgres'].includes(c);
  const lastStep = canonical || !needsPreview ? 2 : 3;
  const canSave = !needsPreview || preview?.ok;
  return <Modal wide title="Add data source" onClose={onClose} footer={<>
    {step > 1 && <button className="btn o" onClick={() => setStep(step - 1)}>Back</button>}<button className="btn o" onClick={onClose}>Cancel</button>
    {step === 2 && lastStep === 3 && <button className="btn g" onClick={() => setStep(3)} disabled={!preview?.ok}>Continue to field mapping</button>}
    {step === lastStep && <button className="btn g" onClick={save} disabled={busy || !s.name || !canSave || (step === 3 && !Object.values(s.mapping).includes('name'))}>Connect source</button>}</>}>
    <div className="steps">{['Choose source', 'Connect & test', ...(lastStep === 3 ? ['Map fields'] : [])].map((x, i) => <span key={x} className={step === i + 1 ? 'on' : ''}>{i + 1}. {x}</span>)}</div>

    {step === 1 && <div className="stack">{groups.map((g) => <div key={g}><h3>{g}</h3><div className="opt">
      {meta.templates.filter((t: any) => t.group === g).map((t: any) => <button key={t.id} onClick={() => choose(t)}><b>{t.name} {!t.ready && <span className="pill a" style={{ marginLeft: 4 }}>Partner access</span>}</b><span>{t.note}</span></button>)}
    </div></div>)}</div>}

    {step === 2 && <div className="fgrid">
      {tpl?.note && <div className={tpl.ready ? 'ai full' : 'warn full'}>{tpl.note} {tpl.link && <Ext href={tpl.link}>{tpl.linkText ?? 'Reference'}</Ext>}</div>}
      <label className="f">Source name<input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></label>
      {conn?.pull && <label className="f">Check for new candidates<select value={s.schedule} onChange={(e) => setS({ ...s, schedule: e.target.value })}>{SCHEDULES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}

      {conn?.pull && <UpdateMode value={s.config?.updateMode} onChange={(v) => setS({ ...s, config: { ...s.config, updateMode: v } })} />}
      {c === 'imap' && <>
        <label className="f">IMAP server<input value={s.config.host} onChange={(e) => cfg('host', e.target.value)} placeholder="imap.gmail.com" /></label>
        <label className="f">Port<input type="number" value={s.config.port} onChange={(e) => cfg('port', Number(e.target.value))} /></label>
        <label className="f">Folder<input value={s.config.mailbox} onChange={(e) => cfg('mailbox', e.target.value)} placeholder="INBOX or a label like Resumes" /></label>
        <label className="f">On first sync, read the last (days)<input type="number" min={1} value={s.config.firstSyncDays} onChange={(e) => cfg('firstSyncDays', Number(e.target.value))} /></label>
        <label className="f">After import, move emails to folder (optional)<input value={s.config.moveTo ?? ''} onChange={(e) => cfg('moveTo', e.target.value || undefined)} placeholder="Imported" /></label>
      </>}
      {c === 'graphmail' && <>
        <label className="f">Mailbox<input value={s.config.mailbox} onChange={(e) => cfg('mailbox', e.target.value)} /></label>
        <label className="f">Folder<input value={s.config.folder} onChange={(e) => cfg('folder', e.target.value)} placeholder="inbox" /></label>
        <label className="f">On first sync, read the last (days)<input type="number" min={1} value={s.config.firstSyncDays} onChange={(e) => cfg('firstSyncDays', Number(e.target.value))} /></label>
      </>}
      {['csvurl', 'file'].includes(c) && <div className="full"><FormatHelp kind="sheet" /></div>}
      {c === 'csvurl' && <label className="f full">Sheet or file link<input value={s.config.url} onChange={(e) => cfg('url', e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0" /></label>}
      {c === 'rest' && <>
        <label className="f full">Endpoint URL<input value={s.config.url ?? ''} onChange={(e) => cfg('url', e.target.value)} placeholder="https://api.vendor.com/v1/candidates" /></label>
        <label className="f">Authentication<select value={s.config.authType ?? 'none'} onChange={(e) => { cfg('authType', e.target.value); setSecret({}); }}>{[['none', 'None'], ['apiKey', 'API key'], ['bearer', 'Bearer token'], ['basic', 'Username + password'], ['oauth2', 'OAuth 2.0 client credentials'], ['oauth2_refresh', 'OAuth 2.0 refresh token']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="f">Records are at (JSON path)<input value={s.config.recordsPath ?? ''} onChange={(e) => cfg('recordsPath', e.target.value)} placeholder="data · blank if the response is a list" /></label>
        {s.config.authType === 'apiKey' && <label className="f">Key header name<input value={s.config.apiKeyHeader ?? 'x-api-key'} onChange={(e) => cfg('apiKeyHeader', e.target.value)} /></label>}
        {s.config.authType?.startsWith('oauth2') && <label className="f">Token URL<input value={s.config.tokenUrl ?? ''} onChange={(e) => cfg('tokenUrl', e.target.value)} /></label>}
        <label className="f">Pagination<select value={s.config.pagination ?? 'none'} onChange={(e) => cfg('pagination', e.target.value)}>{[['none', 'None'], ['page', 'Page number'], ['offset', 'Offset'], ['cursor', 'Cursor'], ['nextUrl', 'Next-page URL']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="f">Only-new-records parameter (optional)<input value={s.config.sinceParam ?? ''} onChange={(e) => cfg('sinceParam', e.target.value)} placeholder="updated_after" /></label>
      </>}
      {c === 'postgres' && <label className="f full">Query ($1 = last sync time)<textarea rows={3} value={s.config.query ?? ''} onChange={(e) => cfg('query', e.target.value)} /></label>}
      {secretFields.map((k) => <label key={k} className="f">{SECRET_LABEL[k] ?? k}<input type={/password|secret|token|key|connection/i.test(k) ? 'password' : 'text'} autoComplete="off" value={secret[k] ?? ''} onChange={(e) => { setSecret({ ...secret, [k]: e.target.value }); setPreview(null); }} /></label>)}
      {c === 'webhook' && <p className="full small">A signed endpoint and secret are created when you connect.</p>}
      {c === 'file' && <p className="full small">After connecting, use <b>Upload file</b> on this source and map columns on each upload.</p>}

      {needsPreview && <div className="full">
        <button className="btn o" disabled={busy} onClick={testPreview}>{busy ? 'Connecting…' : 'Test & preview'}</button>
        {preview && !preview.ok && <div className="error">{preview.message}</div>}
        {preview?.ok && <div className="ai"><span className="tag">Connected</span> · {preview.count} record{preview.count === 1 ? '' : 's'} found{canonical ? ' in the most recent emails' : ' on the first page'}.
          {canonical && preview.preview.length > 0 && <div className="tw" style={{ marginTop: 8 }}><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Experience</th><th>Skills</th></tr></thead><tbody>
            {preview.preview.map((r: any, i: number) => <tr key={i}><td>{r.name ?? '—'}</td><td>{r.email ?? '—'}</td><td>{r.phone ?? '—'}</td><td>{r.expYears ?? '—'}</td><td className="small">{String(r.skills ?? '').slice(0, 80)}</td></tr>)}</tbody></table></div>}
          {canonical && !preview.preview.length && <p className="small" style={{ margin: '6px 0 0' }}>No resume attachments in that period yet. You can still connect; new emails will be picked up.</p>}
        </div>}
      </div>}
    </div>}

    {step === 3 && <MappingEditor fields={fields} mapping={s.mapping} preview={preview?.preview} onChange={(m) => setS({ ...s, mapping: m })} />}
  </Modal>;
}

function EditSource({ src, meta, onClose, onDone }: { src: any; meta: any; onClose: () => void; onDone: () => void }) {
  const tpl = meta.templates.find((t: any) => t.id === src.template);
  const conn = meta.connectors.find((c: any) => c.type === src.connector);
  const [f, setF] = useState<any>({ name: src.name, schedule: src.schedule ?? '', config: { ...src.config } });
  const [secret, setSecret] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<any>(null);
  const { run, busy } = useAction();
  const fields = secretFieldsFor(tpl, src.connector, f.config);
  const cfg = (k: string, v: any) => setF({ ...f, config: { ...f.config, [k]: v } });
  const body = () => ({ name: f.name, schedule: f.schedule || null, config: f.config, ...(Object.values(secret).some(Boolean) ? { secret: Object.fromEntries(Object.entries(secret).filter(([, v]) => v)) } : {}) });
  return <Modal title={`Edit ${src.name}`} onClose={onClose} footer={<>
    {conn?.pull && <button className="btn o" disabled={busy} onClick={async () => { const r = await run(() => api('/sources/preview', { body: { connector: src.connector, config: f.config, secret, sourceId: src.id } })); if (r) setMsg(r); }}>Test & preview</button>}
    <button className="btn o" onClick={onClose}>Cancel</button>
    <button className="btn g" disabled={busy || !f.name} onClick={async () => { if (await run(() => api(`/sources/${src.id}`, { method: 'PATCH', body: body() }), 'Source updated')) { onDone(); onClose(); } }}>Save changes</button></>}>
    <div className="fgrid">
      <label className="f">Source name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      {conn?.pull && <label className="f">Check for new candidates<select value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })}>{SCHEDULES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
      {conn?.pull && <UpdateMode value={f.config.updateMode} onChange={(v) => cfg('updateMode', v)} />}
      {src.connector === 'imap' && <><label className="f">IMAP server<input value={f.config.host ?? ''} onChange={(e) => cfg('host', e.target.value)} /></label><label className="f">Folder<input value={f.config.mailbox ?? ''} onChange={(e) => cfg('mailbox', e.target.value)} /></label></>}
      {src.connector === 'graphmail' && <><label className="f">Mailbox<input value={f.config.mailbox ?? ''} onChange={(e) => cfg('mailbox', e.target.value)} /></label><label className="f">Folder<input value={f.config.folder ?? ''} onChange={(e) => cfg('folder', e.target.value)} /></label></>}
      {src.connector === 'csvurl' && <label className="f full">Sheet or file link<input value={f.config.url ?? ''} onChange={(e) => cfg('url', e.target.value)} /></label>}
      {src.connector === 'rest' && <label className="f full">Endpoint URL<input value={f.config.url ?? ''} onChange={(e) => cfg('url', e.target.value)} /></label>}
      {src.connector === 'postgres' && <label className="f full">Query<textarea rows={3} value={f.config.query ?? ''} onChange={(e) => cfg('query', e.target.value)} /></label>}
      {fields.map((k) => <label key={k} className="f">{SECRET_LABEL[k] ?? k} {src.hasSecret && <span className="muted">(blank = keep saved)</span>}<input type={/password|secret|token|key|connection/i.test(k) ? 'password' : 'text'} autoComplete="off" value={secret[k] ?? ''} onChange={(e) => setSecret({ ...secret, [k]: e.target.value })} /></label>)}
    </div>
    {msg && (msg.ok ? <div className="ai"><span className="tag">Connected</span> · {msg.count} record(s) found.</div> : <div className="error">{msg.message}</div>)}
  </Modal>;
}

function DeleteSource({ src, onClose, onDone }: { src: any; onClose: () => void; onDone: () => void }) {
  const [withCands, setWithCands] = useState(false);
  const [typed, setTyped] = useState('');
  const { run, busy } = useAction();
  return <Modal title={`Delete ${src.name}`} onClose={onClose} footer={<><button className="btn o" onClick={onClose}>Cancel</button>
    <button className="btn danger" disabled={busy || typed !== 'DELETE'} onClick={async () => { const r = await run(() => api(`/sources/${src.id}?deleteCandidates=${withCands}`, { method: 'DELETE' })); if (r) { alert(`Source deleted. ${r.deletedCandidates} candidates removed, ${r.keptCandidates} kept.`); onDone(); onClose(); } }}>Delete source</button></>}>
    <p style={{ marginTop: 0 }}>The connection, its credentials and its import history are removed. It stops syncing immediately.</p>
    <label className="row" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={withCands} onChange={(e) => setWithCands(e.target.checked)} style={{ marginTop: 3 }} />
      <span>Also delete candidates that came <b>only</b> from this source and are still at Sourced or Screening.<br /><span className="small muted">Candidates who were contacted, interviewed or beyond, or who also exist in another source, are always kept.</span></span></label>
    <label className="f" style={{ marginTop: 12 }}>Type DELETE to confirm<input value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
  </Modal>;
}

function Upload({ src, reqs, onClose, onDone }: { src: any; reqs: any[]; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [d, setD] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [req, setReq] = useState('');
  const [result, setResult] = useState<any>(null);
  const { run, busy } = useAction();
  async function pick(f: File) {
    setFile(f); const fd = new FormData(); fd.append('file', f);
    const r = await run(() => api('/sources/detect', { form: fd }));
    if (r) { setD(r); setMapping({ ...r.mapping, ...Object.fromEntries(Object.entries(src.mapping ?? {}).filter(([k]) => r.fields.includes(k))) as any }); }
  }
  async function go() {
    const fd = new FormData(); fd.append('file', file!); fd.append('mapping', JSON.stringify(mapping)); fd.append('saveMapping', 'true'); if (req) fd.append('requirementId', req);
    const r = await run(() => api(`/sources/${src.id}/upload`, { form: fd }));
    if (r) { setResult(r); onDone(); }
  }
  if (result) return <Modal title="Import complete" onClose={onClose} footer={<button className="btn g" onClick={onClose}>Done</button>}>
    <p><b>{result.added}</b> new candidates, <b>{result.merged}</b> merged into existing profiles, <b>{result.rejected}</b> rejected (missing name or contact details).</p>
    {result.errors?.map((e: string) => <div key={e} className="warn">{e}</div>)}</Modal>;
  return <Modal wide title={`Upload to ${src.name}`} onClose={onClose} footer={<><button className="btn o" onClick={onClose}>Cancel</button><button className="btn g" disabled={!d || busy || !Object.values(mapping).includes('name')} onClick={go}>{d ? `Import ${d.total} rows` : 'Import'}</button></>}>
    <div className="fgrid">
      <div className="full"><FormatHelp kind="sheet" /></div>
      <label className="f">File (.csv, .xlsx, .xls)<input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} /></label>
      <label className="f">Assign to requirement<select value={req} onChange={(e) => setReq(e.target.value)}><option value="">Auto-match each candidate</option>{reqs.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.position}</option>)}</select></label>
    </div>
    {d && <div style={{ marginTop: 14 }}><MappingEditor fields={d.fields} mapping={mapping} preview={d.preview} onChange={setMapping} /></div>}
  </Modal>;
}

export default function DataSources() {
  const { data, reload } = useApi<any[]>('/sources');
  const { data: meta } = useApi('/sources/meta');
  const { data: runs, reload: reloadRuns } = useApi<any[]>('/sources/runs');
  const { data: reqs } = useApi<any[]>('/requirements');
  const [modal, setModal] = useState<any>(null);
  const { run, busy } = useAction();
  const refresh = () => { reload(); reloadRuns(); };
  const pull = (c: string) => meta?.connectors.find((x: any) => x.type === c)?.pull;

  return (
    <Page title="Sourcing" sub="Step 2 · Connect every place candidates come from — inboxes, sheets, ATS, agencies, uploads" actions={<button className="btn g" onClick={() => setModal({ kind: 'add' })} disabled={!meta}>Add data source</button>}>
      <div className="stack">
        <section className="panel"><h2>How data reaches the candidate pool</h2>
          <p className="small" style={{ margin: 0 }}>Every source runs through the same steps: <b>connector → field mapping or resume reading → clean-up → duplicate check → auto-match to a requirement → candidate pool</b>.</p>
          <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            <li><b>Runs:</b> automatically on each source’s schedule, or immediately with <b>Sync now</b>. Webhooks add candidates the moment they arrive.</li>
            <li><b>Adds, never deletes:</b> new people are added. Someone already in HRMS (same email, phone or source ID) is merged, not duplicated. Removing a person from the source never removes them from HRMS.</li>
            <li><b>Updates:</b> by default only empty fields are filled, so recruiter edits are safe. Choose “Overwrite” on a source to let it replace details.</li>
            <li><b>Only new data:</b> inboxes read emails since the last sync; APIs use their “updated since” parameter; sheets are re-read in full and duplicates merge.</li>
          </ul></section>
        <section className="panel"><div className="tw"><table><thead><tr><th>Source</th><th>Type</th><th>Schedule</th><th>Mapped fields</th><th>Last sync</th><th>Candidates added</th><th>Status</th><th /></tr></thead><tbody>
          {data?.length ? data.map((s) => <tr key={s.id}>
            <td><div className="nm">{s.name}</div>{s.lastError && <div className="sub" style={{ color: 'var(--redink)' }}>{s.lastError}</div>}</td>
            <td>{meta?.connectors.find((c: any) => c.type === s.connector)?.label ?? s.connector}</td>
            <td className="small">{SCHEDULES.find(([v]) => v === (s.schedule ?? ''))?.[1] ?? s.schedule ?? 'Manual'}</td>
            <td>{Object.values(s.mapping).filter(Boolean).length || (s.connector === 'file' ? 'Per upload' : meta?.connectors.find((c: any) => c.type === s.connector)?.canonical ? 'Automatic (resume parsing)' : '—')}</td>
            <td>{fmtDT(s.lastSyncAt)}</td><td>{s.records}</td>
            <td><span className={`pill ${s.status === 'ACTIVE' ? 'g' : s.status === 'ERROR' ? 'r' : 'a'}`}>{human(s.status)}</span></td>
            <td><div className="row" style={{ flexWrap: 'nowrap' }}>
              {s.connector === 'file' && <button className="btn o sm" onClick={() => setModal({ kind: 'upload', src: s })}>Upload file</button>}
              {pull(s.connector) && <button className="btn g sm" disabled={busy || s.status === 'PAUSED'} onClick={async () => { const r = await run(() => api(`/sources/${s.id}/sync`, { body: {} })); if (r) { refresh(); setModal({ kind: 'result', src: s, r }); } }}>{busy ? 'Syncing…' : 'Sync now'}</button>}
              {pull(s.connector) && <button className="btn o sm" disabled={busy} onClick={async () => { const r = await run(() => api(`/sources/${s.id}/test`, { body: {} })); if (r) alert(r.message); }}>Test</button>}
              {s.connector !== 'manual' && <button className="btn o sm" onClick={async () => { if (await run(() => api(`/sources/${s.id}`, { method: 'PATCH', body: { status: s.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED' } }))) reload(); }}>{s.status === 'PAUSED' ? 'Resume' : 'Pause'}</button>}
              {!['careers', 'resume', 'manual', 'file'].includes(s.connector) && <button className="btn o sm" onClick={() => setModal({ kind: 'edit', src: s })}>Edit</button>}
              {!['careers', 'resume', 'manual'].includes(s.connector) && <button className="btn danger sm" onClick={() => setModal({ kind: 'delete', src: s })}>Delete</button>}
            </div></td></tr>) : <tr><td colSpan={8}><Empty>No sources yet. Add one to start bringing in candidates.</Empty></td></tr>}
        </tbody></table></div></section>
        <section className="panel"><h2>Ingestion log</h2><div className="tw"><table><thead><tr><th>Started</th><th>Source</th><th>Fetched</th><th>New</th><th>Merged</th><th>Rejected</th><th>Error</th></tr></thead><tbody>
          {runs?.map((r) => <tr key={r.id}><td>{fmtDT(r.startedAt)}</td><td>{r.source.name}</td><td>{r.fetched}</td><td>{r.added}</td><td>{r.merged}</td><td>{r.rejected}</td><td className="small" style={{ color: 'var(--redink)' }}>{r.error}</td></tr>)}
        </tbody></table>{!runs?.length && <Empty>No imports yet.</Empty>}</div></section>
      </div>
      {modal?.kind === 'add' && meta && <AddSource meta={meta} onClose={() => setModal(null)} onDone={refresh} />}
      {modal?.kind === 'edit' && meta && <EditSource src={modal.src} meta={meta} onClose={() => setModal(null)} onDone={refresh} />}
      {modal?.kind === 'delete' && <DeleteSource src={modal.src} onClose={() => setModal(null)} onDone={refresh} />}
      {modal?.kind === 'result' && <Modal title={`Sync finished · ${modal.src.name}`} onClose={() => setModal(null)} footer={<button className="btn g" onClick={() => setModal(null)}>Done</button>}>
        <div className="kv"><div><span>Records read</span><b>{modal.r.fetched}</b></div><div><span>New candidates</span><b>{modal.r.added}</b></div><div><span>Matched existing</span><b>{modal.r.merged}</b></div><div><span>Skipped</span><b>{modal.r.rejected}</b></div><div><span>Existing profiles</span><b>{modal.r.mode === 'overwrite' ? 'Overwritten with source values' : 'Empty fields filled only'}</b></div></div>
        {modal.r.errors?.map((e: string) => <div key={e} className="warn">{e}</div>)}
        {modal.r.rejected > 0 && <p className="small muted">Skipped records had no name, or no email/phone to identify the person.</p>}
      </Modal>}
      {modal?.kind === 'upload' && <Upload src={modal.src} reqs={reqs ?? []} onClose={() => setModal(null)} onDone={refresh} />}
    </Page>
  );
}
