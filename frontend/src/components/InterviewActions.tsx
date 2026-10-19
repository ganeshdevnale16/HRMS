import { useState } from 'react';
import { api, fmtDT, toLocalInput } from '../api';
import { Modal, useAction } from '../ui';

export function RescheduleModal({ iv, onClose, onDone }: { iv: any; onClose: () => void; onDone: () => void }) {
  const dur = Math.round((new Date(iv.endAt).getTime() - new Date(iv.startAt).getTime()) / 60000);
  const [start, setStart] = useState(toLocalInput(new Date(iv.startAt)));
  const [problems, setProblems] = useState<string[] | null>(null);
  const { run, busy } = useAction();
  async function go(force = false) {
    setProblems(null);
    try { await api(`/interviews/${iv.id}/reschedule`, { body: { start: new Date(start).toISOString(), durationMins: dur, force } }); onDone(); onClose(); }
    catch (e: any) { if (e.status === 409) setProblems(e.details?.problems ?? [e.message]); else await run(() => Promise.reject(e)); }
  }
  return <Modal title={`Reschedule ${iv.round}`} onClose={onClose} footer={<><button className="btn o" onClick={onClose}>Cancel</button><button className="btn g" disabled={busy} onClick={() => go()}>Reschedule and notify</button></>}>
    <p className="small muted" style={{ marginTop: 0 }}>Currently {fmtDT(iv.startAt)}. {iv.provider === 'TEAMS_MANUAL' ? <b>This Teams meeting was sent from your own Outlook — after saving here, also move it in Outlook/Teams so attendees get the new time.</b> : 'The meeting is updated on the platform and everyone gets the new time.'}</p>
    <label className="f" style={{ maxWidth: 280 }}>New time<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
    {problems && <div className="error">{problems.join('; ')}<div><button className="btn danger sm" style={{ marginTop: 6 }} onClick={() => go(true)}>Reschedule anyway</button></div></div>}
  </Modal>;
}

export function CancelModal({ iv, onClose, onDone }: { iv: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { run, busy } = useAction();
  return <Modal title={`Cancel ${iv.round}`} onClose={onClose} footer={<><button className="btn o" onClick={onClose}>Keep interview</button><button className="btn danger" disabled={busy} onClick={async () => { if (await run(() => api(`/interviews/${iv.id}/cancel`, { body: { reason } }), 'Interview cancelled; attendees notified')) { onDone(); onClose(); } }}>Cancel interview</button></>}>
    {iv.provider === 'TEAMS_MANUAL' && <div className="warn">This Teams meeting was sent from your own Outlook. After cancelling here, also <b>cancel it in Outlook/Teams</b> so attendees are notified.</div>}
    <label className="f">Reason (shared with attendees)<textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
  </Modal>;
}

export function FeedbackModal({ iv, onClose, onDone }: { iv: any; onClose: () => void; onDone: () => void }) {
  const [pid, setPid] = useState(iv.panel[0]?.interviewer.id ?? '');
  const p = iv.panel.find((x: any) => x.interviewer.id === pid);
  const [f, setF] = useState<any>({ feedback: p?.feedback ?? '', recommendation: p?.recommendation ?? 'Next round', ratings: p?.ratings ?? { technical: 3, communication: 3, roleFit: 3 }, analyse: true });
  const [result, setResult] = useState<any>(p?.aiAnalysis ?? null);
  const { run, busy } = useAction();
  async function save() {
    const r = await run(() => api(`/interviews/${iv.id}/feedback`, { body: { interviewerId: pid, ...f } }), 'Feedback saved');
    if (r) { setResult(r.aiAnalysis); onDone(); if (!r.aiAnalysis) onClose(); }
  }
  return <Modal title={`Feedback · ${iv.candidate.name}`} onClose={onClose} footer={<><button className="btn o" onClick={onClose}>Close</button><button className="btn g" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Submit feedback'}</button></>}>
    <p className="small muted" style={{ marginTop: 0 }}>{iv.round} · {fmtDT(iv.startAt)}</p>
    <div className="fgrid">
      <label className="f">Interviewer<select value={pid} onChange={(e) => setPid(e.target.value)}>{iv.panel.map((x: any) => <option key={x.interviewer.id} value={x.interviewer.id}>{x.interviewer.name}{x.submittedAt ? ' (submitted)' : ''}</option>)}</select></label>
      <label className="f">Recommendation<select value={f.recommendation} onChange={(e) => setF({ ...f, recommendation: e.target.value })}>{['Hire', 'Next round', 'Hold', 'Reject'].map((r) => <option key={r}>{r}</option>)}</select></label>
      {(['technical', 'communication', 'roleFit'] as const).map((k) => <label key={k} className="f">{k === 'roleFit' ? 'Role fit' : k[0].toUpperCase() + k.slice(1)} (1–5)<input type="number" min={1} max={5} value={f.ratings[k]} onChange={(e) => setF({ ...f, ratings: { ...f.ratings, [k]: Number(e.target.value) } })} /></label>)}
      <label className="f full">Notes — evidence for your ratings<textarea rows={6} value={f.feedback} onChange={(e) => setF({ ...f, feedback: e.target.value })} /></label>
      <label className="row small full"><input type="checkbox" checked={f.analyse} onChange={(e) => setF({ ...f, analyse: e.target.checked })} /> Check my feedback with AI (structure, vague or non-job-related remarks)</label>
    </div>
    {result && !result.error && <div className="ai"><span className="tag">AI check</span> · suggests <b>{result.recommendation}</b> · technical {result.technical}/5 · communication {result.communication}/5 · role fit {result.roleFit}/5
      <p style={{ margin: '6px 0' }}>{result.summary}</p>{result.flags?.length > 0 && <div className="warn">Review: {result.flags.join('; ')}</div>}</div>}
    {result?.error && <div className="warn">AI check unavailable: {result.error}</div>}
  </Modal>;
}
