import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Modal, useAction, useApi } from '../ui';

/** Write and send a personalised email to one or many candidates. Each person gets their own copy. */
export default function EmailComposer({ candidates, onClose, onSent }: { candidates: { id: string; name: string; email?: string | null }[]; onClose: () => void; onSent?: () => void }) {
  const { data } = useApi('/email/templates');
  const [tpl, setTpl] = useState('interest');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const { run, busy } = useAction();
  const withEmail = candidates.filter((c) => c.email);
  const missing = candidates.length - withEmail.length;

  useEffect(() => { if (data && !subject && !body) choose('interest'); }, [data]);
  function choose(id: string) {
    const t = data?.templates.find((x: any) => x.id === id);
    if (!t) return;
    if ((subject || body) && id !== tpl && !confirm('Replace the current message with this template?')) return;
    setTpl(id); setSubject(t.subject); setBody(t.body); setPreview(null);
  }
  function insert(v: string) {
    const el = area.current; const token = `{{${v}}}`;
    if (!el) { setBody(body + token); return; }
    const s = el.selectionStart ?? body.length, e = el.selectionEnd ?? body.length;
    setBody(body.slice(0, s) + token + body.slice(e));
    setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = s + token.length; }, 0);
  }
  async function showPreview() { const r = await run(() => api('/email/preview', { body: { candidateId: withEmail[0].id, subject, body } })); if (r) setPreview(r); }
  async function send() {
    if (!confirm(`Send this email to ${withEmail.length} candidate${withEmail.length > 1 ? 's' : ''}?`)) return;
    const r = await run(() => api('/email/send', { body: { candidateIds: withEmail.map((c) => c.id), subject, body, template: tpl } }));
    if (r) { setResult(r); onSent?.(); }
  }

  if (result) return <Modal title="Email sent" onClose={onClose} footer={<button className="btn g" onClick={onClose}>Done</button>}>
    <p><b>{result.sent}</b> sent{result.failed ? <>, <b>{result.failed}</b> failed</> : ''}. Each email is saved in the candidate’s Communication history.</p>
    {result.results.filter((r: any) => !r.ok).map((r: any) => <div key={r.id} className="error">{r.name}: {r.error}</div>)}
  </Modal>;

  return <Modal wide title={`Email ${candidates.length === 1 ? candidates[0].name : `${candidates.length} candidates`}`} onClose={onClose} footer={<>
    {data?.configured && <span className="small muted" style={{ marginRight: 'auto' }}>From: {data.from}</span>}
    <button className="btn o" onClick={onClose}>Cancel</button>
    <button className="btn o" disabled={busy || !withEmail.length || !data?.configured} onClick={showPreview}>Preview</button>
    <button className="btn g" disabled={busy || !withEmail.length || !subject.trim() || !body.trim() || !data?.configured} onClick={send}>{busy ? 'Sending…' : `Send${withEmail.length > 1 ? ` to ${withEmail.length}` : ''}`}</button></>}>
    {data && !data.configured && <div className="warn">Email is not set up yet. An admin can connect Gmail, Outlook / Microsoft 365, Zoho or any SMTP under <Link to="/integrations"><b>Integrations → Email</b></Link>.</div>}
    {missing > 0 && <div className="warn">{missing} selected candidate{missing > 1 ? 's have' : ' has'} no email address and will be skipped.</div>}
    <div className="fgrid">
      <label className="f">Template<select value={tpl} onChange={(e) => choose(e.target.value)}>{data?.templates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label className="f">To<input readOnly value={withEmail.length === 1 ? `${withEmail[0].name} <${withEmail[0].email}>` : `${withEmail.length} candidates (each gets a separate email)`} /></label>
      <label className="f full">Subject<input value={subject} onChange={(e) => { setSubject(e.target.value); setPreview(null); }} /></label>
      <label className="f full">Message<textarea ref={area} rows={12} value={body} onChange={(e) => { setBody(e.target.value); setPreview(null); }} /></label>
      <div className="full small">Insert: {data?.variables.map((v: string) => <button key={v} type="button" className="chip" style={{ cursor: 'pointer', background: 'none' }} onClick={() => insert(v)}>{`{{${v}}}`}</button>)}
        <span className="muted"> — filled in for each candidate. Replies go to your login email.</span></div>
    </div>
    {preview && <div className="ai"><span className="tag">Preview for {withEmail[0].name}</span><p style={{ margin: '6px 0' }}><b>{preview.subject}</b></p><div style={{ whiteSpace: 'pre-wrap' }}>{preview.body}</div></div>}
  </Modal>;
}
