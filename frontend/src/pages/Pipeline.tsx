import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, human, STAGES } from '../api';
import { Page, Score, useAction, useApi } from '../ui';

export default function Pipeline() {
  const { data: reqs } = useApi<any[]>('/requirements');
  const [rid, setRid] = useState('');
  useEffect(() => { if (!rid && reqs?.length) setRid(reqs[0].id); }, [reqs, rid]);
  const { data, reload } = useApi<any[]>(rid ? `/candidates?requirementId=${rid}` : null);
  const [over, setOver] = useState('');
  const { run } = useAction();
  const move = async (id: string, stage: string) => { if (await run(() => api(`/candidates/${id}/stage`, { body: { stage, reason: 'Moved on board' } }))) reload(); };
  const req = reqs?.find((r) => r.id === rid);
  const list = (data ?? []).filter((c) => c.status !== 'REJECTED');

  return (
    <Page title="Pipeline" sub="Step 4 · Move candidates stage by stage — drag a card or use the arrows">
      <div className="row" style={{ marginBottom: 14 }}>
        <select value={rid} onChange={(e) => setRid(e.target.value)} aria-label="Requirement">{reqs?.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.client} – {r.position}</option>)}</select>
        {req && <span className="small muted">{req.openings} openings · {list.length} active candidates</span>}
      </div>
      <div className="board">
        {STAGES.map((s, si) => {
          const cards = list.filter((c) => c.stage === s);
          return (
            <div key={s} className={`col ${over === s ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver('')}
              onDrop={(e) => { e.preventDefault(); setOver(''); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, s); }}>
              <h3><span>{human(s)}</span><span className="muted">{cards.length}</span></h3>
              <div className="list">
                {cards.map((c) => (
                  <div key={c.id} className={`card ${c.status === 'HOLD' ? 'hold' : ''}`} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', c.id)}>
                    <Link to={`/candidates/${c.id}`} className="nm">{c.name}</Link>
                    <div className="sub" style={{ margin: '2px 0 6px' }}>{c.expYears} yrs · {c.location ?? '—'} · {c.noticeDays ? `${c.noticeDays}d` : 'Immediate'}</div>
                    {c.match && <Score v={c.match.score} />}
                    <div className="spread" style={{ marginTop: 6 }}>
                      <button className="btn o sm" disabled={si === 0} onClick={() => move(c.id, STAGES[si - 1])} aria-label={`Move ${c.name} back`}>◀</button>
                      <button className="btn o sm" disabled={si === STAGES.length - 1} onClick={() => move(c.id, STAGES[si + 1])} aria-label={`Move ${c.name} forward`}>▶</button>
                    </div>
                  </div>))}
                {!cards.length && <div className="small muted" style={{ padding: 6 }}>Empty</div>}
              </div>
            </div>);
        })}
      </div>
    </Page>
  );
}
