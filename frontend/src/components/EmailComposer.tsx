import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Modal, useAction, useApi } from '../ui';
import { mailtoLink, outlookMailLink } from '../lib/deeplinks';

/** Write and send a personalised email to one or many candidates. Each person gets their own copy. */
export default function EmailComposer({ candidates, onClose, onSent }: { candidates: { id: string; name: string; email?: string | null }[]; onClose: () => void; onSent?: () => void }) {
  const { data } = useApi('/email/templates');
  const [tpl, setTpl] = useState('interest');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [opened, setOpened] = useState<{ subject: string; body: string; via: string } | null>(null);
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
  /** No email setup needed: opens the recruiter's own Outlook (web) or default mail app with the message filled in. */
  async function openOwn(via: 'Outlook' | 'mail app') {
    const r = await run(() => api('/email/preview', { body: { candidateId: withEmail[0].id, subject, body } }));
    if (!r) return;
    window.open(via === 'Outlook' ? outlookMailLink([r.to], r.subject, r.body) : mailtoLink([r.to], r.subject, r.body), '_blank');
    setOpened({ subject: r.subject, body: r.body, via });
  }
  async function send() {
    if (!confirm(`Send this email to ${withEmail.length} candidate${withEmail.length > 1 ? 's' : ''}?`)) return;
    const r = await run(() => api('/email/send', { body: { candidateIds: withEmail.map((c) => c.id), subject, body, template: tpl } }));
    if (r) { setResult(r); onSent?.(); }
  }

  if (opened) return <Modal title="Did you send it?" onClose={onClose} footer={<>
    <button className="btn o" onClick={() => setOpened(null)}>Back to editing</button>
    <button className="btn o" onClick={onClose}>No, don’t log</button>
    <button className="btn g" disabled={busy} onClick={async () => { if (await run(() => api('/email/log', { body: { candidateId: withEmail[0].id, subject: opened.subject, body: opened.body, via: opened.via } }), 'Saved to communication history')) { onSent?.(); onClose(); } }}>Yes, I sent it — log it</button></>}>
    <p style={{ marginTop: 0 }}>Your {opened.via} opened with the email to <b>{withEmail[0].name}</b> filled in. Send it there, then come back and confirm so it’s saved in the candidate’s Communication history.</p>
    <p className="small muted">Nothing opened? Allow pop-ups for this site, or use the other button.</p>
  </Modal>;

  if (result) return <Modal title="Email sent" onClose={onClose} footer={<button className="btn g" onClick={onClose}>Done</button>}>
    <p><b>{result.sent}</b> sent{result.failed ? <>, <b>{result.failed}</b> failed</> : ''}. Each email is saved in the candidate’s Communication history.</p>
    {result.results.filter((r: any) => !r.ok).map((r: any) => <div key={r.id} className="error">{r.name}: {r.error}</div>)}
  </Modal>;

  return <Modal wide title={`Email ${candidates.length === 1 ? candidates[0].name : `${candidates.length} candidates`}`} onClose={onClose} footer={<>
    {data?.configured && <span className="small muted" style={{ marginRight: 'auto' }}>From: {data.from}</span>}
    <button className="btn o" onClick={onClose}>Cancel</button>
    {withEmail.length === 1 && <><button className="btn o" disabled={busy || !subject.trim()} onClick={() => openOwn('Outlook')} title="Opens Outlook on the web with this email filled in — no email setup needed">Write in my Outlook</button>
      <button className="btn o" disabled={busy || !subject.trim()} onClick={() => openOwn('mail app')} title="Opens your computer's default mail app">Mail app</button></>}
    <button className="btn o" disabled={busy || !withEmail.length || !data?.configured} onClick={showPreview}>Preview</button>
    <button className="btn g" disabled={busy || !withEmail.length || !subject.trim() || !body.trim() || !data?.configured} onClick={send}>{busy ? 'Sending…' : `Send${withEmail.length > 1 ? ` to ${withEmail.length}` : ''}`}</button></>}>
    {data && !data.configured && <div className="warn">HRMS email isn’t connected, so <b>Send</b> is off. {withEmail.length === 1 ? <>Use <b>Write in my Outlook</b> to send from your own mailbox instead, or connect email under <Link to="/integrations"><b>Integrations → Email</b></Link>.</> : <>Connect it under <Link to="/integrations"><b>Integrations → Email</b></Link> to email several candidates at once, or email them one by one with <b>Write in my Outlook</b>.</>}</div>}
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
