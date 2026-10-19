import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDT, human, PROVIDER_LABEL } from '../api';
import { Empty, Page, useAction, useApi } from '../ui';
import ScheduleInterview from '../components/ScheduleInterview';
import { CancelModal, FeedbackModal, RescheduleModal } from '../components/InterviewActions';
import MeetingLinkModal from '../components/MeetingLinkModal';

export default function Interviews() {
  const [view, setView] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [who, setWho] = useState('');
  const now = new Date().toISOString();
  const q = new URLSearchParams({ ...(view === 'upcoming' ? { from: now } : view === 'past' ? { to: now } : {}), ...(who ? { interviewerId: who } : {}) }).toString();
  const { data, reload } = useApi<any[]>(`/interviews?${q}`);
  const { data: ivs } = useApi<any[]>('/interviewers');
  const [modal, setModal] = useState<{ kind: string; iv?: any } | null>(null);
  const { run } = useAction();
  const rows = view === 'upcoming' ? [...(data ?? [])].reverse() : data ?? [];

  return (
    <Page title="Interviews" sub="Step 5 · Schedule on Teams, Zoom, Google Meet, Webex or Jitsi, and collect scorecards" actions={<button className="btn g" onClick={() => setModal({ kind: 'new' })}>Schedule interview</button>}>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="tabs" style={{ marginBottom: 0, border: 0 }}>{(['upcoming', 'past', 'all'] as const).map((v) => <button key={v} aria-selected={view === v} onClick={() => setView(v)}>{human(v)}</button>)}</div>
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Interviewer"><option value="">All interviewers</option>{ivs?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
      </div>
      <section className="panel"><div className="tw"><table><thead><tr><th>When</th><th>Candidate</th><th>Round</th><th>Panel</th><th>Platform</th><th>Status</th><th>Scorecards</th><th /></tr></thead><tbody>
        {rows.length ? rows.map((iv) => {
          const done = iv.panel.filter((p: any) => p.submittedAt).length;
          const live = ['SCHEDULED', 'CONFIRMED'].includes(iv.status);
          return <tr key={iv.id}>
            <td><b>{fmtDT(iv.startAt)}</b><div className="sub">{Math.round((+new Date(iv.endAt) - +new Date(iv.startAt)) / 60000)} min</div></td>
            <td><Link className="nm" to={`/candidates/${iv.candidate.id}`}>{iv.candidate.name}</Link><div className="sub">{iv.requirement.code} · {iv.requirement.position}</div></td>
            <td>{iv.round}</td><td className="small">{iv.panel.map((p: any) => p.interviewer.name).join(', ')}</td>
            <td>{PROVIDER_LABEL[iv.provider]}{iv.joinUrl && live && <div><a className="small" href={iv.joinUrl} target="_blank" rel="noreferrer">Join</a></div>}{iv.location && <div className="sub">{iv.location}</div>}</td>
            <td>{live ? <select value={iv.status} aria-label="Status" onChange={async (e) => { if (await run(() => api(`/interviews/${iv.id}/status`, { body: { status: e.target.value } }))) reload(); }}>{['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'].map((s) => <option key={s} value={s}>{human(s)}</option>)}</select> : <span className={`pill ${iv.status === 'COMPLETED' ? 'g' : iv.status === 'CANCELLED' ? 'r' : 'a'}`}>{human(iv.status)}</span>}</td>
            <td>{done}/{iv.panel.length}{iv.panel.filter((p: any) => p.recommendation).map((p: any) => <div key={p.id} className="sub">{p.interviewer.name.split(' ')[0]}: {p.recommendation}</div>)}</td>
            <td><div className="row" style={{ flexWrap: 'nowrap' }}>
              {iv.status !== 'CANCELLED' && new Date(iv.startAt) < new Date() && <button className="btn o sm" onClick={() => setModal({ kind: 'fb', iv })}>Feedback</button>}
              {live && ['TEAMS_MANUAL', 'LINK'].includes(iv.provider) && <button className="btn o sm" onClick={() => setModal({ kind: 'link', iv })}>{iv.provider === 'TEAMS_MANUAL' ? 'Teams invite' : 'Link'}</button>}
              {live && <button className="btn o sm" onClick={() => setModal({ kind: 'rs', iv })}>Reschedule</button>}
              {live && <button className="btn danger sm" onClick={() => setModal({ kind: 'cx', iv })}>Cancel</button>}
            </div></td>
          </tr>;
        }) : <tr><td colSpan={8}><Empty>No interviews here. Schedule one to get started.</Empty></td></tr>}
      </tbody></table></div></section>
      {modal?.kind === 'new' && <ScheduleInterview onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === 'link' && <MeetingLinkModal iv={modal.iv} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === 'rs' && <RescheduleModal iv={modal.iv} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === 'cx' && <CancelModal iv={modal.iv} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === 'fb' && <FeedbackModal iv={modal.iv} onClose={() => setModal(null)} onDone={reload} />}
    </Page>
  );
}
