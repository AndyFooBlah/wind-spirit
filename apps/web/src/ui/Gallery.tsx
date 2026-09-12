import { useEffect, useState } from 'react';
import { WEEKS_PER_YEAR } from '@wind-spirit/sim';
import { useGame, refreshWorlds, newWorld, continueWorld, removeWorld } from '../store/game.ts';

/** Start screen: new world from a seed, continue a saved one, or delete it. */
export function Gallery() {
  const worlds = useGame(s => s.worlds); const loading = useGame(s => s.loading);
  const [seed, setSeed] = useState(''); const [name, setName] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { void refreshWorlds(); }, []);
  const create = async () => { setBusy(true); try { await newWorld(seed, name); } finally { setBusy(false); } };
  return (
    <div className="gallery">
      <div className="hero">
        <h1>Wind Spirit</h1>
        <p>Every village is run by a chief who sees only what their people have seen. You are a spirit who sees everything and can touch almost nothing: you speak, and you spend a little breath on the wind and the weather. Trust is the only score.</p>
      </div>
      <div className="cards">
        <form className="card" onSubmit={e => { e.preventDefault(); void create(); }}>
          <h2>A new world</h2>
          <label>Seed <input value={seed} onChange={e => setSeed(e.target.value)} placeholder="any words; the same seed makes the same world" /></label>
          <label>Name <input value={name} onChange={e => setName(e.target.value)} placeholder="optional" /></label>
          <div className="small muted">64 × 64 tiles, four villages of twenty. Leave the seed empty for a random one.</div>
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Shaping…' : 'Wake'}</button>
        </form>
        <section className="card">
          <h2>Saved worlds</h2>
          {loading && <div className="warn">{loading}</div>}
          {!worlds.length && !loading && <div className="muted">None yet. Worlds pause when you leave and resume where they were.</div>}
          <ul className="worlds">
            {worlds.map(w => (
              <li key={w.id}>
                <div><div className="strong">{w.name}</div><div className="small muted">seed {w.seed} · year {Math.floor(w.lastTick / WEEKS_PER_YEAR)}, week {w.lastTick % WEEKS_PER_YEAR} · saved {new Date(w.updatedAt).toLocaleString()}</div></div>
                <div className="row"><button className="primary" onClick={() => void continueWorld(w.id)}>Continue</button><button className="ghost" onClick={() => { if (confirm(`Delete "${w.name}"? Its history goes with it.`)) void removeWorld(w.id); }}>Delete</button></div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
