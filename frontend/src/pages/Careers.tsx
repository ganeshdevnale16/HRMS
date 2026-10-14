import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, human } from '../api';

/** Public pages: no login. Share /careers or /apply/<code> anywhere (LinkedIn post, WhatsApp, website, job ads). */
const Shell = ({ children }: { children: React.ReactNode }) => (
  <div style={{ minHeight: '100%', background: 'var(--bg)' }}>
    <header style={{ background: 'var(--side)', color: '#fff', padding: '18px 24px' }}><div className="wm" style={{ fontSize: 20, fontWeight: 800, display: 'flex', gap: 9, alignItems: 'center' }}><i style={{ width: 11, height: 11, background: 'var(--green)', display: 'inline-block' }} />Careers</div></header>
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '24px 16px 60px', overflow: 'visible', height: 'auto' }}>{children}</main>
  </div>
);

export function Careers() {
  const [jobs, setJobs] = useState<any[] | null>(null);
  useEffect(() => { api('/public/jobs').then(setJobs).catch(() => setJobs([])); }, []);
  return <Shell>
    <h1 style={{ margin: '0 0 16px' }}>Open positions</h1>
    {jobs === null ? <p className="muted">Loading…</p> : jobs.length === 0 ? <p className="muted">There are no open positions right now.</p> :
      <div className="stack">{jobs.map((j) => <Link key={j.code} to={`/apply/${j.code}`} className="panel" style={{ display: 'block', textDecoration: 'none' }}>
        <div className="spread"><b style={{ fontSize: 16 }}>{j.position}</b><span className="btn g sm">Apply</span></div>
        <div className="muted small">{j.location} · {human(j.workMode)} · {j.expMin}–{j.expMax} years</div>
        <div style={{ marginTop: 6 }}>{j.skills.map((s: string) => <span key={s} className="chip">{s}</span>)}</div>
      </Link>)}</div>}
  </Shell>;
}

export function Apply() {
  const { code } = useParams();
  const [job, setJob] = useState<any>(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState<any>({ name: '', email: '', phone: '', location: '', expYears: '', currentCtc: '', expectedCtc: '', noticeDays: '', website: '', consent: false });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { api(`/public/jobs/${code}`).then(setJob).catch((e) => setErr(e.message)); }, [code]);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (!file) return setErr('Attach your resume (PDF or DOCX).');
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, String(v)));
    fd.append('resume', file);
    setBusy(true);
    try { await api(`/public/jobs/${code}/apply`, { form: fd }); setDone(true); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  if (done) return <Shell><div className="panel"><h1 style={{ marginTop: 0 }}>Application received</h1><p>Thank you for applying for <b>{job?.position}</b>. Our recruitment team will review your profile and contact you if it is a match.</p><Link to="/careers">See other openings</Link></div></Shell>;
  if (!job) return <Shell>{err ? <div className="error">{err}</div> : <p className="muted">Loading…</p>}</Shell>;
  return <Shell>
    <Link to="/careers" className="small">← All openings</Link>
    <h1 style={{ margin: '8px 0 4px' }}>{job.position}</h1>
    <p className="muted" style={{ marginTop: 0 }}>{job.location} · {human(job.workMode)} · {job.expMin}–{job.expMax} years · {job.openings} opening{job.openings > 1 ? 's' : ''}</p>
    <div>{job.skills.map((s: string) => <span key={s} className="chip">{s}</span>)}</div>
    {job.description && <div className="panel" style={{ marginTop: 14, whiteSpace: 'pre-wrap' }}>{job.description}</div>}
    <form className="panel" style={{ marginTop: 16 }} onSubmit={submit}>
      <h2>Apply</h2>
      <div className="fgrid">
        <label className="f">Full name *<input required value={f.name} onChange={set('name')} autoComplete="name" /></label>
        <label className="f">Email *<input required type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
        <label className="f">Mobile *<input required value={f.phone} onChange={set('phone')} autoComplete="tel" /></label>
        <label className="f">Current city<input value={f.location} onChange={set('location')} /></label>
        <label className="f">Total experience (years)<input type="number" step="0.5" min="0" value={f.expYears} onChange={set('expYears')} /></label>
        <label className="f">Notice period (days)<input type="number" min="0" value={f.noticeDays} onChange={set('noticeDays')} /></label>
        <label className="f">Current CTC (LPA)<input type="number" step="0.1" min="0" value={f.currentCtc} onChange={set('currentCtc')} /></label>
        <label className="f">Expected CTC (LPA)<input type="number" step="0.1" min="0" value={f.expectedCtc} onChange={set('expectedCtc')} /></label>
        <label className="f full">Resume * (PDF or DOCX, max 5 MB)<input required type="file" accept=".pdf,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <input type="text" name="website" value={f.website} onChange={set('website')} tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: -9999 }} aria-hidden="true" />
        <label className="row small full" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={f.consent} onChange={set('consent')} required style={{ marginTop: 3 }} />
          <span>I agree that my details and resume will be stored and processed to assess my application for this and similar roles, including automated analysis that a recruiter reviews. I can ask for my data to be deleted at any time.</span></label>
      </div>
      {err && <div className="error">{err}</div>}
      <button className="btn g" disabled={busy} style={{ marginTop: 12 }}>{busy ? 'Submitting…' : 'Submit application'}</button>
    </form>
  </Shell>;
}
