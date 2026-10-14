import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, downloadFile, fmtDate, human, STAGES } from '../api';
import { Empty, Page, StagePill, useAction, useApi } from '../ui';
import EmailComposer from '../components/EmailComposer';

/**
 * Master database of every candidate ever added — active, on hold, rejected, selected or hired —
 * so past applicants can be searched and reused for new requirements.
 */
const OUTCOMES: [string, string, string][] = [['', 'All', 'all'], ['IN_PROCESS', 'In process', 'inProcess'], ['SELECTED', 'Selected / offer', 'selected'], ['HIRED', 'Hired', 'hired'], ['HOLD', 'On hold', 'hold'], ['REJECTED', 'Rejected', 'rejected']];
const pill = (o: string) => (o === 'Hired' ? 'g' : o === 'Rejected' ? 'r' : o === 'On hold' ? 'a' : o === 'Selected' ? 'b' : '');

export default function TalentDatabase() {
  const [sp, setSp] = useSearchParams();
  const q = Object.fromEntries([...sp.entries()].filter(([, v]) => v));
  const qs = new URLSearchParams(q).toString();
  const { data, reload, loading } = useApi(`/candidates/database?${qs}`);
  const { data: reqs } = useApi<any[]>('/requirements');
  const { data: sources } = useApi<any[]>('/sources');
  const [f, setF] = useState<any>(q);
  const [sel, setSel] = useState<string[]>([]);
  const [mailTo, setMailTo] = useState<any[] | null>(null);
  const { run, busy } = useAction();
  const nav = useNavigate();
  useEffect(() => { setSel([]); }, [qs]);
  const set = (patch: Record<string, string>) => { const n = new URLSearchParams({ ...q, ...patch, page: patch.page ?? '1' }); [...n.entries()].forEach(([k, v]) => !v && n.delete(k)); setSp(n); };
  const apply = (e?: React.FormEvent) => { e?.preventDefault(); set({ search: f.search ?? '', skill: f.skill ?? '', location: f.location ?? '', minExp: f.minExp ?? '', maxExp: f.maxExp ?? '', from: f.from ?? '', to: f.to ?? '' }); };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  async function assign(rid: string) {
    if (!rid) return;
    const r = reqs?.find((x) => x.id === rid);
    if (!confirm(`Assign ${sel.length} candidate(s) to ${r?.code} · ${r?.position} and restart them at Screening? Rejected candidates become active again.`)) return;
    const ok = await run(() => api('/candidates/bulk-assign', { body: { ids: sel, requirementId: rid, resetStage: true } }), `${sel.length} candidate(s) added to ${r?.code}`);
    if (ok) { setSel([]); reload(); }
  }

  return (
    <Page title="Talent database" sub="Every candidate ever sourced — in process, hired or rejected — searchable and reusable"
      actions={<button className="btn o" disabled={busy || !data?.total} onClick={() => run(() => downloadFile(`/candidates/database/export?${qs}`, 'talent-database.csv'), 'Export downloaded')}>Export to Excel (CSV)</button>}>
      <div className="tabs" role="tablist">{OUTCOMES.map(([v, l, k]) => (
        <button key={l} role="tab" aria-selected={(q.outcome ?? '') === v} onClick={() => set({ outcome: v })}>{l}{data ? ` (${data.counts[k]})` : ''}</button>))}
      </div>

      <section className="panel">
        <form className="row" onSubmit={apply} style={{ marginBottom: 10 }}>
          <input style={{ minWidth: 240, flex: 1 }} placeholder="Name, email, phone, company, title or any word in the resume" value={f.search ?? ''} onChange={(e) => setF({ ...f, search: e.target.value })} aria-label="Search" />
          <input style={{ width: 170 }} placeholder="Skills (e.g. Java, SQL)" value={f.skill ?? ''} onChange={(e) => setF({ ...f, skill: e.target.value })} aria-label="Skills" />
          <input style={{ width: 120 }} placeholder="Location" value={f.location ?? ''} onChange={(e) => setF({ ...f, location: e.target.value })} aria-label="Location" />
          <input style={{ width: 80 }} type="number" min={0} placeholder="Exp from" value={f.minExp ?? ''} onChange={(e) => setF({ ...f, minExp: e.target.value })} aria-label="Minimum experience" />
          <input style={{ width: 80 }} type="number" min={0} placeholder="Exp to" value={f.maxExp ?? ''} onChange={(e) => setF({ ...f, maxExp: e.target.value })} aria-label="Maximum experience" />
          <button className="btn">Search</button>
          {qs && <button type="button" className="btn o" onClick={() => { setF({}); setSp(new URLSearchParams()); }}>Clear all</button>}
        </form>
        <div className="row small" style={{ marginBottom: 12 }}>
          <select value={q.requirementId ?? ''} onChange={(e) => set({ requirementId: e.target.value })} aria-label="Requirement"><option value="">Any requirement</option><option value="none">Not assigned</option>{reqs?.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.position}{r.status !== 'OPEN' ? ` (${r.status.toLowerCase()})` : ''}</option>)}</select>
          <select value={q.stage ?? ''} onChange={(e) => set({ stage: e.target.value })} aria-label="Stage"><option value="">Any stage</option>{STAGES.map((s) => <option key={s} value={s}>{human(s)}</option>)}</select>
          <select value={q.source ?? ''} onChange={(e) => set({ source: e.target.value })} aria-label="Source"><option value="">Any source</option>{sources?.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}</select>
          <label className="row">Added from<input type="date" value={f.from ?? ''} onChange={(e) => { setF({ ...f, from: e.target.value }); set({ from: e.target.value }); }} /></label>
          <label className="row">to<input type="date" value={f.to ?? ''} onChange={(e) => { setF({ ...f, to: e.target.value }); set({ to: e.target.value }); }} /></label>
          <select value={q.sort ?? 'recent'} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort"><option value="recent">Recently updated</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option><option value="exp">Most experienced</option></select>
          <span className="muted">{loading ? 'Loading…' : `${data?.total ?? 0} candidates`}</span>
        </div>

        {sel.length > 0 && <div className="row warn" style={{ color: 'var(--ink)' }}><b>{sel.length} selected</b>
          <select value="" onChange={(e) => assign(e.target.value)} aria-label="Reuse for requirement" disabled={busy}><option value="">Reuse for requirement…</option>{reqs?.filter((r) => r.status === 'OPEN').map((r) => <option key={r.id} value={r.id}>{r.code} · {r.position}</option>)}</select>
          <button className="btn o sm" onClick={() => setMailTo(data.rows.filter((c: any) => sel.includes(c.id)))}>Email</button>
          <button className="btn o sm" onClick={() => setSel([])}>Clear</button></div>}

        <div className="tw"><table><thead><tr>
          <th><input type="checkbox" aria-label="Select all on this page" checked={!!data?.rows.length && sel.length === data.rows.length} onChange={(e) => setSel(e.target.checked ? data.rows.map((c: any) => c.id) : [])} /></th>
          <th>Candidate</th><th>Outcome</th><th>Stage</th><th>Requirement</th><th>Exp</th><th>Location</th><th>Skills</th><th>Exp. CTC</th><th>Source</th><th>Added</th><th>Updated</th></tr></thead><tbody>
          {data?.rows.length ? data.rows.map((c: any) => (
            <tr key={c.id} className="click" onClick={() => nav(`/candidates/${c.id}`)}>
              <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${c.name}`} checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} /></td>
              <td><div className="nm">{c.name}{c.resumeFileId && <span className="chip" style={{ marginLeft: 6 }}>CV</span>}</div><div className="sub">{c.email ?? c.phone ?? '—'}{c.title ? ` · ${c.title}` : ''}{c.company ? ` · ${c.company}` : ''}</div></td>
              <td><span className={`pill ${pill(c.outcome)}`}>{c.outcome}</span></td>
              <td><StagePill stage={c.stage} status={c.status} /></td>
              <td className="small">{c.requirement ? <><b>{c.requirement.code}</b> {c.requirement.position}<div className="sub">{c.requirement.client}</div></> : <span className="muted">—</span>}</td>
              <td>{c.expYears} yrs</td><td>{c.location ?? '—'}</td>
              <td className="small">{c.skills.slice(0, 5).join(', ')}{c.skills.length > 5 ? ` +${c.skills.length - 5}` : ''}</td>
              <td>{c.expectedCtc ? `${c.expectedCtc} L` : '—'}</td>
              <td className="small">{c.sources.join(', ')}</td>
              <td className="small">{fmtDate(c.createdAt)}</td><td className="small">{fmtDate(c.updatedAt)}</td>
            </tr>)) : <tr><td colSpan={12}><Empty>{loading ? 'Loading…' : 'No candidates match. Clear a filter or import candidates from Data sources.'}</Empty></td></tr>}
        </tbody></table></div>

        {data && pages > 1 && <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn o sm" disabled={data.page <= 1} onClick={() => set({ page: String(data.page - 1) })}>Previous</button>
          <span className="small">Page {data.page} of {pages}</span>
          <button className="btn o sm" disabled={data.page >= pages} onClick={() => set({ page: String(data.page + 1) })}>Next</button>
          <select value={q.pageSize ?? '50'} onChange={(e) => set({ pageSize: e.target.value })} aria-label="Rows per page">{[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} per page</option>)}</select>
        </div>}
      </section>
      {mailTo && <EmailComposer candidates={mailTo} onClose={() => setMailTo(null)} onSent={reload} />}
      <p className="small muted">Nothing is ever removed from here automatically. Rejected and hired candidates stay searchable; use “Reuse for requirement” to put past candidates into a new job. <Link to="/candidates">Candidates</Link> shows the working pipeline.</p>
    </Page>
  );
}
