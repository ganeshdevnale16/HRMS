import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, human, STAGES } from '../api';
import { Empty, Modal, Page, Score, Skills, StagePill, useAction, useApi } from '../ui';
import FormatHelp from '../components/FormatHelp';
import EmailComposer from '../components/EmailComposer';

export default function Candidates() {
  const [sp, setSp] = useSearchParams();
  const qs = new URLSearchParams([...sp.entries()].filter(([, v]) => v)).toString();
  const { data, reload, loading } = useApi<any[]>(`/candidates?${qs}`);
  const { data: reqs } = useApi<any[]>('/requirements');
    const { data: aiStatus } = useApi('/settings/ai/status');
  const aiOn = !!aiStatus?.inUse?.screening;
  const [aiPick, setAiPick] = useState('');
  const usedFor = aiPick ? aiStatus?.connected.find((p: any) => p.id === aiPick) : aiStatus?.inUse?.screening;
  const [aiFilter, setAiFilter] = useState('');
  const [screen, setScreen] = useState<{ running: boolean; done: number; total: number; results: any[]; pick: string[] } | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [add, setAdd] = useState<any>(null);
  const [up, setUp] = useState<any>(null);
  const [mailTo, setMailTo] = useState<any[] | null>(null);
  const [upResult, setUpResult] = useState<any>(null);
  const [search, setSearch] = useState(sp.get('search') ?? '');
  const { run, busy } = useAction();
  const nav = useNavigate();
  const sources = useMemo(() => [...new Set((data ?? []).flatMap((c) => c.sources.map((s: any) => s.sourceName)))], [data]);
  const setF = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n); setSel([]); };

  const rows = (data ?? []).filter((c) => !aiFilter || (aiFilter === 'none' ? !c.aiScreening : c.aiScreening?.decision === aiFilter));

  /** Screens the ticked candidates, or (if none ticked) every unscreened candidate at Sourced/Screening in the current view. */
  async function screenWithAI() {
    const ids = sel.length ? sel : rows.filter((c) => !c.aiScreening && c.requirementId && ['SOURCED', 'SCREENING'].includes(c.stage) && c.status !== 'REJECTED').map((c) => c.id);
    if (!ids.length) { alert('Nothing to screen here. Tick candidates, or filter to candidates at Sourced / Screening that are linked to a requirement.'); return; }
    if (ids.length > 100 && !confirm(`Screen ${ids.length} candidates? This uses ${ids.length} AI calls.`)) return;
    const st = { running: true, done: 0, total: ids.length, results: [] as any[], pick: [] as string[] };
    setScreen({ ...st });
    for (let i = 0; i < ids.length; i += 5) {
      try {
        const r = await api('/candidates/ai/screen-bulk', { body: { ids: ids.slice(i, i + 5), provider: aiPick || undefined } });
        st.results.push(...r.results);
        if (r.results.some((x: any) => /not configured|API key|401|403/.test(x.error ?? ''))) { st.done = ids.length; break; }
      } catch (e: any) { st.results.push({ name: 'Batch', error: e.message }); }
      st.done = Math.min(ids.length, i + 5);
      setScreen({ ...st });
    }
    st.pick = st.results.filter((r) => r.decision === 'Shortlist').map((r) => r.id);
    setScreen({ ...st, running: false });
    reload();
  }
  async function applyScreen(action: 'shortlist' | 'reject') {
    const ids = screen!.pick;
    if (!ids.length) return;
    const ok = action === 'shortlist'
      ? await run(() => api('/candidates/bulk-stage', { body: { ids, stage: 'COMMUNICATION', reason: 'Shortlisted after AI-assisted screening' } }), `${ids.length} shortlisted → Communication`)
      : await run(async () => { for (const id of ids) await api(`/candidates/${id}/status`, { body: { status: 'REJECTED', reason: 'Screened out (AI-assisted, reviewed by recruiter)' } }); return true; }, `${ids.length} rejected`);
    if (ok) { setScreen(null); setSel([]); reload(); }
  }

  async function bulk(stage: string) {
    if (await run(() => api('/candidates/bulk-stage', { body: { ids: sel, stage, reason: 'Bulk update' } }), `${sel.length} candidates moved to ${human(stage)}`)) { setSel([]); reload(); }
  }
  async function uploadResumes() {
    const fd = new FormData();
    up.files.forEach((f: File) => fd.append('files', f));
    if (up.requirementId) fd.append('requirementId', up.requirementId);
    const r = await run(() => api('/sources/resumes', { form: fd }));
    if (r) { setUpResult(r); reload(); }
  }
  async function save() {
    const r = await run(() => api('/candidates', { body: add }));
    if (r) { setAdd(null); reload(); }
  }

  return (
    <Page title="Candidates" sub="Step 3 · Screening and communication — one pool from every source, ranked by fit" actions={<><Link className="btn o" to="/sources">Connect sources</Link><button className="btn o" onClick={() => setUp({ requirementId: sp.get('requirementId') ?? '', files: [] })}>Upload resumes</button>{aiStatus?.connected?.length > 1 && <select value={aiPick} onChange={(e) => setAiPick(e.target.value)} aria-label="AI used for screening" title="Which AI screens the candidates"><option value="">AI: {aiStatus.inUse.screening ? `${aiStatus.inUse.screening.label} · ${aiStatus.inUse.screening.model} (default)` : 'default'}</option>{aiStatus.connected.map((p: any) => <option key={p.id} value={p.id}>AI: {p.label} · {p.model}</option>)}</select>}
<button className="btn o" disabled={!aiOn || !!screen?.running} title={aiOn ? '' : 'Set up AI under Integrations first'} onClick={screenWithAI}>{sel.length ? `Screen ${sel.length} with AI` : 'Screen with AI'}</button><button className="btn g" onClick={() => setAdd({ requirementId: sp.get('requirementId') ?? '' })}>Add candidate</button></>}>
      <section className="panel">
        <div className="row" style={{ marginBottom: 14 }}>
          <select value={sp.get('requirementId') ?? ''} onChange={(e) => setF('requirementId', e.target.value)} aria-label="Requirement"><option value="">All requirements</option><option value="none">Not assigned to any requirement</option>{reqs?.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.client} – {r.position}</option>)}</select>
          <select value={sp.get('stage') ?? ''} onChange={(e) => setF('stage', e.target.value)} aria-label="Stage"><option value="">All stages</option>{STAGES.map((s) => <option key={s} value={s}>{human(s)}</option>)}</select>
          <select value={sp.get('status') ?? ''} onChange={(e) => setF('status', e.target.value)} aria-label="Status"><option value="">Any status</option><option value="ACTIVE">Active</option><option value="HOLD">On hold</option><option value="REJECTED">Rejected</option></select>
          <select value={aiFilter} onChange={(e) => setAiFilter(e.target.value)} aria-label="AI screening"><option value="">Any AI result</option><option value="Shortlist">AI: Shortlist</option><option value="Hold">AI: Hold</option><option value="Reject">AI: Reject</option><option value="none">Not screened yet</option></select>
          <select value={sp.get('source') ?? ''} onChange={(e) => setF('source', e.target.value)} aria-label="Source"><option value="">All sources</option>{sources.map((s) => <option key={s}>{s}</option>)}</select>
          <form onSubmit={(e) => { e.preventDefault(); setF('search', search); }}><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, company, skill" style={{ minWidth: 240 }} /></form>
          <span className="small muted">{loading ? 'Loading…' : `${rows.length} candidates`}</span>
        </div>
        {aiStatus && !aiOn && <div className="warn">AI screening is off. Go to <Link to="/integrations"><b>Integrations → AI provider</b></Link>, add an OpenAI, Claude or Gemini key, Test and Save. The fit score still works without AI.</div>}
        {sel.length > 0 && <div className="row warn" style={{ color: 'var(--ink)' }}><b>{sel.length} selected</b><span>Move to</span>{['SCREENING', 'COMMUNICATION'].map((s) => <button key={s} className="btn o sm" disabled={busy} onClick={() => bulk(s)}>{human(s)}</button>)}
          <select value="" disabled={busy} aria-label="Assign to requirement" onChange={async (e) => { const v = e.target.value; if (!v) return; const rid = v === '__none' ? null : v; const name = rid ? reqs?.find((r) => r.id === rid)?.position : 'no requirement'; if (confirm(`Assign ${sel.length} candidate(s) to ${name}?`) && await run(() => api('/candidates/bulk-assign', { body: { ids: sel, requirementId: rid } }), `${sel.length} candidate(s) assigned`)) { setSel([]); reload(); } }}>
            <option value="">Assign to requirement…</option>{reqs?.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.position}</option>)}<option value="__none">Remove requirement</option></select><button className="btn o sm" onClick={() => setMailTo(rows.filter((c) => sel.includes(c.id)))}>Email</button><button className="btn danger sm" disabled={busy} onClick={async () => { if (prompt(`Permanently delete ${sel.length} candidate(s) with their interviews, records and resumes? Type DELETE to confirm.`) === 'DELETE' && await run(() => api('/candidates/bulk-delete', { body: { ids: sel } }), `${sel.length} candidate(s) deleted`)) { setSel([]); reload(); } }}>Delete</button><button className="btn o sm" onClick={() => setSel([])}>Clear</button></div>}
        <div className="tw"><table><thead><tr><th><input type="checkbox" aria-label="Select all" checked={!!rows.length && sel.length === rows.length} onChange={(e) => setSel(e.target.checked ? rows.map((c) => c.id) : [])} /></th><th>Candidate</th><th>Fit</th><th>Skills vs requirement</th><th>Exp</th><th>Location</th><th>Notice</th><th>Exp. CTC</th><th>Source</th><th>AI screening</th><th>Stage</th></tr></thead><tbody>
          {rows.length ? rows.map((c) => (
            <tr key={c.id} className="click" onClick={() => nav(`/candidates/${c.id}`)}>
              <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${c.name}`} checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} /></td>
              <td><div className="nm">{c.name}</div><div className="sub">{[c.title, c.company].filter(Boolean).join(' · ') || c.email}</div></td>
              <td>{c.match ? <Score v={c.match.score} /> : <span className="muted small">No requirement</span>}</td>
              <td>{c.match ? <Skills matched={c.match.matched} missing={c.match.missing} /> : <Skills extra={c.skills.slice(0, 5)} />}</td>
              <td>{c.expYears} yrs</td><td>{c.location ?? '—'}</td><td>{c.noticeDays == null ? '—' : c.noticeDays ? `${c.noticeDays} d` : 'Immediate'}</td><td>{c.expectedCtc ? `${c.expectedCtc} L` : '—'}</td>
              <td>{c.sources.map((s: any) => s.sourceName).join(', ')}{c.sources.length > 1 && <div className="sub">Merged duplicate</div>}</td>
              <td>{c.aiScreening ? <span className={`pill ${c.aiScreening.decision === 'Shortlist' ? 'g' : c.aiScreening.decision === 'Reject' ? 'r' : 'a'}`} title={`${c.aiScreening.summary ?? ''}${c.aiScreening._ai ? `\n— ${c.aiScreening._ai.label} · ${c.aiScreening._ai.model}` : ''}`}>{c.aiScreening.decision}</span> : <span className="small muted">—</span>}</td>
              <td><StagePill stage={c.stage} status={c.status} /></td>
            </tr>)) : <tr><td colSpan={11}><Empty>No candidates match these filters. Clear a filter or import from a data source.</Empty></td></tr>}
        </tbody></table></div>
      </section>
      <p className="small muted">Fit = skills 50% · experience 20% · location 12% · notice 10% · CTC 8%. Green skills match; dashed skills are missing.</p>
      {screen && <Modal wide title={`${screen.running ? `Screening… ${screen.done} of ${screen.total}` : 'AI screening results'}${usedFor ? ` · ${usedFor.label} (${usedFor.model})` : ''}`} onClose={() => !screen.running && setScreen(null)}
        footer={screen.running ? <span className="muted">Please wait…</span> : <>
          <span className="small muted" style={{ marginRight: 'auto' }}>{screen.pick.length} ticked. You decide — nothing has moved yet.</span>
          <button className="btn o" onClick={() => setScreen(null)}>Close</button>
          <button className="btn danger" disabled={busy || !screen.pick.length} onClick={() => applyScreen('reject')}>Reject ticked</button>
          <button className="btn g" disabled={busy || !screen.pick.length} onClick={() => applyScreen('shortlist')}>Shortlist ticked → Communication</button></>}>
        <div className="tw"><table><thead><tr><th /><th>Candidate</th><th>Fit</th><th>AI suggests</th><th>Why</th></tr></thead><tbody>
          {screen.results.map((r, i) => <tr key={r.id ?? i}>
            <td>{r.id && !r.error && <input type="checkbox" aria-label={`Select ${r.name}`} checked={screen.pick.includes(r.id)} onChange={(e) => setScreen({ ...screen, pick: e.target.checked ? [...screen.pick, r.id] : screen.pick.filter((x) => x !== r.id) })} />}</td>
            <td>{r.id ? <Link className="nm" to={`/candidates/${r.id}`}>{r.name}</Link> : r.name}</td>
            <td>{r.fit != null ? <Score v={r.fit} /> : '—'}</td>
            <td>{r.error ? <span className="pill r">Error</span> : <span className={`pill ${r.decision === 'Shortlist' ? 'g' : r.decision === 'Reject' ? 'r' : 'a'}`}>{r.decision}</span>}</td>
            <td className="small">{r.error ? r.error : <>{r.summary}{r.strengths?.length > 0 && <div><b>Strengths:</b> {r.strengths.join('; ')}</div>}{r.gaps?.length > 0 && <div><b>Probe:</b> {r.gaps.join('; ')}</div>}</>}</td>
          </tr>)}
        </tbody></table></div>
        {screen.running && <div className="bar" style={{ marginTop: 10 }}><b style={{ width: `${(screen.done / screen.total) * 100}%`, background: 'var(--green)' }} /></div>}
      </Modal>}
      {mailTo && <EmailComposer candidates={mailTo} onClose={() => setMailTo(null)} onSent={reload} />}
      {up && <Modal title="Upload resumes" onClose={() => { setUp(null); setUpResult(null); }} footer={upResult ? <button className="btn g" onClick={() => { setUp(null); setUpResult(null); }}>Done</button> : <><button className="btn o" onClick={() => setUp(null)}>Cancel</button><button className="btn g" disabled={busy || !up.files.length} onClick={uploadResumes}>{busy ? `Reading ${up.files.length} resumes…` : `Import ${up.files.length || ''} resumes`}</button></>}>
        {upResult ? <div className="stack">
          <p><b>{upResult.added}</b> new candidates · <b>{upResult.merged}</b> matched existing profiles · <b>{upResult.rejected + upResult.failed.length}</b> could not be imported.</p>
          {upResult.aiBy && <div className="ai"><span className="tag">Read with {upResult.aiBy.label} · {upResult.aiBy.model}</span></div>}
          {!upResult.aiUsed && <div className="warn">AI is not set up, so resumes were read with built-in rules (name, contact, city, experience, skills, CTC, notice, education). Set up AI under Integrations to also capture current employer and job title more reliably.</div>}
          {upResult.failed.map((f: any) => <div key={f.file} className="error">{f.file}: {f.error}</div>)}
          {upResult.rejected > 0 && <p className="small muted">Rejected resumes had no readable name or contact details.</p>}
        </div> : <div className="fgrid">
          <div className="full"><FormatHelp kind="resume" /></div>
          <label className="f full">Resumes (PDF, DOCX or TXT, up to 50 at a time)<input type="file" multiple accept=".pdf,.docx,.txt" onChange={(e) => setUp({ ...up, files: [...(e.target.files ?? [])] })} /></label>
          <label className="f full">Requirement<select value={up.requirementId} onChange={(e) => setUp({ ...up, requirementId: e.target.value })}><option value="">Auto-match each candidate to the best requirement</option>{reqs?.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.position}</option>)}</select></label>
          <p className="small muted full">Each resume is read for name, contact details, experience, skills, employer and education. Existing candidates with the same email or phone are updated instead of duplicated.</p>
        </div>}
      </Modal>}
      {add && <Modal title="Add candidate" onClose={() => setAdd(null)} footer={<><button className="btn o" onClick={() => setAdd(null)}>Cancel</button><button className="btn g" onClick={save} disabled={busy}>Add to pool</button></>}>
        <div className="fgrid">
          {[['name', 'Full name'], ['email', 'Email'], ['phone', 'Phone'], ['location', 'Current location'], ['expYears', 'Experience (yrs)'], ['company', 'Current company'], ['title', 'Current title'], ['currentCtc', 'Current CTC (LPA)'], ['expectedCtc', 'Expected CTC (LPA)'], ['noticeDays', 'Notice (days)']].map(([k, l]) =>
            <label key={k} className="f">{l}<input value={add[k] ?? ''} onChange={(e) => setAdd({ ...add, [k]: e.target.value })} /></label>)}
          <label className="f full">Skills (comma separated)<input value={add.skills ?? ''} onChange={(e) => setAdd({ ...add, skills: e.target.value })} /></label>
          <label className="f full">Requirement<select value={add.requirementId} onChange={(e) => setAdd({ ...add, requirementId: e.target.value })}><option value="">Auto-match to the best requirement</option>{reqs?.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.position}</option>)}</select></label>
        </div>
        <p className="small muted">If the email or phone matches an existing candidate, the profiles are merged instead of duplicated.</p>
      </Modal>}
    </Page>
  );
}
