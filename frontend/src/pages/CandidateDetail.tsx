import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, openFile, fmtDate, fmtDT, human, PROVIDER_LABEL, ROUNDS, STAGES } from '../api';
import { Empty, Page, Score, Skills, StagePill, useAction, useApi } from '../ui';
import ScheduleInterview from '../components/ScheduleInterview';
import EmailComposer from '../components/EmailComposer';
import { FeedbackModal } from '../components/InterviewActions';

export default function CandidateDetail() {
  const { id } = useParams();
  const { data: c, reload, error } = useApi(`/candidates/${id}`);
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState<any>(null);
  const [comm, setComm] = useState<any>({ channel: 'CALL', outcome: 'Connected', notes: '', nextAction: '', followUpAt: '' });
  const [draft, setDraft] = useState('');
  const [round, setRound] = useState('L1 Technical');
  const { run, busy } = useAction();
  const nav = useNavigate();
  async function replaceResume(file?: File) {
    if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    if (await run(() => api(`/candidates/${id}/resume`, { form: fd }), 'Resume saved')) reload();
  }
  if (error) return <Page title="Candidate"><div className="error">{error}</div></Page>;
  if (!c) return <Page title="Candidate"><Empty>Loading…</Empty></Page>;
  const si = STAGES.indexOf(c.stage);
  const next = STAGES[si + 1];
  async function moveTo(stage: string) {
    if (!stage || stage === c.stage) return;
    const back = STAGES.indexOf(stage as any) < si;
    const reason = prompt(`Move ${c.name} from ${human(c.stage)} to ${human(stage)}${back ? ' (backwards)' : ''}?\n\nOptional reason for the timeline:`, '');
    if (reason === null) return;
    act(() => api(`/candidates/${c.id}/stage`, { body: { stage, reason: reason || 'Moved manually' } }), `Moved to ${human(stage)}`);
  }
  const act = async (fn: () => Promise<any>, ok?: string) => { if (await run(fn, ok)) reload(); };

  return (
    <Page title={c.name} sub={[c.title, c.company, c.requirement && `for ${c.requirement.client} – ${c.requirement.position}`].filter(Boolean).join(' · ')}
      actions={<>
        <select value="" aria-label="Move to any stage" disabled={busy} onChange={(e) => {
          const to = e.target.value; if (!to) return;
          const ti = STAGES.indexOf(to as any);
          const warn = ti > si + 1 ? `\n\nThis skips ${ti - si - 1} stage(s). Records needed for ${human(to)} (offer, BGV, joining, billing) are created empty for you to fill in.` : ti < si ? '\n\nMoving back keeps all existing interview, offer and billing records.' : '';
          if (confirm(`Move ${c.name} from ${human(c.stage)} to ${human(to)}?${c.status !== 'ACTIVE' ? `\nStatus changes from ${human(c.status)} to Active.` : ''}${warn}`))
            act(() => api(`/candidates/${c.id}/stage`, { body: { stage: to, reason: 'Moved manually' } }), `Moved to ${human(to)}`);
        }}>
          <option value="">Move to stage…</option>
          {STAGES.map((s, i) => <option key={s} value={s} disabled={s === c.stage && c.status === 'ACTIVE'}>{i + 1}. {human(s)}{s === c.stage ? ' (current)' : ''}</option>)}
        </select>
        {next && c.status !== 'REJECTED' && <button className="btn g" disabled={busy} onClick={() => act(() => api(`/candidates/${c.id}/stage`, { body: { stage: next } }), `Moved to ${human(next)}`)}>Move to {human(next)}</button>}
        <select value="" disabled={busy} aria-label="Move to any stage" onChange={(e) => moveTo(e.target.value)} style={{ fontWeight: 600 }}>
          <option value="">Move to stage…</option>
          {STAGES.map((s, i) => <option key={s} value={s} disabled={s === c.stage}>{i + 1}. {human(s)}{s === c.stage ? ' (current)' : ''}</option>)}
        </select>
        {c.resumeFileId && <button className="btn o" onClick={() => run(() => openFile(`/candidates/${c.id}/resume`))}>View resume</button>}
        <label className="btn o" style={{ cursor: 'pointer' }}>{c.resumeFileId ? 'Replace resume' : 'Add resume'}<input type="file" accept=".pdf,.docx,.txt" hidden onChange={(e) => { replaceResume(e.target.files?.[0]); e.target.value = ''; }} /></label>
        {c.resumeFileId && <button className="btn danger" onClick={() => { if (confirm('Remove the resume file? The candidate profile stays.')) act(() => api(`/candidates/${c.id}/resume`, { method: 'DELETE' }), 'Resume removed'); }}>Remove resume</button>}
        <button className="btn o" disabled={!c.email} title={c.email ? '' : 'No email address on file'} onClick={() => setModal({ kind: 'email' })}>Send email</button>
        <button className="btn o" onClick={() => setModal({ kind: 'schedule' })}>Schedule interview</button>
        {c.status === 'ACTIVE' ? <button className="btn o" onClick={() => act(() => api(`/candidates/${c.id}/status`, { body: { status: 'HOLD' } }), 'On hold')}>Hold</button>
          : <button className="btn o" onClick={() => act(() => api(`/candidates/${c.id}/status`, { body: { status: 'ACTIVE' } }), 'Reactivated')}>Reactivate</button>}
        <button className="btn danger" onClick={async () => { if (prompt(`Permanently delete ${c.name} with all interviews, notes, offer/billing records and resume? Type DELETE to confirm.`) === 'DELETE' && await run(() => api(`/candidates/${c.id}`, { method: 'DELETE' }), 'Candidate deleted')) nav('/candidates'); }}>Delete</button>
        {c.status !== 'REJECTED' && <button className="btn danger" onClick={() => { const reason = prompt('Reason for rejection (kept on record)'); if (reason !== null) act(() => api(`/candidates/${c.id}/status`, { body: { status: 'REJECTED', reason } }), 'Candidate rejected'); }}>Reject</button>}
      </>}>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="spread"><StagePill stage={c.stage} status={c.status} />{c.match && <span className="row small">Fit <Score v={c.match.score} /></span>}</div>
        <div className="mini">{STAGES.map((s, i) => <span key={s} className={i <= si ? 'on' : ''} title={`${human(s)}${s === c.stage ? ' (current)' : ' — click to move here'}`} onClick={() => moveTo(s)} style={{ cursor: s === c.stage ? 'default' : 'pointer', height: 8 }} />)}</div>
        <div className="small muted" style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', gap: 3, marginTop: 4 }}>{STAGES.map((s) => <span key={s} style={{ fontWeight: s === c.stage ? 700 : 400, color: s === c.stage ? 'var(--ink)' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: s === c.stage ? 'default' : 'pointer' }} onClick={() => moveTo(s)}>{human(s)}</span>)}</div>
      </div>
      <div className="tabs" role="tablist">{[['overview', 'Overview'], ['comms', 'Communication'], ['interviews', 'Interviews'], ['post', 'Offer to billing'], ['timeline', 'Timeline']].map(([k, l]) =>
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>

      <RequirementPicker c={c} onDone={reload} />
      {tab === 'overview' && <div className="cols">
        <section className="panel c7"><h2>Fit for {c.requirement?.position ?? '—'}</h2>
          {c.match ? <>
            <Skills matched={c.match.matched} missing={c.match.missing} />
            <div style={{ marginTop: 10 }}>{Object.entries(c.match.factors).map(([k, v]: any) => <div className="factor" key={k}><span>{human(k)}</span><span className="bar"><b style={{ width: `${v * 100}%` }} /></span><b>{Math.round(v * 100)}</b></div>)}</div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn o sm" disabled={busy} onClick={() => act(() => api(`/candidates/${c.id}/ai/screen`, { body: {} }))}>AI screening summary</button>
              <select value={round} onChange={(e) => setRound(e.target.value)} aria-label="Round">{ROUNDS.map((r) => <option key={r}>{r}</option>)}</select>
              <button className="btn o sm" disabled={busy} onClick={() => act(() => api(`/candidates/${c.id}/ai/questions`, { body: { round } }))}>Generate interview questions</button>
            </div>
            {c.aiScreening && <div className="ai"><span className="tag">AI screening{c.aiScreening._ai ? ` · ${c.aiScreening._ai.label} (${c.aiScreening._ai.model})` : ''}</span> · suggests <b>{c.aiScreening.decision}</b><p style={{ margin: '6px 0' }}>{c.aiScreening.summary}</p>
              <div className="small"><b>Strengths:</b> {c.aiScreening.strengths?.join('; ')}<br /><b>Probe:</b> {c.aiScreening.gaps?.join('; ')}</div><p className="small muted" style={{ margin: '6px 0 0' }}>Advisory only. The recruiter decides.</p></div>}
            {c.aiQuestions && <div className="ai"><span className="tag">Interview questions · {c.aiQuestions.round}{c.aiQuestions._ai ? ` · ${c.aiQuestions._ai.label}` : ''}</span><ol style={{ margin: '6px 0', paddingLeft: 20 }}>{c.aiQuestions.questions?.map((q: any, i: number) => <li key={i} style={{ margin: '6px 0' }}>{q.q}<div className="sub">{q.skill} · {q.level} · Look for: {q.lookFor}</div></li>)}</ol></div>}
          </> : <Empty>Link this candidate to a requirement to see the fit.</Empty>}
        </section>
        <section className="panel c5"><h2>Profile</h2><div className="kv" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {[['Email', c.email], ['Phone', c.phone], ['Location', c.location], ['Experience', `${c.expYears} years`], ['Current CTC', c.currentCtc && `${c.currentCtc} LPA`], ['Expected CTC', c.expectedCtc && `${c.expectedCtc} LPA`],
            ['Notice', c.noticeDays == null ? null : c.noticeDays ? `${c.noticeDays} days` : 'Immediate'], ['Education', c.education], ['Requirement', c.requirement?.code], ['Sources', c.sources.map((s: any) => s.sourceName).join(', ')]].map(([k, v]) =>
            <div key={k}><span>{k}</span><b>{v || '—'}</b></div>)}</div>
          <h3 style={{ marginTop: 14 }}>All skills</h3>{c.skills.map((s: string) => <span key={s} className="chip">{s}</span>)}
        </section>
      </div>}

      {tab === 'comms' && <div className="cols">
        <section className="panel c6"><h2>Log an interaction</h2><div className="fgrid">
          <label className="f">Channel<select value={comm.channel} onChange={(e) => setComm({ ...comm, channel: e.target.value })}>{['CALL', 'EMAIL', 'WHATSAPP', 'NOTE'].map((x) => <option key={x} value={x}>{human(x)}</option>)}</select></label>
          <label className="f">Outcome<select value={comm.outcome} onChange={(e) => setComm({ ...comm, outcome: e.target.value })}>{['Connected', 'No answer', 'Busy', 'Call back', 'Not interested', 'Wrong number', 'Sent', 'Replied'].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="f full">Notes<textarea rows={3} value={comm.notes} onChange={(e) => setComm({ ...comm, notes: e.target.value })} /></label>
          <label className="f">Next action<input value={comm.nextAction} onChange={(e) => setComm({ ...comm, nextAction: e.target.value })} placeholder="Schedule L1" /></label>
          <label className="f">Follow up on<input type="date" value={comm.followUpAt} onChange={(e) => setComm({ ...comm, followUpAt: e.target.value })} /></label></div>
          <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
            <button className="btn o sm" disabled={busy} onClick={async () => { const r = await run(() => api(`/candidates/${c.id}/ai/outreach`, { body: { channel: comm.channel === 'WHATSAPP' ? 'WHATSAPP' : 'EMAIL' } })); if (r) setDraft(r.text); }}>Draft outreach with AI</button>
            <button className="btn g sm" disabled={busy} onClick={() => act(() => api(`/candidates/${c.id}/communications`, { body: { ...comm, followUpAt: comm.followUpAt || undefined } }), 'Interaction logged')}>Log interaction</button></div>
          {draft && <div className="ai"><span className="tag">AI draft — edit before sending</span><textarea rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ marginTop: 6 }} /><button className="btn o sm" style={{ marginTop: 6 }} onClick={() => navigator.clipboard.writeText(draft)}>Copy</button></div>}
        </section>
        <section className="panel c6"><h2>History</h2>{c.communications.length ? <ul className="tl">{c.communications.map((m: any) => <li key={m.id}><b>{human(m.channel)}</b> · {m.outcome}{m.notes && <div>{m.notes}</div>}<div className="d">{fmtDT(m.createdAt)}{m.nextAction && ` · Next: ${m.nextAction}${m.followUpAt ? ` by ${fmtDate(m.followUpAt)}` : ''}`}</div></li>)}</ul> : <Empty>No interactions logged yet.</Empty>}</section>
      </div>}

      {tab === 'interviews' && <section className="panel"><div className="spread" style={{ marginBottom: 10 }}><h2 style={{ margin: 0 }}>Interview rounds</h2><button className="btn g sm" onClick={() => setModal({ kind: 'schedule' })}>Schedule interview</button></div>
        {c.interviews.length ? <ul className="tl">{c.interviews.map((iv: any) => <li key={iv.id}><b>{iv.round}</b> · {human(iv.status)} · {PROVIDER_LABEL[iv.provider]}
          <div className="d">{fmtDT(iv.startAt)} · {iv.panel.map((p: any) => p.interviewer.name).join(', ')}{iv.joinUrl && ['SCHEDULED', 'CONFIRMED'].includes(iv.status) && <> · <a href={iv.joinUrl} target="_blank" rel="noreferrer">Join</a></>}</div>
          {iv.panel.filter((p: any) => p.submittedAt).map((p: any) => <div key={p.id} className="small" style={{ marginTop: 4 }}><b>{p.interviewer.name}: {p.recommendation}</b> — {p.feedback}</div>)}
          {iv.status !== 'CANCELLED' && new Date(iv.startAt) < new Date() && <button className="btn o sm" style={{ marginTop: 4 }} onClick={() => setModal({ kind: 'fb', iv: { ...iv, candidate: c } })}>Add feedback</button>}
        </li>)}</ul> : <Empty>No interviews yet.</Empty>}</section>}

      {tab === 'post' && <section className="panel"><div className="kv">
        <div><span>Offer</span><b>{c.offer ? `${human(c.offer.status)} · ${c.offer.finalCtc ?? '—'} LPA` : '—'}</b></div><div><span>Offer documents</span><b>{human(c.offer?.documents)}</b></div><div><span>Expected joining</span><b>{fmtDate(c.offer?.expectedJoining ?? c.joining?.expectedDate)}</b></div>
        <div><span>BGV</span><b>{c.bgv ? `${human(c.bgv.status)}${c.bgv.result ? ` · ${c.bgv.result}` : ''}` : '—'}</b></div><div><span>BGV case</span><b>{c.bgv?.caseId ?? '—'} {c.bgv?.provider && `· ${c.bgv.provider}`}</b></div><div><span>Joined</span><b>{fmtDate(c.joining?.actualDate)}</b></div>
        <div><span>Employee ID</span><b>{c.joining?.employeeId ?? '—'}</b></div><div><span>Billing</span><b>{c.billing ? `${human(c.billing.status)} · ${c.billing.rate ?? '—'} LPA` : '—'}</b></div><div><span>Invoice</span><b>{c.billing?.invoiceRef ?? '—'}</b></div>
      </div><p className="small muted">Update these on <Link to="/offer-to-billing">Offer to billing</Link>.</p></section>}

      {tab === 'timeline' && <section className="panel"><h2>Activity timeline</h2><ul className="tl">{c.activities.map((a: any) => <li key={a.id}>{a.message}<div className="d">{fmtDT(a.createdAt)}</div></li>)}</ul></section>}

      {modal?.kind === 'email' && <EmailComposer candidates={[{ id: c.id, name: c.name, email: c.email }]} onClose={() => setModal(null)} onSent={reload} />}
      {modal?.kind === 'schedule' && <ScheduleInterview candidateId={c.id} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === 'fb' && <FeedbackModal iv={modal.iv} onClose={() => setModal(null)} onDone={reload} />}
    </Page>
  );
}

/** Assign or move this candidate to a requirement. */
function RequirementPicker({ c, onDone }: { c: any; onDone: () => void }) {
  const { data: reqs } = useApi<any[]>('/requirements');
  const [rid, setRid] = useState(c.requirementId ?? '');
  const [reset, setReset] = useState(false);
  const { run, busy } = useAction();
  const changed = rid !== (c.requirementId ?? '');
  return <section className="panel" style={{ marginBottom: 16 }}>
    <div className="row">
      <b>Requirement</b>
      <select value={rid} onChange={(e) => setRid(e.target.value)} aria-label="Requirement" style={{ minWidth: 280 }}>
        <option value="">Not assigned</option>
        {reqs?.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.client} – {r.position}{r.status !== 'OPEN' ? ` (${r.status.toLowerCase()})` : ''}</option>)}
      </select>
      {changed && <>
        {c.requirementId && rid && <label className="row small"><input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} /> Restart at Screening</label>}
        <button className="btn g sm" disabled={busy} onClick={async () => { if (await run(() => api(`/candidates/${c.id}/requirement`, { body: { requirementId: rid || null, resetStage: reset } }), rid ? 'Requirement updated' : 'Requirement removed')) onDone(); }}>Save</button>
        <button className="btn o sm" onClick={() => { setRid(c.requirementId ?? ''); setReset(false); }}>Cancel</button>
      </>}
    </div>
    {changed && c.aiScreening && <p className="small muted" style={{ margin: '6px 0 0' }}>The earlier AI screening was for the old requirement and will be cleared; run it again afterwards.</p>}
  </section>;
}
