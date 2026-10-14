import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, fmtDT, human, STAGES } from '../api';
import { Empty, Page, Score, useApi } from '../ui';

export default function Dashboard() {
  const { data: d, error } = useApi('/dashboard/summary');
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  async function ask(question: string) {
    if (!question.trim()) return;
    setQ(question); setAsking(true); setAnswer('');
    try { setAnswer((await api('/dashboard/ask', { body: { question } })).answer); } catch (e: any) { setAnswer(e.message); } finally { setAsking(false); }
  }
  if (error) return <Page title="Dashboard"><div className="error">{error}</div></Page>;
  if (!d) return <Page title="Dashboard"><Empty>Loading…</Empty></Page>;
  const max = d.reached.SOURCED || 1;
  const rail = [{ k: '', n: 'Requirements', v: d.openRequirements, to: '/requirements' }, ...STAGES.map((s) => ({ k: s, n: human(s), v: d.inStage[s], to: `/candidates?stage=${s}` }))];
  return (
    <Page title="Dashboard" sub="The whole lifecycle at a glance">
      <div className="stack">
        <nav className="rail" aria-label="Candidates in each stage">{rail.map((r, i) => (
          <Link key={r.n} to={r.to} className={r.v ? '' : 'dim'}><div className="ix">{i + 1}</div><div className="n">{r.v}</div><div className="l">{r.n}</div></Link>))}
        </nav>
        <div className="cols">
          <section className="panel c5"><h2>Conversion funnel</h2>
            <div className="fun">{STAGES.map((s) => <div className="fr" key={s}><span>{human(s)}</span><span className="bar"><b style={{ width: `${Math.max(2, (d.reached[s] / max) * 100)}%` }} /></span><b style={{ textAlign: 'right' }}>{d.reached[s]}</b></div>)}</div>
            <p className="small muted">Interview feedback outstanding: <b style={{ color: 'var(--ink)' }}>{d.feedbackPending}</b></p>
          </section>
          <section className="panel c7"><h2>Ask about your pipeline</h2>
            <form className="row" onSubmit={(e) => { e.preventDefault(); ask(q); }}><input style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Which requirement is most at risk of missing its target?" aria-label="Question" /><button className="btn" disabled={asking}>Ask</button></form>
            <div className="row" style={{ marginTop: 8 }}>{['Which requirement is most at risk?', 'Where are candidates dropping off?', 'Summarise this week for the client'].map((x) => <button key={x} className="btn o sm" onClick={() => ask(x)}>{x}</button>)}</div>
            {(asking || answer) && <div className="ai" style={{ whiteSpace: 'pre-wrap' }}>{asking ? <span className="muted">Thinking…</span> : answer}</div>}
          </section>
          <section className="panel c8"><h2>Requirement health</h2><div className="tw"><table><thead><tr><th>Requirement</th><th>Priority</th><th>Openings</th><th>In pipeline</th><th>Selected+</th><th>Joined</th><th>Top-5 fit</th><th>Target</th></tr></thead><tbody>
            {d.health.map((h: any) => <tr key={h.id}><td><Link to={`/candidates?requirementId=${h.id}`} className="nm">{h.position}</Link><div className="sub">{h.client} · {h.code}</div></td><td><span className={`pill ${h.priority === 'HIGH' ? 'r' : h.priority === 'MEDIUM' ? 'a' : ''}`}>{human(h.priority)}</span></td><td>{h.openings}</td><td>{h.inPipeline}</td><td>{h.selected}</td><td>{h.joined}</td><td><Score v={h.topFit} /></td><td>{fmtDate(h.targetDate)}</td></tr>)}
          </tbody></table></div></section>
          <section className="panel c4"><h2>Upcoming interviews</h2>
            {d.upcoming.length ? <ul className="tl">{d.upcoming.map((i: any) => <li key={i.id}><Link to={`/candidates/${i.candidate.id}`} className="nm">{i.candidate.name}</Link> · {i.round}<div className="d">{fmtDT(i.startAt)} · {i.panel.map((p: any) => p.interviewer.name).join(', ')}</div></li>)}</ul> : <Empty>Nothing scheduled.</Empty>}
          </section>
          <section className="panel c6"><h2>Where candidates come from</h2>
            {d.sources.map((s: any) => <div className="fun" key={s.name}><div className="fr" style={{ gridTemplateColumns: '160px 1fr 40px' }}><span>{s.name}</span><span className="bar"><b style={{ width: `${(s.count / Math.max(...d.sources.map((x: any) => x.count))) * 100}%`, background: 'var(--green2)' }} /></span><b>{s.count}</b></div></div>)}
          </section>
          <section className="panel c6"><h2>Needs attention</h2>
            {d.attention.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{d.attention.map((a: any, i: number) => <li key={i}><Link to={`/candidates/${a.candidateId}`}>{a.text}</Link></li>)}</ul> : <Empty>Nothing waiting on you.</Empty>}
          </section>
        </div>
      </div>
    </Page>
  );
}
