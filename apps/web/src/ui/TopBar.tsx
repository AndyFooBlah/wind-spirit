import { useState } from 'react';
import type { BreathAction, SeasonRoll } from '@wind-spirit/sim';
import { P } from '@wind-spirit/sim';
import { BUSES, type Bus } from '@wind-spirit/audio';
import { DIR_NAMES, ROLL_WORDS, SEASON_NAMES, SPEEDS, SPEED_LABEL, type Speed } from '../sim/protocol.ts';
import { useGame, setSpeed, step, leaveWorld, setZoom, focusVillage, breathe, setTargeting, updateSettings, updateAudio, enterHistory, exitHistory, scrubTo, tickLabel, viewFrame, openOverview, openSun, sunQuestionsLeft, focusVillage as goVillage, setTechOpen, type Zoom } from '../store/game.ts';

const KEY: Record<Speed, string> = { pause: 'space', step: '.', slow: '1', normal: '2', fast: '3', veryfast: '4' };

export function TopBar() {
  const world = useGame(s => s.world); const frame = useGame(s => s.frame); const speed = useGame(s => s.speed); const dream = useGame(s => s.dream);
  const waiting = useGame(s => s.waiting); const shown = useGame(viewFrame);   // the year-wheel and weather follow the viewed moment (history or live)
  return (
    <header className="topbar">
      <div className="brand">
        <button className="ghost" onClick={() => void leaveWorld()} title="Back to the gallery">‹ Worlds</button>
        <div><div className="world-name">{world?.name ?? 'Wind Spirit'}</div><div className="muted small">seed {world?.seed}</div></div>
      </div>
      {shown && <YearWheel season={shown.season} week={shown.week} year={shown.year} />}
      {shown && <WeatherStrip rolls={shown.rolls} seasons={shown.rollSeasons} wind={shown.wind} />}
      <div className="speeds" role="group" aria-label="Speed">
        {SPEEDS.map(sp => (
          <button key={sp} className={`speed ${speed === sp ? 'on' : ''}`} disabled={!!dream} title={`${SPEED_LABEL[sp]} (${KEY[sp]})`} onClick={() => (sp === 'step' ? step() : setSpeed(sp))}>{SPEED_LABEL[sp]}</button>
        ))}
        {waiting.length > 0 && speed !== 'pause' && <span className="waiting small" title="Time waits a moment for a chief who is still deliberating">waiting for {waiting.map(id => frame?.villages.find(v => v.id === id)?.name ?? id).join(', ')}…</span>}
      </div>
      {frame && <Breath breath={frame.breath} rolls={frame.rolls} seasons={frame.rollSeasons} />}
      {frame && <Trust />}
      <SunButton />
      <ZoomControl />
      <OverviewButton />
      <TechButton />
      <HistoryButton />
      <SoundMenu />
      <SettingsMenu />
    </header>
  );
}

/** Trust is the score: the mean over living chiefs, with each chief on click. */
function Trust() {
  const [open, setOpen] = useState(false); const shown = useGame(viewFrame);
  const alive = shown?.villages.filter(v => v.alive) ?? [];
  const mean = alive.length ? alive.reduce((a, v) => a + v.trust, 0) / alive.length / 10 : 0;
  const word = (t: number) => (t >= 80 ? 'devoted' : t >= 60 ? 'trusting' : t >= 40 ? 'wary' : t >= 20 ? 'doubting' : 'scornful');
  return (
    <div className="trust">
      <button className={open ? 'on' : 'ghost'} onClick={() => setOpen(!open)} title="How far the chiefs trust the wind spirit: the score">Trust {Math.round(mean)} <span className="small muted">{word(mean)}</span></button>
      {open && (
        <div className="popover">
          <div className="strong">Trust in the wind spirit, chief by chief</div>
          {alive.sort((a, b) => b.trust - a.trust).map(v => (
            <div key={v.id} className="row trustrow" onClick={() => { goVillage(v.id); setOpen(false); }} title="Open this village">
              <span className="w">{v.name}</span>
              <div className="bar"><div className="fill" style={{ width: `${v.trust / 10}%` }} /></div>
              <span className="num small">{Math.round(v.trust / 10)}</span>
            </div>
          ))}
          <div className="small muted">Claims that come true raise it; claims that fail lower it; a chief's own nature sets the starting point.</div>
        </div>
      )}
    </div>
  );
}

function SunButton() {
  const frame = useGame(s => s.frame); const open = useGame(s => s.sun.open); const left = useGame(sunQuestionsLeft); const asking = useGame(s => !!s.sun.asking);
  return <button className={open ? 'on' : 'ghost'} disabled={!frame} onClick={() => openSun(!open)} title="Ask the sun spirit, who sees everything: three questions a year">Sun {asking ? '…' : left}</button>;
}

function TechButton() {
  const map = useGame(s => s.map); const open = useGame(s => s.techOpen);
  return <button className={open ? 'on' : 'ghost'} disabled={!map} onClick={() => setTechOpen(!open)} title="The tree of recipes, with the open village's knowledge laid over it">Tech</button>;
}

function OverviewButton() {
  const frame = useGame(s => s.frame); const open = useGame(s => s.overview);
  return <button className={open ? 'on' : 'ghost'} disabled={!frame} onClick={openOverview} title="Every village at once, with charts over the years">Overview</button>;
}

function HistoryButton() {
  const history = useGame(s => s.history); const frame = useGame(s => s.frame); const dream = useGame(s => s.dream);
  return <button className={history ? 'on' : 'ghost'} disabled={!frame || !!dream} onClick={() => (history ? exitHistory() : enterHistory())} title="Scrub back through this world's past (the live world pauses)">History</button>;
}

/** The scrubber: a timeline over every week so far. Seeking replays from the nearest yearly snapshot in a second worker. */
export function HistoryBar() {
  const history = useGame(s => s.history); const frame = useGame(s => s.frame);
  if (!history || !frame) return null;
  const max = frame.tick; const years = Math.floor(max / 52);
  return (
    <div className="historybar">
      <span className="strong">History</span>
      <input type="range" className="scrub" min={0} max={max} step={1} value={history.target} onChange={e => scrubTo(Number(e.target.value))} aria-label="Week in history" />
      <span className="label">{history.loading && history.tick !== history.target ? `${tickLabel(history.target)} · remembering…` : `${tickLabel(history.tick)} — history`}</span>
      <div className="row small">
        {[10, 20, 50].filter(y => y <= years).map(y => <button key={y} onClick={() => scrubTo(max - y * 52)}>−{y} years</button>)}
        <button onClick={() => scrubTo(0)}>The beginning</button>
        <button className="primary" onClick={exitHistory}>Back to now</button>
      </div>
    </div>
  );
}

const BUS_LABEL: Record<Bus, string> = { master: 'Master', ambient: 'Ambient', village: 'Village', markers: 'Time', events: 'Events', spirit: 'Spirit', music: 'Music' };
function SoundMenu() {
  const [open, setOpen] = useState(false); const a = useGame(s => s.audioSettings);
  return (
    <div className="settings">
      <button className={a.muteAll ? 'ghost' : 'on'} onClick={() => updateAudio({ muteAll: !a.muteAll })} title={a.muteAll ? 'Sound is off; click to turn it on' : 'Sound is on; click to mute everything'}>{a.muteAll ? 'Sound off' : 'Sound on'}</button>
      <button className="ghost" onClick={() => setOpen(!open)} title="Sound settings">Mix</button>
      {open && (
        <div className="popover right mix">
          <div className="strong">Sound</div>
          {BUSES.map(b => (
            <div key={b} className="row bus">
              <span className="w">{BUS_LABEL[b]}</span>
              <input type="range" min={0} max={1} step={0.05} value={a.gains[b]} onChange={e => updateAudio({ gains: { ...a.gains, [b]: Number(e.target.value) } })} aria-label={`${BUS_LABEL[b]} level`} />
              <label className="small"><input type="checkbox" checked={a.mutes[b]} onChange={e => updateAudio({ mutes: { ...a.mutes, [b]: e.target.checked } })} /> mute</label>
            </div>
          ))}
          <label><input type="checkbox" checked={a.music} onChange={e => updateAudio({ music: e.target.checked })} /> generated music</label>
          <div className="small muted">The wind is you: whispers and breath sound through the spirit bus. Everything is synthesized from the seed; nothing is recorded.</div>
        </div>
      )}
    </div>
  );
}

function YearWheel({ season, week, year }: { season: number; week: number; year: number }) {
  const angle = ((season * 13 + week - 1) / 52) * 360;
  const colors = ['#7fb35a', '#e8b84a', '#c9803a', '#a9c4de'];
  return (
    <div className="yearwheel" title={`Year ${year}, ${SEASON_NAMES[season]}, week ${week} of 13`}>
      <svg viewBox="0 0 40 40" width="40" height="40">
        {colors.map((c, i) => { const a0 = (i / 4) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / 4) * Math.PI * 2 - Math.PI / 2; const x0 = 20 + 18 * Math.cos(a0), y0 = 20 + 18 * Math.sin(a0), x1 = 20 + 18 * Math.cos(a1), y1 = 20 + 18 * Math.sin(a1); return <path key={i} d={`M20 20 L${x0} ${y0} A18 18 0 0 1 ${x1} ${y1} Z`} fill={c} opacity={i === season ? 1 : 0.45} />; })}
        <circle cx="20" cy="20" r="8" fill="#1f242b" />
        <line x1="20" y1="20" x2={20 + 17 * Math.cos((angle - 90) * Math.PI / 180)} y2={20 + 17 * Math.sin((angle - 90) * Math.PI / 180)} stroke="#f7efe0" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div><div className="strong">Year {year}</div><div className="small muted">{SEASON_NAMES[season]}, week {week}</div></div>
    </div>
  );
}

function RollIcon({ roll }: { roll: SeasonRoll }) {
  const c = roll === 'drought' ? '#e0a040' : roll === 'wet' ? '#4f86b8' : roll === 'hard' ? '#a9c4de' : roll === 'storm' ? '#8d7fb5' : '#8fae5a';
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
      {roll === 'normal' && <circle cx="10" cy="10" r="6" fill={c} />}
      {roll === 'drought' && <><circle cx="10" cy="10" r="5" fill={c} /><g stroke={c} strokeWidth="1.5">{[0, 45, 90, 135].map(a => <line key={a} x1={10 + 7 * Math.cos(a * Math.PI / 180)} y1={10 + 7 * Math.sin(a * Math.PI / 180)} x2={10 - 7 * Math.cos(a * Math.PI / 180)} y2={10 - 7 * Math.sin(a * Math.PI / 180)} />)}</g></>}
      {roll === 'wet' && <path d="M10 3 C6 9 5 11 5 13 a5 5 0 0 0 10 0 c0-2-1-4-5-10z" fill={c} />}
      {roll === 'hard' && <g stroke={c} strokeWidth="1.8" strokeLinecap="round"><line x1="10" y1="3" x2="10" y2="17" /><line x1="4" y1="6.5" x2="16" y2="13.5" /><line x1="4" y1="13.5" x2="16" y2="6.5" /></g>}
      {roll === 'storm' && <><path d="M5 12 a4 4 0 0 1 1-8 a5 5 0 0 1 9 1 a3.5 3.5 0 0 1 0 7z" fill={c} /><path d="M9 12 l-2 5 h3 l-1 3 l4 -6 h-3 l1 -2z" fill="#ffd166" /></>}
    </svg>
  );
}

function WeatherStrip({ rolls, seasons, wind }: { rolls: SeasonRoll[]; seasons: number[]; wind: number[] }) {
  return (
    <div className="weather" title="The season now and the four ahead. The spirit sees what chiefs cannot.">
      {rolls.map((r, i) => (
        <div key={i} className={`roll ${i === 0 ? 'now' : ''}`}>
          <RollIcon roll={r} />
          <div className="small">{SEASON_NAMES[seasons[i] % 4]}</div>
          <div className="small strong">{ROLL_WORDS[r]}</div>
          <div className="small muted">wind {DIR_NAMES[wind[i] ?? 0]}</div>
        </div>
      ))}
    </div>
  );
}

function Breath({ breath, rolls, seasons }: { breath: number; rolls: SeasonRoll[]; seasons: number[] }) {
  const [open, setOpen] = useState<'' | 'nudge' | 'override' | 'sail'>('');
  const frame = useGame(s => s.frame); const targeting = useGame(s => s.targeting);
  const cost = { nudge: P.breathNudge / 1000, override: P.breathOverride / 1000, storm: P.breathStorm / 1000, sail: P.breathSail / 1000 };
  const boats = frame?.parties.filter(p => p.boat) ?? [];
  const go = (a: BreathAction) => { if (breathe(a)) setOpen(''); };
  return (
    <div className="breath">
      <div className="meter" title={`Breath ${breath.toFixed(1)} of 100; +0.25 a week`}>
        <div className="fill" style={{ width: `${Math.max(0, Math.min(100, breath))}%` }} />
        <span>Breath {Math.floor(breath)}</span>
      </div>
      <div className="actions">
        <button className={open === 'nudge' ? 'on' : ''} disabled={breath < cost.nudge} onClick={() => setOpen(open === 'nudge' ? '' : 'nudge')} title={`Nudge a coming season one step (${cost.nudge})`}>Nudge {cost.nudge}</button>
        <button className={open === 'override' ? 'on' : ''} disabled={breath < cost.override} onClick={() => setOpen(open === 'override' ? '' : 'override')} title={`Set a coming season outright (${cost.override})`}>Override {cost.override}</button>
        <button className={targeting ? 'on' : ''} disabled={breath < cost.storm} onClick={() => { setOpen(''); setTargeting(!targeting); }} title={`A storm on one tile for one week (${cost.storm})`}>Storm {cost.storm}</button>
        <button className={open === 'sail' ? 'on' : ''} disabled={breath < cost.sail || !boats.length} onClick={() => setOpen(open === 'sail' ? '' : 'sail')} title={boats.length ? `Fill or becalm a boat's sails (${cost.sail})` : 'No boats at sea'}>Sail {cost.sail}</button>
      </div>
      {open === 'nudge' && (
        <div className="popover">
          <div className="strong">Nudge a season</div>
          {seasons.slice(1).map((s, i) => (
            <div key={s} className="row">
              <span className="w">{SEASON_NAMES[s % 4]} <span className="muted">({ROLL_WORDS[rolls[i + 1]]})</span></span>
              <button onClick={() => go({ kind: 'nudge', season: s, direction: 'wetter' })}>wetter</button>
              <button onClick={() => go({ kind: 'nudge', season: s, direction: 'drier' })}>drier</button>
              {s % 4 === 3 && <><button onClick={() => go({ kind: 'nudge', season: s, direction: 'milder' })}>milder</button><button onClick={() => go({ kind: 'nudge', season: s, direction: 'harsher' })}>harsher</button></>}
            </div>
          ))}
          <div className="small muted">Wetter: drought → fair → wet. Milder and harsher only touch winters.</div>
        </div>
      )}
      {open === 'override' && (
        <div className="popover">
          <div className="strong">Set a season</div>
          {seasons.slice(1).map((s, i) => (
            <div key={s} className="row">
              <span className="w">{SEASON_NAMES[s % 4]} <span className="muted">({ROLL_WORDS[rolls[i + 1]]})</span></span>
              {(['drought', 'normal', 'wet', 'storm', ...(s % 4 === 3 ? ['hard'] : [])] as SeasonRoll[]).map(r => <button key={r} onClick={() => go({ kind: 'override', season: s, roll: r })}>{ROLL_WORDS[r]}</button>)}
            </div>
          ))}
        </div>
      )}
      {open === 'sail' && (
        <div className="popover">
          <div className="strong">Boats at sea</div>
          {boats.map(b => (
            <div key={b.id} className="row">
              <span className="w">{b.kind} party of {b.size} from {frame?.villages.find(v => v.id === b.home)?.name}{b.returning ? ', homeward' : ''}</span>
              <button onClick={() => go({ kind: 'sail', party: b.id, mode: 'fill' })}>fill sails</button>
              <button onClick={() => go({ kind: 'sail', party: b.id, mode: 'becalm' })}>becalm</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ZoomControl() {
  const zoom = useGame(s => s.zoom); const frame = useGame(s => s.frame); const selected = useGame(s => s.selected);
  const zooms: Zoom[] = ['world', 'local', 'village'];
  return (
    <div className="zoomctl">
      <div className="seg">{zooms.map(z => <button key={z} className={zoom === z ? 'on' : ''} disabled={z === 'village' && selected === undefined} onClick={() => setZoom(z)}>{z}</button>)}</div>
      <select value="" onChange={e => { const id = Number(e.target.value); if (!Number.isNaN(id)) focusVillage(id); }} title="Find a village">
        <option value="">Find village…</option>
        {frame?.villages.filter(v => v.alive).map(v => <option key={v.id} value={v.id}>{v.name} ({v.pop.total})</option>)}
      </select>
    </div>
  );
}

function SettingsMenu() {
  const [open, setOpen] = useState(false); const settings = useGame(s => s.settings); const proxyOk = useGame(s => s.proxyOk);
  return (
    <div className="settings">
      <button className="ghost" onClick={() => setOpen(!open)} title="Settings">Settings</button>
      {open && (
        <div className="popover right">
          <div className="strong">Chiefs that think with the model</div>
          <label><input type="radio" checked={settings.modelVillages === 'none'} onChange={() => updateSettings({ modelVillages: 'none' })} /> none (habit only)</label>
          <label><input type="radio" checked={settings.modelVillages === 'focused'} onChange={() => updateSettings({ modelVillages: 'focused' })} /> focused: the village you have open plus the ones you have spoken to (up to 3)</label>
          <label><input type="radio" checked={settings.modelVillages === 'all'} onChange={() => updateSettings({ modelVillages: 'all' })} /> all villages <span className="warn">(costly at speed)</span></label>
          <div className="small muted">Model access: {proxyOk === undefined ? 'not yet used' : proxyOk ? 'signed in' : 'unavailable, chiefs act on habit'}</div>
          <div className="strong" style={{ marginTop: 10 }}>How much thinking to buy</div>
          {([['habit', 'habit: scripted chiefs, the model only for dreams (free)'], ['thrifty', 'thrifty: the cheapest model for routine seasons, a better one for hard choices (~$1 a century per chief)'], ['standard', 'standard: a light model for routine seasons, the full one for hard choices (~$5 a century)'], ['lavish', 'lavish: the full model everywhere, the most capable one for hard choices and dreams (~$16 a century)']] as const).map(([k, label]) => (
            <label key={k}><input type="radio" checked={(settings.tier ?? 'standard') === k} onChange={() => updateSettings({ tier: k })} /> {label}</label>
          ))}
          <div className="strong" style={{ marginTop: 10 }}>Pause when</div>
          {(Object.keys(settings.autoPause) as (keyof typeof settings.autoPause)[]).map(k => (
            <label key={k}><input type="checkbox" checked={settings.autoPause[k]} onChange={e => updateSettings({ autoPause: { ...settings.autoPause, [k]: e.target.checked } })} /> {PAUSE_LABEL[k]}</label>
          ))}
          <div className="small muted" style={{ marginTop: 8 }}>Keys: space pause, . step, 1–4 speeds, arrows pan, double-click zooms in.</div>
        </div>
      )}
    </div>
  );
}
const PAUSE_LABEL: Record<string, string> = { RaidResolved: 'raiders strike', Famine: 'famine (first each season)', ChiefSucceeded: 'a chief dies or falls', VillageFounded: 'a village is founded', VillageDied: 'a village dies', Prayer: 'a chief prays', StormStruck: 'a storm strikes', Discovered: 'a discovery' };
