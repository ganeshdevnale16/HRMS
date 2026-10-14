import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, fmtDT, fmtTime, PROVIDER_LABEL, ROUNDS, toLocalInput } from '../api';
import { Modal, useApi, useToast } from '../ui';

/**
 * Four-step scheduler:
 * 1. candidate, round, duration, meeting platform (only connected platforms are selectable)
 * 2. interviewers, ranked by skill match and spare capacity this week
 * 3. a common free slot from the panel's calendars + HRMS bookings, or a manual time
 * 4. confirm → meeting is created on the platform and invites go out
 */
export default function ScheduleInterview({ candidateId, onClose, onDone }: { candidateId?: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [f, setF] = useState<any>({ candidateId: candidateId ?? '', round: 'L1 Technical', durationMins: 60, provider: '', location: '', notes: '' });
  const [panel, setPanel] = useState<string[]>([]);
  const [slot, setSlot] = useState<string>('');
  const [manual, setManual] = useState('');
  const [range, setRange] = useState({ from: toLocalInput(new Date()).slice(0, 10), days: 7 });
  const [slots, setSlots] = useState<{ start: string; end: string }[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [conflict, setConflict] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);

  const { data: integ } = useApi('/integrations');
  const { data: cands } = useApi<any[]>(candidateId ? `/candidates/${candidateId}` : '/candidates?status=ACTIVE&take=500');
  const candList: any[] = useMemo(() => (candidateId ? (cands ? [cands] : []) : (cands ?? []).filter((c) => ['COMMUNICATION', 'INTERVIEW', 'SELECTION', 'SCREENING'].includes(c.stage))), [cands, candidateId]);
  const cand = candList.find((c) => c.id === f.candidateId);
  const { data: suggestions } = useApi<any[]>(cand?.requirementId ? `/interviewers/suggest?requirementId=${cand.requirementId}&round=${encodeURIComponent(f.round)}` : null);

  useEffect(() => {
    if (!f.provider && integ) setF((x: any) => ({ ...x, provider: integ.meeting.find((m: any) => m.configured && !['IN_PERSON', 'PHONE'].includes(m.id))?.id ?? 'IN_PERSON' }));
  }, [integ]);

  async function findSlots() {
    setBusy(true); setSlot('');
    const from = new Date(range.from + 'T00:00');
    const to = new Date(from.getTime() + range.days * 864e5);
    try { const r = await api('/interviews/slots', { body: { interviewerIds: panel, durationMins: Number(f.durationMins), from, to } }); setSlots(r.slots); setWarnings(r.warnings); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  }
  useEffect(() => { if (step === 3 && panel.length) findSlots(); }, [step]);

  const start = slot || (manual ? new Date(manual).toISOString() : '');
  async function submit(force = false) {
    setBusy(true); setConflict(null);
    try {
      const r = await api('/interviews', { body: { ...f, durationMins: Number(f.durationMins), interviewerIds: panel, start, force, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
      setDone(r); onDone();
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409) setConflict(e.details?.problems ?? [e.message]);
      else toast(e.message, true);
    } finally { setBusy(false); }
  }

  const byDay = useMemo(() => {
    const g: Record<string, { start: string; end: string }[]> = {};
    (slots ?? []).forEach((s) => { const k = new Date(s.start).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); (g[k] ||= []).push(s); });
    return g;
  }, [slots]);
  const chosen = (suggestions ?? []).filter((s) => panel.includes(s.interviewer.id)).map((s) => s.interviewer);

  if (done) return (
    <Modal title="Interview scheduled" onClose={onClose} footer={<button className="btn g" onClick={onClose}>Done</button>}>
      <p><b>{done.interview.round}</b> with <b>{done.interview.candidate.name}</b> on {fmtDT(done.interview.startAt)}.</p>
      <p>{PROVIDER_LABEL[done.interview.provider]}{done.interview.joinUrl && <> · <a href={done.interview.joinUrl} target="_blank" rel="noreferrer">Join link</a></>}</p>
      <p className="small muted">{['TEAMS', 'GOOGLE_MEET', 'WEBEX'].includes(done.interview.provider) ? 'Calendar invites were sent by the meeting platform.' : 'Calendar invites (.ics) were emailed to the panel and the candidate.'}</p>
      {done.warnings?.map((w: string) => <div key={w} className="warn">{w}</div>)}
    </Modal>
  );

  const steps = ['Details', 'Interviewers', 'Time', 'Confirm'];
  const canNext = step === 1 ? !!(f.candidateId && cand?.requirementId && f.provider) : step === 2 ? panel.length > 0 : step === 3 ? !!start : true;
  return (
    <Modal wide title="Schedule interview" onClose={onClose} footer={<>
      {step > 1 && <button className="btn o" onClick={() => setStep(step - 1)}>Back</button>}
      <button className="btn o" onClick={onClose}>Cancel</button>
      {step < 4 ? <button className="btn g" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue</button>
        : <button className="btn g" disabled={busy} onClick={() => submit(false)}>{busy ? 'Scheduling…' : 'Schedule and send invites'}</button>}</>}>
      <div className="steps">{steps.map((s, i) => <span key={s} className={step === i + 1 ? 'on' : ''}>{i + 1}. {s}</span>)}</div>

      {step === 1 && <div className="stack">
        <div className="fgrid">
          <label className="f full">Candidate<select value={f.candidateId} onChange={(e) => setF({ ...f, candidateId: e.target.value })} disabled={!!candidateId}>
            <option value="">Choose a candidate</option>{candList.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.requirement?.position ?? 'no requirement'}</option>)}</select></label>
          {cand && !cand.requirementId && <div className="error full">Link this candidate to a requirement before scheduling.</div>}
          <label className="f">Round<select value={f.round} onChange={(e) => { setF({ ...f, round: e.target.value }); setPanel([]); }}>{ROUNDS.map((r) => <option key={r}>{r}</option>)}</select></label>
          <label className="f">Duration<select value={f.durationMins} onChange={(e) => setF({ ...f, durationMins: e.target.value })}>{[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></label>
        </div>
        <div><h3>Meeting platform</h3>
          <div className="opt">{integ?.meeting.map((m: any) => (
            <button key={m.id} aria-pressed={f.provider === m.id} disabled={!m.configured} onClick={() => setF({ ...f, provider: m.id })}>
              <b>{m.label}</b><span>{m.configured ? (['TEAMS', 'GOOGLE_MEET', 'WEBEX'].includes(m.id) ? 'Link created, platform sends invites' : ['ZOOM', 'JITSI'].includes(m.id) ? 'Link created, we email invites' : 'We email the invite') : 'Not connected — see Integrations'}</span></button>))}
          </div></div>
        {f.provider === 'IN_PERSON' && <label className="f">Venue<input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Office, floor, meeting room" /></label>}
        <label className="f">Note for the panel and candidate (optional)<textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      </div>}

      {step === 2 && <div>
        <p className="small muted" style={{ marginTop: 0 }}>Ranked by skill match with {cand?.requirement?.position} and spare capacity this week. Pick one interviewer, or up to six for a panel.</p>
        <div className="tw"><table><thead><tr><th /><th>Interviewer</th><th>Match</th><th>Skills that match</th><th>This week</th><th>Calendar</th></tr></thead><tbody>
          {(suggestions ?? []).map((s) => {
            const i = s.interviewer, on = panel.includes(i.id);
            return <tr key={i.id} className="click" onClick={() => setPanel(on ? panel.filter((x) => x !== i.id) : panel.length < 6 ? [...panel, i.id] : panel)}>
              <td><input type="checkbox" checked={on} readOnly aria-label={`Select ${i.name}`} /></td>
              <td><div className="nm">{i.name}</div><div className="sub">{i.title} · {i.email}</div></td>
              <td><b>{s.score}</b></td><td>{s.matchedSkills.map((k: string) => <span key={k} className="chip hit">{k}</span>)}{!s.matchedSkills.length && <span className="muted small">None</span>}</td>
              <td>{s.thisWeek} / {i.maxPerWeek}{s.atCapacity && <span className="pill a" style={{ marginLeft: 6 }}>At capacity</span>}</td>
              <td className="small">{i.calendarProvider === 'NONE' ? 'HRMS only' : i.calendarProvider === 'OUTLOOK' ? 'Outlook' : 'Google'}</td>
            </tr>;
          })}
          {suggestions && !suggestions.length && <tr><td colSpan={6} className="empty">No active interviewers take {f.round} rounds. Add one on the Interviewers page.</td></tr>}
        </tbody></table></div>
      </div>}

      {step === 3 && <div className="stack">
        <div className="row">
          <label className="f">From<input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
          <label className="f">Search<select value={range.days} onChange={(e) => setRange({ ...range, days: Number(e.target.value) })}><option value={3}>3 days</option><option value={7}>7 days</option><option value={14}>14 days</option></select></label>
          <button className="btn o" style={{ alignSelf: 'flex-end' }} onClick={findSlots} disabled={busy}>{busy ? 'Checking calendars…' : 'Find common free time'}</button>
        </div>
        {warnings.map((w) => <div className="warn" key={w}>{w}</div>)}
        {slots && !slots.length && <div className="warn">No common free time for this panel in that range. Search further ahead, change the panel, or pick a time manually.</div>}
        {Object.entries(byDay).map(([day, list]) => <div key={day}><h3>{day}</h3><div className="slots">{list.map((s) => <button key={s.start} aria-pressed={slot === s.start} onClick={() => { setSlot(s.start); setManual(''); }}>{fmtTime(s.start)}</button>)}</div></div>)}
        <label className="f" style={{ maxWidth: 280 }}>Or pick a time manually<input type="datetime-local" value={manual} onChange={(e) => { setManual(e.target.value); setSlot(''); }} /></label>
        <p className="small muted">Free time respects each interviewer’s working hours, daily limit, buffer between interviews, their connected calendar, and interviews already booked here.</p>
      </div>}

      {step === 4 && <div className="stack">
        <div className="kv">
          <div><span>Candidate</span><b>{cand?.name}</b></div><div><span>Role</span><b>{cand?.requirement?.position}</b></div><div><span>Round</span><b>{f.round}</b></div>
          <div><span>When</span><b>{fmtDT(start)}</b></div><div><span>Duration</span><b>{f.durationMins} minutes</b></div><div><span>Platform</span><b>{PROVIDER_LABEL[f.provider]}</b></div>
          <div style={{ gridColumn: '1/-1' }}><span>Panel</span><b>{chosen.map((i: any) => i.name).join(', ')}</b></div>
        </div>
        <p className="small muted">Invites go to {chosen.map((i: any) => i.email).join(', ')}{cand?.email ? ` and ${cand.email}` : ' (the candidate has no email on file)'}.</p>
        {conflict && <div className="error"><b>This time does not work:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{conflict.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="row" style={{ marginTop: 8 }}><button className="btn o sm" onClick={() => setStep(3)}>Pick another time</button><button className="btn danger sm" onClick={() => submit(true)} disabled={busy}>Schedule anyway</button></div></div>}
      </div>}
    </Modal>
  );
}
