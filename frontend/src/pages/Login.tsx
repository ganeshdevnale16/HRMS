import { useState } from 'react';
import { api, auth } from '../api';

const STEPS = ['Requirement', 'Sourcing', 'Screening', 'Communication', 'Interview', 'Selection', 'Hiring', 'BGV', 'Joining', 'Billing'];

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await api('/auth/login', { body: { email, password } }); auth.set(r.token, r.user); location.href = '/'; }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <div className="login">
      <section className="hero" aria-hidden="true">
        <div className="brand" style={{ padding: 0, border: 0 }}><div className="wm"><i />HRMS</div></div>
        <div>
          <h1>One platform from client requirement to billing.</h1>
          <p>Source from every channel, screen with AI, schedule interviews on Teams, Zoom or Meet, and track every hire through BGV, joining and billing.</p>
          <ol>{STEPS.map((s, i) => <li key={s}>{i + 1}. {s}</li>)}</ol>
        </div>
        <small style={{ color: '#6B7178' }}>Authorised users only. Activity is logged.</small>
      </section>
      <div className="formside">
        <form onSubmit={submit} className="stack">
          <div><h2>Sign in</h2><p className="muted" style={{ margin: 0 }}>Use your HRMS username or work email.</p></div>
          <label className="f">Username or email<input type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
          <label className="f">Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <div className="error">{error}</div>}
          <button className="btn g" disabled={busy} style={{ width: '100%', height: 40 }}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
}
