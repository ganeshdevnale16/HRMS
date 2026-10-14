import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { auth } from './api';
import Icon from './components/Icon';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Requirements from './pages/Requirements';
import Candidates from './pages/Candidates';
import CandidateDetail from './pages/CandidateDetail';
import Pipeline from './pages/Pipeline';
import Interviews from './pages/Interviews';
import Interviewers from './pages/Interviewers';
import PostOffer from './pages/PostOffer';
import DataSources from './pages/DataSources';
import Integrations from './pages/Integrations';
import TalentDatabase from './pages/TalentDatabase';

/** Navigation follows the hiring lifecycle: requirement → sourcing → screening → interview → offer → billing. */
const NAV: { group: string; items: [string, string, string, string?][] }[] = [
  { group: 'Overview', items: [['/', 'Dashboard', 'dashboard']] },
  { group: 'Hiring workflow', items: [
    ['/requirements', 'Requirements', 'requirements', '1'],
    ['/sources', 'Sourcing', 'sources', '2'],
    ['/candidates', 'Candidates', 'candidates', '3'],
    ['/pipeline', 'Pipeline', 'pipeline', '4'],
    ['/interviews', 'Interviews', 'interviews', '5'],
    ['/offer-to-billing', 'Offer to billing', 'offer', '6'],
  ] },
  { group: 'Talent', items: [['/database', 'Talent database', 'database'], ['/interviewers', 'Interviewers', 'interviewers']] },
  { group: 'Administration', items: [['/integrations', 'Integrations', 'integrations']] },
];
const ALL = NAV.flatMap((g) => g.items.map((i) => ({ group: g.group, path: i[0], label: i[1] })));

function Crumbs() {
  const { pathname } = useLocation();
  const hit = ALL.filter((i) => (i.path === '/' ? pathname === '/' : pathname.startsWith(i.path))).sort((a, b) => b.path.length - a.path.length)[0];
  const extra = /^\/candidates\/.+/.test(pathname) ? 'Candidate profile' : '';
  return <div className="crumbs"><span>HRMS</span><Icon name="chevron" size={12} />{hit && <span>{hit.group}</span>}{hit && <Icon name="chevron" size={12} />}<b>{extra || hit?.label || 'Dashboard'}</b></div>;
}

export default function App() {
  if (!auth.token) return <Routes><Route path="*" element={<Login />} /></Routes>;
  const u = auth.user;
  const initials = String(u?.name ?? '?').split(/\s+/).map((p: string) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><div className="wm"><i aria-hidden="true" />HRMS</div><small>Requirement to billing</small></div>
        <nav className="nav" aria-label="Main">
          {NAV.map((g) => <div key={g.group} style={{ display: 'contents' }}>
            <div className="grp">{g.group}</div>
            {g.items.map(([to, label, icon, no]) => <NavLink key={to} to={to} end={to === '/'}><Icon name={icon} />{label}{no && <span className="no">{no}</span>}</NavLink>)}
          </div>)}
        </nav>
        <div className="side-foot">© {new Date().getFullYear()} HRMS · v1.0</div>
      </aside>
      <main>
        <div className="topbar">
          <Crumbs />
          <span className="spacer" />
          <div className="user"><span className="avatar" aria-hidden="true">{initials}</span><span className="who"><b>{u?.name}</b><span>{String(u?.role ?? '').toLowerCase()}</span></span></div>
          <button className="iconbtn" title="Sign out" aria-label="Sign out" onClick={() => { auth.clear(); location.href = '/'; }}><Icon name="logout" size={18} /></button>
        </div>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/requirements" element={<Requirements />} />
          <Route path="/sources" element={<DataSources />} />
          <Route path="/candidates" element={<Candidates />} />
          <Route path="/candidates/:id" element={<CandidateDetail />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/interviews" element={<Interviews />} />
          <Route path="/interviews/:id" element={<Interviews />} />
          <Route path="/offer-to-billing" element={<PostOffer />} />
          <Route path="/database" element={<TalentDatabase />} />
          <Route path="/interviewers" element={<Interviewers />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
