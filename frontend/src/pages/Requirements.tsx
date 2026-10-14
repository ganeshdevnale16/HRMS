import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtDate, human } from '../api';
import { Empty, Modal, Page, useAction, useApi } from '../ui';

const blank = { client: '', position: '', openings: 1, expMin: 3, expMax: 6, skills: '', location: '', workMode: 'HYBRID', ctcMin: 8, ctcMax: 18, noticeMax: 60, priority: 'MEDIUM', targetDate: '', description: '' };

export default function Requirements() {
  const { data, reload } = useApi<any[]>('/requirements');
  const [form, setForm] = useState<any>(null);
  const { run, busy } = useAction();
  const nav = useNavigate();
  const set = (k: string) => (e: any) => setForm({ ...form, [k]: e.target.value });

  async function extract() {
    const r = await run(() => api('/requirements/ai/extract', { body: { jd: form.description } }), 'Filled from the JD. Review before saving.');
    if (r) setForm({ ...form, ...r, skills: r.skills.join(', ') });
  }
  async function save() {
    const body = { ...form, skills: String(form.skills).split(/[,;]/).map((s: string) => s.trim()).filter(Boolean), targetDate: form.targetDate || null };
    const r = await run(() => api(form.id ? `/requirements/${form.id}` : '/requirements', { method: form.id ? 'PATCH' : 'POST', body }), form.id ? 'Requirement saved' : 'Requirement created');
    if (r) { setForm(null); reload(); }
  }

  return (
    <Page title="Requirements" sub="Step 1 · Client hiring needs. Click a requirement to see its candidates." actions={<button className="btn g" onClick={() => setForm({ ...blank })}>+ New requirement</button>}>
      <section className="panel" style={{ padding: 0 }}><div className="tw"><table><thead><tr><th>Code</th><th>Position &amp; client</th><th style={{ textAlign: 'right' }}>Openings</th><th>Experience</th><th>Key skills</th><th>Location</th><th>CTC (LPA)</th><th>Priority</th><th>Recruiter</th><th>Target date</th><th style={{ textAlign: 'right' }}>Candidates</th><th>Status</th><th /></tr></thead><tbody>
        {data?.length ? data.map((r) => (
          <tr key={r.id} className="click" onClick={() => nav(`/candidates?requirementId=${r.id}`)}>
            <td className="nowrap"><code>{r.code}</code></td>
            <td><div className="nm">{r.position}</div><div className="sub">{r.client}</div></td>
            <td style={{ textAlign: 'right' }}>{r.openings}</td>
            <td className="nowrap">{r.expMin}–{r.expMax} yrs</td>
            <td style={{ maxWidth: 260 }}>{r.skills.slice(0, 4).map((s: string) => <span key={s} className="chip">{s}</span>)}{r.skills.length > 4 && <span className="chip">+{r.skills.length - 4}</span>}</td>
            <td className="nowrap">{r.location}<div className="sub">{human(r.workMode)}</div></td>
            <td className="nowrap">{r.ctcMin}–{r.ctcMax}</td>
            <td><span className={`pill ${r.priority === 'HIGH' ? 'r' : r.priority === 'MEDIUM' ? 'a' : ''}`}>{human(r.priority)}</span></td>
            <td className="nowrap">{r.recruiter?.name ?? '—'}</td>
            <td className="nowrap">{r.targetDate ? fmtDate(r.targetDate) : <span className="muted">Not set</span>}</td>
            <td style={{ textAlign: 'right' }}><b>{r._count.candidates}</b></td>
            <td><span className={`pill ${r.status === 'OPEN' ? 'g' : r.status === 'ON_HOLD' ? 'a' : ''}`}>{human(r.status)}</span></td>
            <td><button className="btn o sm" onClick={(e) => { e.stopPropagation(); setForm({ ...r, skills: r.skills.join(', '), targetDate: r.targetDate?.slice(0, 10) ?? '' }); }}>Edit</button></td>
          </tr>)) : <tr><td colSpan={13}><Empty>No requirements yet. Create one to start sourcing.</Empty></td></tr>}
      </tbody></table></div></section>
      {form && <Modal title={form.id ? `Edit ${form.code}` : 'New requirement'} onClose={() => setForm(null)} footer={<>
        <button className="btn o" onClick={extract} disabled={busy || !form.description}>Extract from JD with AI</button>
        <button className="btn o" onClick={() => setForm(null)}>Cancel</button><button className="btn g" onClick={save} disabled={busy}>{form.id ? 'Save requirement' : 'Create requirement'}</button></>}>
        <div className="fgrid">
          <label className="f">Client<input value={form.client} onChange={set('client')} /></label>
          <label className="f">Position<input value={form.position} onChange={set('position')} /></label>
          <label className="f">Openings<input type="number" min={1} value={form.openings} onChange={set('openings')} /></label>
          <label className="f">Priority<select value={form.priority} onChange={set('priority')}><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select></label>
          <label className="f">Experience from (yrs)<input type="number" value={form.expMin} onChange={set('expMin')} /></label>
          <label className="f">Experience to (yrs)<input type="number" value={form.expMax} onChange={set('expMax')} /></label>
          <label className="f full">Required skills (comma separated)<input value={form.skills} onChange={set('skills')} /></label>
          <label className="f">Location<input value={form.location} onChange={set('location')} /></label>
          <label className="f">Work mode<select value={form.workMode} onChange={set('workMode')}><option value="HYBRID">Hybrid</option><option value="ONSITE">Onsite</option><option value="REMOTE">Remote</option></select></label>
          <label className="f">CTC from (LPA)<input type="number" value={form.ctcMin} onChange={set('ctcMin')} /></label>
          <label className="f">CTC to (LPA)<input type="number" value={form.ctcMax} onChange={set('ctcMax')} /></label>
          <label className="f">Max notice (days)<input type="number" value={form.noticeMax} onChange={set('noticeMax')} /></label>
          <label className="f">Target joining date<input type="date" value={form.targetDate} onChange={set('targetDate')} /></label>
          {form.id && <label className="f">Status<select value={form.status} onChange={set('status')}><option value="OPEN">Open</option><option value="ON_HOLD">On hold</option><option value="CLOSED">Closed</option></select></label>}
          <label className="f full">Job description<textarea rows={5} value={form.description ?? ''} onChange={set('description')} placeholder="Paste the client JD. AI can fill the fields above from it." /></label>
        </div>
      </Modal>}
    </Page>
  );
}
