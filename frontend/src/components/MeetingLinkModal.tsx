import { useState } from 'react';
import { api, fmtDT } from '../api';
import { interviewDraft, outlookEventLink, teamsMeetingLink } from '../lib/deeplinks';
import { Ext, Modal, useAction } from '../ui';

/** For interviews where the recruiter sends the Teams invite from their own account (no admin setup). */
export default function MeetingLinkModal({ iv, onClose, onDone, justScheduled }: { iv: any; onClose: () => void; onDone: () => void; justScheduled?: boolean }) {
  const [url, setUrl] = useState(iv.joinUrl ?? '');
  const [notify, setNotify] = useState(false);
  const { run, busy } = useAction();
  const d = interviewDraft(iv);
  return <Modal title={justScheduled ? 'Interview booked — now send the Teams invite' : `Teams invite · ${iv.candidate.name}`} onClose={onClose} footer={<>
    <button className="btn o" onClick={onClose}>{url === (iv.joinUrl ?? '') ? 'Done' : 'Close without saving'}</button>
    <button className="btn g" disabled={busy || url === (iv.joinUrl ?? '')} onClick={async () => { if (await run(() => api(`/interviews/${iv.id}/link`, { body: { url: url.trim() || null, notify } }), notify ? 'Link saved and emailed' : 'Link saved')) { onDone(); onClose(); } }}>Save link</button></>}>
    <div className="stack">
      <div className="kv"><div><span>When</span><b>{fmtDT(iv.startAt)}</b></div><div><span>Round</span><b>{iv.round}</b></div><div><span>Invitees</span><b>{d.attendees.length}</b></div></div>
      <div>
        <h3>1 · Send the invite from your own Teams / Outlook</h3>
        <p className="small muted" style={{ marginTop: 0 }}>Opens your account with the subject, time, panel and candidate already filled in. Check the details and click <b>Send</b>. The invite comes from you, with a real Teams link.</p>
        <div className="row">
          <a className="btn g" href={teamsMeetingLink(d)} target="_blank" rel="noreferrer">Open in Teams</a>
          <a className="btn o" href={outlookEventLink(d)} target="_blank" rel="noreferrer">Open in Outlook (web)</a>
        </div>
        <p className="small muted">In Outlook, switch on <b>Teams meeting</b> before sending. If any invitee is missing, add: {d.attendees.join(', ') || '—'}</p>
      </div>
      <div>
        <h3>2 · Paste the Teams join link here (optional)</h3>
        <p className="small muted" style={{ marginTop: 0 }}>Open the meeting you just sent → <b>Copy link</b>. Saving it shows the Join button in HRMS for the panel.</p>
        <label className="f">Join link<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://teams.microsoft.com/l/meetup-join/…" /></label>
        <label className="row small" style={{ marginTop: 8 }}><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Also email this link as a calendar invite from HRMS (only if you did <b>not</b> invite them from Teams)</label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Reschedule or cancel later? Change it in HRMS <b>and</b> update or cancel the same meeting in your Outlook/Teams. <Ext href="https://support.microsoft.com/office/schedule-a-meeting-in-microsoft-teams-943507a9-8583-4c58-b5d2-8ec8265e04e5">Microsoft help</Ext></p>
    </div>
  </Modal>;
}
