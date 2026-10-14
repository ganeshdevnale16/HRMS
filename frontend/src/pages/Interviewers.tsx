import { useState } from 'react';
import { api, human, PROVIDER_LABEL, ROUNDS } from '../api';
import { Empty, Modal, Page, useAction, useApi } from '../ui';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const blank = { name: '', email: '', title: '', department: '', skills: '', rounds: ['L1 Technical'], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, workStart: '10:00', workEnd: '19:00', workDays: [1, 2, 3, 4, 5], maxPerDay: 4, maxPerWeek: 12, bufferMins: 15, calendarProvider: 'OUTLOOK', meetingProvider: 'TEAMS', active: true };

export default function Interviewers() {
  const { data, reload } = useApi<any[]>('/interviewers');
  const { data: integ } = useApi('/integrations');
  const [f, setF] = useState<any>(null);
  const { run, busy } = useAction();
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const toggle = (k: string, v: any) => set(k, f[k].includes(v) ? f[k].filter((x: any) => x !== v) : [...f[k], v]);

  async function save() {
    const body = { ...f, skills: String(f.skills).split(',').map((s: string) => s.trim()).filter(Boolean), maxPerDay: Number(f.maxPerDay), maxPerWeek: Number(f.maxPerWeek), bufferMins: Number(f.bufferMins) };
    delete body.id; delete body.thisWeek; delete body.feedbackPending; delete body.createdAt; delete body.userId;
    if (await run(() => api(f.id ? `/interviewers/${f.id}` : '/interviewers', { method: f.id ? 'PATCH' : 'POST', body }), f.id ? 'Interviewer saved' : 'Interviewer added')) { setF(null); reload(); }
  }

  return (
    <Page title="Interviewers" sub="Who interviews, for what, and when they are available" actions={<button className="btn g" onClick={() => setF({ ...blank })}>Add interviewer</button>}>
      <section className="panel"><div className="tw"><table><thead><tr><th>Interviewer</th><th>Skills</th><th>Rounds</th><th>Availability</th><th>This week</th><th>Feedback due</th><th>Calendar</th><th>Default platform</th><th>Status</th><th /></tr></thead><tbody>
        {data?.length ? data.map((i) => <tr key={i.id} style={{ opacity: i.active ? 1 : 0.55 }}>
          <td><div className="nm">{i.name}</div><div className="sub">{[i.title, i.department].filter(Boolean).join(' · ')}<br />{i.email}</div></td>
          <td>{i.skills.map((s: string) => <span key={s} className="chip">{s}</span>)}</td>
          <td className="small">{i.rounds.join(', ') || 'Any'}</td>
          <td className="small">{i.workDays.map((d: number) => DAYS[d - 1]).join(' ')}<br />{i.workStart}–{i.workEnd} · max {i.maxPerDay}/day<div className="sub">{i.timezone}</div></td>
          <td>{i.thisWeek} / {i.maxPerWeek}</td>
          <td>{i.feedbackPending ? <span className="pill a">{i.feedbackPending}</span> : '0'}</td>
          <td className="small">{i.calendarProvider === 'NONE' ? 'Not linked' : human(i.calendarProvider)}</td>
          <td className="small">{PROVIDER_LABEL[i.meetingProvider]}</td>
          <td>{i.active ? <span className="pill g">Active</span> : <span className="pill">Inactive</span>}</td>
          <td><div className="row" style={{ flexWrap: 'nowrap' }}><button className="btn o sm" onClick={() => setF({ ...i, skills: i.skills.join(', ') })}>Edit</button>
            {i.active && <button className="btn danger sm" onClick={async () => { if (confirm(`Deactivate ${i.name}? Past interviews stay on record.`) && await run(() => api(`/interviewers/${i.id}`, { method: 'DELETE' }), 'Interviewer deactivated')) reload(); }}>Deactivate</button>}</div></td>
        </tr>) : <tr><td colSpan={10}><Empty>No interviewers yet. Add the people who run your interview rounds.</Empty></td></tr>}
      </tbody></table></div></section>

      {f && <Modal wide title={f.id ? `Edit ${f.name}` : 'Add interviewer'} onClose={() => setF(null)} footer={<><button className="btn o" onClick={() => setF(null)}>Cancel</button><button className="btn g" disabled={busy} onClick={save}>{f.id ? 'Save interviewer' : 'Add interviewer'}</button></>}>
        <div className="fgrid">
          <label className="f">Full name<input value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="f">Work email (used for invites and calendar)<input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></label>
          <label className="f">Title<input value={f.title ?? ''} onChange={(e) => set('title', e.target.value)} /></label>
          <label className="f">Department<input value={f.department ?? ''} onChange={(e) => set('department', e.target.value)} /></label>
          <label className="f full">Skills they can assess (comma separated)<input value={f.skills} onChange={(e) => set('skills', e.target.value)} placeholder="Java, Spring Boot, SQL" /></label>
          <fieldset className="full" style={{ border: 0, padding: 0 }}><legend className="small" style={{ fontWeight: 600, color: 'var(--ink2)' }}>Rounds they take</legend>
            <div className="row">{ROUNDS.map((r) => <label key={r} className="row small"><input type="checkbox" checked={f.rounds.includes(r)} onChange={() => toggle('rounds', r)} />{r}</label>)}</div></fieldset>
          <fieldset className="full" style={{ border: 0, padding: 0 }}><legend className="small" style={{ fontWeight: 600, color: 'var(--ink2)' }}>Working days</legend>
            <div className="row">{DAYS.map((d, ix) => <label key={d} className="row small"><input type="checkbox" checked={f.workDays.includes(ix + 1)} onChange={() => toggle('workDays', ix + 1)} />{d}</label>)}</div></fieldset>
          <label className="f">Interviews from<input type="time" value={f.workStart} onChange={(e) => set('workStart', e.target.value)} /></label>
          <label className="f">Interviews until<input type="time" value={f.workEnd} onChange={(e) => set('workEnd', e.target.value)} /></label>
          <label className="f">Time zone<input value={f.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="Asia/Kolkata" /></label>
          <label className="f">Buffer between interviews (min)<input type="number" min={0} value={f.bufferMins} onChange={(e) => set('bufferMins', e.target.value)} /></label>
          <label className="f">Max interviews per day<input type="number" min={1} value={f.maxPerDay} onChange={(e) => set('maxPerDay', e.target.value)} /></label>
          <label className="f">Max interviews per week<input type="number" min={1} value={f.maxPerWeek} onChange={(e) => set('maxPerWeek', e.target.value)} /></label>
          <label className="f">Check availability in<select value={f.calendarProvider} onChange={(e) => set('calendarProvider', e.target.value)}>
            <option value="OUTLOOK">Outlook / Microsoft 365{integ && !integ.calendar[0].configured ? ' (not connected)' : ''}</option>
            <option value="GOOGLE">Google calendar{integ && !integ.calendar[1].configured ? ' (not connected)' : ''}</option>
            <option value="NONE">HRMS bookings only</option></select></label>
          <label className="f">Default meeting platform<select value={f.meetingProvider} onChange={(e) => set('meetingProvider', e.target.value)}>{Object.entries(PROVIDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {f.id && <label className="row small full"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Active — can be picked for new interviews</label>}
        </div>
      </Modal>}
    </Page>
  );
}
