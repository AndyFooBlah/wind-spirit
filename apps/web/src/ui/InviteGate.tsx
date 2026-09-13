import { useEffect, useState, type ReactNode } from 'react';
import { checkInvite, redeemInvite, storedInvite } from '../invite.ts';

/** Wind Spirit is invitation-only while it is in preview: every chief decision is a paid model call. */
export function InviteGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'open' | 'closed'>(storedInvite() ? 'open' : 'checking');
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  useEffect(() => { void checkInvite().then(ok => setState(ok ? 'open' : 'closed')); }, []);
  if (state === 'open') return <>{children}</>;
  const submit = async () => {
    setBusy(true); setError(undefined);
    try { await redeemInvite(code); setState('open'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="gallery">
      <div className="hero">
        <h1>Wind Spirit</h1>
        <p>Every village here is run by a chief who thinks out loud on a language model, and every thought costs a little money. So the world is open by invitation while it is in preview.</p>
      </div>
      <div className="cards">
        <form className="card invite" onSubmit={e => { e.preventDefault(); void submit(); }}>
          <h2>Your invitation</h2>
          <label>Code <input value={code} onChange={e => setCode(e.target.value)} placeholder="amber-heron-42" autoFocus autoComplete="off" spellCheck={false} /></label>
          {error && <div className="warn">{error}</div>}
          {state === 'checking' && !error && <div className="small muted">Checking this browser for a seat…</div>}
          <button type="submit" className="primary" disabled={busy || !code.trim()}>{busy ? 'Asking…' : 'Enter'}</button>
          <div className="small muted">The seat belongs to this browser. Clearing site data means entering the code again, and each code has a limited number of seats.</div>
        </form>
      </div>
    </div>
  );
}
