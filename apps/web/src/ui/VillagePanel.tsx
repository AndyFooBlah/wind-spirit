import { useState } from 'react';
import { WEEKS_PER_YEAR } from '@wind-spirit/sim';
import { SEASON_NAMES, type PersonView } from '../sim/protocol.ts';
import { lineageColour } from '../map/lineage.ts';
import { Icon } from './icons.tsx';
import { useGame, selectVillage, openWhisper, dreamStart, setZoom, viewDetail, tellStory, narrativeKey, tickLabel, type NarrativeSpan, type NarrativeStyle } from '../store/game.ts';

type Tab = 'overview' | 'people' | 'stores' | 'history' | 'journal' | 'chronicle';

/** Everything the spirit sees of one village, plus the door to speak with its chief. */
export function VillagePanel() {
  const selected = useGame(s => s.selected); const detail = useGame(viewDetail); const frame = useGame(s => s.frame); const history = useGame(s => s.history);
  const journals = useGame(s => s.journals); const pending = useGame(s => s.pendingClaims); const dream = useGame(s => s.dream);
  const [tab, setTab] = useState<Tab>('overview');
  if (selected === undefined) return null;
  const summary = frame?.villages.find(v => v.id === selected);
  if (!detail || detail.id !== selected) return <aside className="panel"><div className="panel-head"><h2>{summary?.name ?? '…'}</h2><button className="ghost" onClick={() => selectVillage(undefined)}>×</button></div><div className="muted">{history ? 'Remembering…' : 'Looking closer…'}</div></aside>;
  const v = detail.view; const p = v.people;
  const mine = journals.filter(j => j.village === selected && (!history || j.tick < history.tick)).slice().reverse();
  const myPending = pending.filter(c => c.village === selected).flatMap(c => c.texts);
  const tabs: [Tab, string][] = [['overview', 'Village'], ['people', `People (${detail.people.length})`], ['stores', 'Stores & craft'], ['history', 'History'], ['journal', `Journal${mine.length ? ` (${mine.length})` : ''}`], ['chronicle', `Chronicle${detail.chronicle.length + myPending.length ? ` (${detail.chronicle.length + myPending.length})` : ''}`]];
  return (
    <aside className="panel">
      <div className="panel-head">
        <div><h2><span className="pennant" style={{ background: lineageColour(summary?.lineage ?? detail.id) }} title={summary && summary.parent >= 0 ? 'a colony: it carries its parent\'s colour' : 'a founding village'} />{v.village.name}</h2><div className="small muted">{history ? <span className="hist">{tickLabel(detail.tick)} — history</span> : detail.alive ? `founded year ${v.village.founded} · ${v.season}, year ${v.year}` : 'this village is gone'}</div></div>
        <div className="row"><button className="ghost" onClick={() => setZoom('village')} title="Zoom to the village plots">Plots</button><button className="ghost" onClick={() => selectVillage(undefined)} title="Close">×</button></div>
      </div>
      <div className="stat-row">
        <Stat label="People" value={p.total} sub={`${p.children} ch · ${p.adults} ad · ${p.elders} el`} />
        <Stat label="Food" value={`${v.foodWeeks}w`} sub={v.storageWords} warn={v.foodWeeks < 4} />
        <Stat label="Hungry" value={p.hungryNow} warn={p.hungryNow > 0} sub={`${p.deathsRecent} deaths this season`} />
        <Stat label="Mood" value={p.happiness} sub={p.shelterWords} />
      </div>
      <div className="trust" title={`trust ${(v.spirit.trust / 10).toFixed(0)} of 100`}>
        <div className="small"><span className="strong">The chief:</span> {v.spirit.attitude}.</div>
        <div className="bar"><div style={{ width: `${v.spirit.trust / 10}%` }} /></div>
      </div>
      {detail.alive && !history && (
        <div className="speak">
          <button className="primary" onClick={() => openWhisper(selected)} disabled={!!dream}>Whisper</button>
          <button className="primary" onClick={() => dreamStart(selected)} disabled={!!dream}>Dream (pauses)</button>
        </div>
      )}
      <nav className="tabs">{tabs.map(([t, l]) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>)}</nav>
      <div className="panel-body">
        {tab === 'overview' && (
          <>
            <Section title="Standing orders">{v.orders.length ? <ul>{v.orders.map((o, i) => <li key={i}>{o}</li>)}</ul> : <div className="muted">none; adults forage as they please</div>}</Section>
            <Section title="Skills"><Skills ids={detail.tech.capabilities} names={v.capabilities} /></Section>
            <Section title="Buildings">{v.plots.structures.join(', ') || 'tents only'} · {v.plots.cleared} plots cleared, {v.plots.planted} planted</Section>
            <Section title="Parties out">{v.parties.length ? <ul>{v.parties.map((x, i) => <li key={i}>{x.size} on a {x.kind} to {x.destination}, {x.status}</li>)}</ul> : <span className="muted">none</span>}</Section>
            <Section title="Other villages">{v.villages.length ? <ul>{v.villages.map(x => <li key={x.id}>{x.name}: {x.days} days {x.direction}; seen {x.sizeSeen} people {x.lastSeenYearsAgo < 99 ? `${x.lastSeenYearsAgo} years ago` : 'never'}; trades {x.trades}, raids {x.raids}; grudge {x.grudge}</li>)}</ul> : <span className="muted">knows of none</span>}</Section>
            <Section title="Around the village">{v.surroundings}</Section>
            <Section title="Chief's notes">{v.memory.length ? <ul>{v.memory.map((m, i) => <li key={i}>{m}</li>)}</ul> : <span className="muted">none yet</span>}</Section>
            {detail.inbox.length > 0 && <Section title="Unheard whispers">{detail.inbox.map((m, i) => <div key={i} className="quote">“{m}”</div>)}</Section>}
          </>
        )}
        {tab === 'people' && <People people={detail.people} />}
        {tab === 'stores' && (
          <>
            <Section title="Stores">
              <table><thead><tr><th>Good</th><th>Units</th><th>Kind</th><th>Keeps</th></tr></thead>
                <tbody>{v.stores.map(s => <tr key={s.name}><td><span className="goods"><Icon kind="goods" name={s.category} title={s.category} /> {s.name}</span></td><td className="num">{s.units}</td><td>{s.category}{s.food ? ', food' : ''}</td><td>{s.keeps}</td></tr>)}</tbody></table>
              {!v.stores.length && <div className="muted">empty</div>}
            </Section>
            <Section title="Known recipes">
              <ul>{v.recipes.map(r => <li key={r.id}><span className="strong">{r.name}</span>: {r.inputs}{r.requires ? ` + ${r.requires}` : ''} → {r.makes}{r.held ? ' (held)' : r.canMakeNow ? ' (could make now)' : ''}</li>)}</ul>
            </Section>
            <Section title="Rumours (hints not yet worked out)">{v.rumors.length ? <ul>{v.rumors.map((r, i) => <li key={i}>{r}</li>)}</ul> : <span className="muted">none</span>}</Section>
          </>
        )}
        {tab === 'history' && (
          <>
            <Story village={selected} />
            {detail.feed.length ? detail.feed.map(g => <Section key={g.tick} title={g.when}><ul>{g.lines.map((l, i) => <li key={i}>{l}</li>)}</ul></Section>) : <div className="muted">Nothing yet; let the weeks turn.</div>}
          </>
        )}
        {tab === 'journal' && (mine.length ? mine.map((j, i) => (
          <div key={i} className={`journal ${j.source}`}>
            <div className="small muted">Year {Math.floor(j.tick / WEEKS_PER_YEAR)}, {SEASON_NAMES[Math.floor((j.tick % WEEKS_PER_YEAR) / 13)]} · {j.reason} · <span className={`tag ${j.source}`}>{j.source === 'model' ? 'deliberated' : 'habit'}</span></div>
            <div>{j.text}</div>
            {j.dropped?.length ? <div className="small warn">dropped: {j.dropped.join('; ')}</div> : null}
          </div>
        )) : <div className="muted">The chief has not written yet. Chiefs deliberate each season and on events; only focused villages use the model.</div>)}
        {tab === 'chronicle' && (
          <>
            {myPending.map((t, i) => <div key={`p${i}`} className="claim pending"><div className="small muted">recorded when the week turns</div>“{t}”</div>)}
            {detail.chronicle.slice().reverse().map(c => (
              <div key={c.id} className={`claim ${c.outcome}`}>
                <div className="small muted">said year {Math.floor(c.tick / WEEKS_PER_YEAR)} · due year {Math.floor(c.due / WEEKS_PER_YEAR)} {SEASON_NAMES[Math.floor((c.due % WEEKS_PER_YEAR) / 13)]} · {c.check.kind === 'weather' ? `weather: ${c.check.roll}` : c.check.kind === 'judged' ? 'the chief judges' : 'unverifiable'} · <span className={`tag ${c.outcome}`}>{c.outcome}</span></div>
                “{c.text}”
              </div>
            ))}
            {!detail.chronicle.length && !myPending.length && <div className="muted">The spirit has made no claims here. Claims come from dreams; the sim scores weather claims, the chief judges the rest.</div>}
          </>
        )}
      </div>
    </aside>
  );
}

/** Narrative synthesis over a span, by the capable model; cached per span. */
function Story({ village }: { village: number }) {
  const [span, setSpan] = useState<NarrativeSpan>('y10'); const [style, setStyle] = useState<NarrativeStyle>('chronicle');
  const toTick = useGame(s => s.history?.tick ?? s.frame?.tick); const narratives = useGame(s => s.narratives);
  if (toTick === undefined) return null;
  const key = narrativeKey(village, span, style, toTick); const n = narratives[key];
  return (
    <section className="sec story">
      <div className="row">
        <select value={span} onChange={e => setSpan(e.target.value as NarrativeSpan)} aria-label="Span"><option value="y10">last 10 years</option><option value="y50">last 50 years</option><option value="all">since founding</option></select>
        <select value={style} onChange={e => setStyle(e.target.value as NarrativeStyle)} aria-label="Style"><option value="chronicle">chronicle</option><option value="saga">saga</option><option value="plain">plain</option></select>
        <button className="primary" disabled={n?.loading} onClick={() => void tellStory(village, span, style)}>{n?.loading ? 'Writing…' : n?.text ? 'Told' : 'Tell the story'}</button>
      </div>
      {n?.loading && <div className="small muted spinner">The scribe is writing…</div>}
      {n?.error && <div className="small warn">Could not tell the story: {n.error}</div>}
      {n?.text && <div className="narrative">{n.text}</div>}
    </section>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string | number; sub?: string; warn?: boolean }) {
  return <div className={`stat ${warn ? 'warn' : ''}`}><div className="small muted">{label}</div><div className="big">{value}</div>{sub && <div className="small muted">{sub}</div>}</div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="sec"><h3>{title}</h3><div>{children}</div></section>; }

type PeopleKey = 'name' | 'age' | 'stage' | 'doing';
const STAGE_ORDER = { child: 0, adult: 1, elder: 2 };
/** Everyone in the village, sortable: who they are, how old, what they are doing this week and where. */
function People({ people }: { people: PersonView[] }) {
  const [key, setKey] = useState<PeopleKey>('doing'); const [asc, setAsc] = useState(true);
  const sorted = [...people].sort((a, b) => {
    const d = key === 'name' ? a.name.localeCompare(b.name) : key === 'age' ? a.age - b.age : key === 'stage' ? STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.age - b.age : a.doing.localeCompare(b.doing) || a.name.localeCompare(b.name);
    return asc ? d : -d;
  });
  const head = (k: PeopleKey, label: string) => <th className={key === k ? 'sorted' : ''} onClick={() => { if (key === k) setAsc(!asc); else { setKey(k); setAsc(true); } }} title="Sort">{label}{key === k ? (asc ? ' ▲' : ' ▼') : ''}</th>;
  const away = people.filter(p => p.out).length;
  return (
    <>
      <div className="small muted" style={{ marginBottom: 6 }}>{people.length} people; {away} working off the village tile this week. Click a heading to sort.</div>
      <table className="people">
        <thead><tr>{head('name', 'Name')}{head('age', 'Age')}{head('stage', 'Stage')}{head('doing', 'This week')}</tr></thead>
        <tbody>
          {sorted.map(p => (
            <tr key={p.id} className={p.out ? 'away' : ''}>
              <td>{p.name}{p.chief ? <span className="small muted"> · chief</span> : ''}</td>
              <td className="num">{p.age}</td>
              <td>{p.stage}</td>
              <td>{p.doing}{p.out ? <span className="small muted"> · away</span> : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** The village's skills, each with its glyph. Ids come from the sim; the names are the ones the chief would use. */
function Skills({ ids, names }: { ids: string[]; names: string[] }) {
  if (!names.length) return <span className="muted">bare hands</span>;
  return (
    <div className="skills">
      {names.map((name, i) => <span key={name} className="skill"><Icon kind="cap" name={ids[i] ?? ''} title={name} /> {name}</span>)}
    </div>
  );
}
