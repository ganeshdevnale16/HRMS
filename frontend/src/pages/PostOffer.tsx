import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, human } from '../api';
import { Empty, Page, useAction, useApi } from '../ui';

const OPT = {
  offer: { status: ['PREPARATION', 'APPROVAL_PENDING', 'APPROVED', 'RELEASED', 'ACCEPTED', 'DECLINED'], documents: ['PENDING', 'PARTIAL', 'COMPLETE'] },
  bgv: { status: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISCREPANCY', 'FAILED'] },
  billing: { status: ['ELIGIBLE', 'START_DATE_SET', 'ACTIVE', 'ON_HOLD', 'STOPPED'] },
};
const TABS: [string, string, string][] = [['offer', 'Offers', 'HIRING'], ['bgv', 'Background verification', 'BGV'], ['joining', 'Joining', 'JOINING'], ['billing', 'Billing', 'BILLING']];

export default function PostOffer() {
  const [tab, setTab] = useState('offer');
  const { data, reload } = useApi<any[]>('/candidates?take=500');
  const { run } = useAction();
  const rows = (data ?? []).filter((c) => c[tab] && c.status !== 'REJECTED');
  const save = async (id: string, patch: any) => { if (await run(() => api(`/candidates/${id}/${tab}`, { method: 'PATCH', body: patch }), 'Saved')) reload(); };
  const sel = (c: any, field: string, opts: string[]) => <select value={c[tab][field] ?? ''} onChange={(e) => save(c.id, { [field]: e.target.value })} aria-label={field}>{opts.map((o) => <option key={o} value={o}>{human(o)}</option>)}</select>;
  const inp = (c: any, field: string, type = 'text') => <input type={type} defaultValue={type === 'date' ? c[tab][field]?.slice(0, 10) ?? '' : c[tab][field] ?? ''} style={{ width: type === 'date' ? 150 : 120 }} aria-label={field}
    onBlur={(e) => { const v = e.target.value; const cur = type === 'date' ? c[tab][field]?.slice(0, 10) ?? '' : String(c[tab][field] ?? ''); if (v !== cur) save(c.id, { [field]: v === '' ? null : type === 'number' ? Number(v) : v }); }} />;
  const name = (c: any) => <td><Link className="nm" to={`/candidates/${c.id}`}>{c.name}</Link><div className="sub">{c.requirement?.client} · {c.requirement?.position}</div></td>;

  return (
    <Page title="Offer to billing" sub="Step 6 · Selection, hiring, BGV, joining and billing">
      <div className="tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      <section className="panel"><div className="tw"><table>
        {tab === 'offer' && <><thead><tr><th>Candidate</th><th>Final CTC (LPA)</th><th>Offer status</th><th>Documents</th><th>Expected joining</th></tr></thead><tbody>{rows.map((c) => <tr key={c.id}>{name(c)}<td>{inp(c, 'finalCtc', 'number')}</td><td>{sel(c, 'status', OPT.offer.status)}</td><td>{sel(c, 'documents', OPT.offer.documents)}</td><td>{inp(c, 'expectedJoining', 'date')}</td></tr>)}</tbody></>}
        {tab === 'bgv' && <><thead><tr><th>Candidate</th><th>Case ID</th><th>Provider</th><th>Initiated</th><th>Status</th><th>Result</th></tr></thead><tbody>{rows.map((c) => <tr key={c.id}>{name(c)}<td>{inp(c, 'caseId')}</td><td>{inp(c, 'provider')}</td><td>{inp(c, 'initiatedAt', 'date')}</td><td>{sel(c, 'status', OPT.bgv.status)}</td><td>{inp(c, 'result')}</td></tr>)}</tbody></>}
        {tab === 'joining' && <><thead><tr><th>Candidate</th><th>Expected</th><th>Actual joining</th><th>Employee ID</th><th>Project</th><th>Status</th></tr></thead><tbody>{rows.map((c) => <tr key={c.id}>{name(c)}<td>{inp(c, 'expectedDate', 'date')}</td><td>{inp(c, 'actualDate', 'date')}</td><td>{inp(c, 'employeeId')}</td><td>{inp(c, 'project')}</td><td>{c.joining.actualDate ? <span className="pill g">Joined {fmtDate(c.joining.actualDate)}</span> : <span className="pill a">Awaiting</span>}</td></tr>)}</tbody></>}
        {tab === 'billing' && <><thead><tr><th>Candidate</th><th>Billing start</th><th>Rate (LPA)</th><th>Status</th><th>Invoice ref</th></tr></thead><tbody>{rows.map((c) => <tr key={c.id}>{name(c)}<td>{inp(c, 'startDate', 'date')}</td><td>{inp(c, 'rate', 'number')}</td><td>{sel(c, 'status', OPT.billing.status)}</td><td>{inp(c, 'invoiceRef')}</td></tr>)}</tbody></>}
      </table>{!rows.length && <Empty>No candidates at this step yet. They appear when moved to {human(TABS.find((t) => t[0] === tab)![2])} in the pipeline.</Empty>}</div></section>
      <p className="small muted">Offer accepted moves the candidate to BGV. BGV completed moves them to Joining. An actual joining date moves them to Billing.</p>
    </Page>
  );
}
