import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, human, STAGES } from './api';

/* ---------- toast ---------- */
const ToastCtx = createContext<(m: string, err?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ m: string; err?: boolean } | null>(null);
  const timer = useRef<number>();
  const show = useCallback((m: string, err?: boolean) => { setT({ m, err }); clearTimeout(timer.current); timer.current = window.setTimeout(() => setT(null), 3500); }, []);
  return <ToastCtx.Provider value={show}>{children}{t && <div className={`toast ${t.err ? 'err' : ''}`} role="status">{t.m}</div>}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

/* ---------- data hook ---------- */
export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try { setData(await api<T>(path)); setError(null); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { load(); }, [load, ...deps]);
  return { data, error, loading, reload: load, setData };
}

/** Runs an action, toasts errors, returns the result or undefined. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast(ok); return r; }
    catch (e: any) { toast(e instanceof ApiError ? e.message : 'Something went wrong', true); return undefined; }
    finally { setBusy(false); }
  }, [toast]);
  return { run, busy };
}

/* ---------- modal ---------- */
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return (<>
    <div className="scrim" onClick={onClose} />
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: 'min(1000px, calc(100% - 24px))' } : undefined}>
      <div className="mh"><h2>{title}</h2><button className="iconbtn" onClick={onClose} aria-label="Close" title="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button></div>
      <div className="mb">{children}</div>
      {footer && <div className="mf">{footer}</div>}
    </div>
  </>);
}

/* ---------- small pieces ---------- */
export const Score = ({ v }: { v: number }) => <span className={`score ${v >= 75 ? '' : v >= 55 ? 'mid' : 'low'}`}><i><b style={{ width: `${v}%` }} /></i>{v}</span>;

export function StagePill({ stage, status }: { stage: string; status?: string }) {
  if (status === 'REJECTED') return <span className="pill r">Rejected</span>;
  if (status === 'HOLD') return <span className="pill a">{human(stage)} · on hold</span>;
  const i = STAGES.indexOf(stage as any);
  return <span className={`pill ${i >= 7 ? 'g' : i >= 3 ? 'b' : ''}`}>{human(stage)}</span>;
}

export const Skills = ({ matched = [], missing = [], extra = [] }: { matched?: string[]; missing?: string[]; extra?: string[] }) => (
  <>{matched.map((s) => <span key={'m' + s} className="chip hit">{s}</span>)}{missing.map((s) => <span key={'x' + s} className="chip miss">{s}</span>)}{extra.map((s) => <span key={'e' + s} className="chip">{s}</span>)}</>
);

export const Page = ({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) => (
  <><header className="pagehead"><div className="titles"><h1>{title}</h1>{sub && <p>{sub}</p>}</div><div className="row">{actions}</div></header><div className="page">{children}</div></>
);

/** Link to an external help page, opens in a new tab. */
export const Ext = ({ href, children }: { href: string; children: ReactNode }) => (
  <a className="extlink" href={href} target="_blank" rel="noreferrer">{children}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" /></svg></a>
);

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
