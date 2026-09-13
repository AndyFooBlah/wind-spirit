import { useMemo } from 'react';
import { WEEKS_PER_YEAR } from '@wind-spirit/sim';
import { WORK_GROUPS, type SeriesPoint, type WorkGroup } from '../sim/protocol.ts';
import { useGame, closeOverview, focusVillage, viewFrame } from '../store/game.ts';
import { lineageColour } from '../map/lineage.ts';

/** Every village at once: a table of the present, and charts of population, work and skill over the years. */
export function Overview() {
  const open = useGame(s => s.overview); const series = useGame(s => s.series); const frame = useGame(viewFrame); const backfill = useGame(s => s.seriesBackfill);
  const villages = useMemo(() => (frame ? [...frame.villages].sort((a, b) => b.pop.total - a.pop.total) : []), [frame]);
  const latest = series[series.length - 1];
  if (!open || !frame) return null;
  const colour = (id: number) => PALETTE[id % PALETTE.length];
  return (
    <div className="modal-back" onClick={closeOverview}>
      <div className="modal overview" onClick={e => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><span className="strong">The world</span> <span className="muted small">year {frame.year}, {villages.filter(v => v.alive).length} villages, {villages.reduce((a, v) => a + (v.alive ? v.pop.total : 0), 0)} people</span></div>
          <div className="row">{backfill && <span className="small muted">reading the past… {backfill.done}/{backfill.total}</span>}<button className="ghost" onClick={closeOverview}>Close</button></div>
        </div>
        <div className="overview-grid">
          <table className="villages">
            <thead><tr><th>Village</th><th className="num">People</th><th className="num">Food (weeks)</th><th>Mood</th><th className="num">Trust</th><th className="num">Skills</th><th className="num">Tier</th><th>Hands</th></tr></thead>
            <tbody>
              {villages.map(v => {
                const sv = latest?.villages.find(x => x.id === v.id);
                return (
                  <tr key={v.id} className={v.alive ? '' : 'dead'} onClick={() => { focusVillage(v.id); closeOverview(); }} title="Open this village">
                    <td><span className="swatch" style={{ background: colour(v.id) }} /><span className="swatch pennant-small" style={{ background: lineageColour(v.lineage) }} title="lineage" /> {v.name}{v.alive ? '' : ' †'}</td>
                    <td className="num">{v.alive ? v.pop.total : 0}</td>
                    <td className="num">{v.alive ? (v.foodWeeks >= 999 ? '∞' : v.foodWeeks) : ''}</td>
                    <td>{v.alive ? MOOD(v.happiness) : ''}</td>
                    <td className="num">{v.alive ? Math.round(v.trust / 10) : ''}</td>
                    <td className="num">{v.capabilities}</td>
                    <td className="num">{sv?.tier ?? ''}</td>
                    <td>{sv && v.alive ? <WorkBar work={sv.work} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="charts">
            <Chart title="People, by village and in all" series={series} villages={villages.map(v => v.id)} colour={colour} kind="pop" />
            <Chart title="Where the hands go, all villages" series={series} villages={villages.map(v => v.id)} colour={colour} kind="work" />
            <Chart title="Trust in the wind spirit (the score)" series={series} villages={villages.map(v => v.id)} colour={colour} kind="trust" />
            <Chart title="Highest recipe tier held" series={series} villages={villages.map(v => v.id)} colour={colour} kind="tier" />
          </div>
        </div>
        <div className="small muted">One reading a year. {series.length ? `${series.length} years recorded.` : 'The first reading comes at the turn of the year.'} Click a village to open it.</div>
      </div>
    </div>
  );
}

const PALETTE = ['#c9a227', '#2f6f7a', '#b3261e', '#4c9a2a', '#8c5f2a', '#6a4c93', '#d98c5f', '#3a7ca5', '#7d8898', '#a0522d', '#2e8b57', '#c71585'];
const MOOD = (h: number) => (h >= 800 ? 'joyful' : h >= 600 ? 'glad' : h >= 400 ? 'weary' : h >= 200 ? 'bitter' : 'desperate');
const WORK_COLOUR: Record<WorkGroup, string> = { food: '#8fae5a', land: '#a8804d', craft: '#c9a227', research: '#6a4c93', ventures: '#3a7ca5', rest: '#cfc6b3' };
const WORK_WORD: Record<WorkGroup, string> = { food: 'food', land: 'land and building', craft: 'crafts', research: 'research', ventures: 'ventures', rest: 'rest' };

function WorkBar({ work }: { work: Record<WorkGroup, number> }) {
  const total = WORK_GROUPS.reduce((a, g) => a + work[g], 0) || 1;
  return (
    <div className="workbar" title={WORK_GROUPS.filter(g => work[g]).map(g => `${WORK_WORD[g]} ${work[g]}`).join(', ')}>
      {WORK_GROUPS.map(g => <span key={g} style={{ width: `${(work[g] / total) * 100}%`, background: WORK_COLOUR[g] }} />)}
    </div>
  );
}

/** A small SVG chart: lines for population and tier, a stacked area for work. */
function Chart({ title, series, villages, colour, kind }: { title: string; series: SeriesPoint[]; villages: number[]; colour: (id: number) => string; kind: 'pop' | 'work' | 'tier' | 'trust' }) {
  const W = 420, H = 150, L = 34, B = 18, T = 6;
  const pts = series; const n = pts.length;
  const x = (i: number) => L + (n > 1 ? (i / (n - 1)) * (W - L - 6) : 0);
  let body: JSX.Element | null = null; let ymax = 1; let legend: JSX.Element | null = null;
  if (n >= 1 && kind === 'pop') {
    const totals = pts.map(p => p.villages.reduce((a, v) => a + (v.alive ? v.pop : 0), 0));
    ymax = Math.max(10, ...totals);
    const y = (v: number) => T + (1 - v / ymax) * (H - T - B);
    body = (
      <>
        {villages.map(id => <polyline key={id} fill="none" stroke={colour(id)} strokeWidth={1.4} points={pts.map((p, i) => `${x(i)},${y(p.villages.find(v => v.id === id)?.pop ?? 0)}`).join(' ')} />)}
        <polyline fill="none" stroke="#222" strokeWidth={2} strokeDasharray="4 2" points={pts.map((p, i) => `${x(i)},${y(totals[i])}`).join(' ')} />
      </>
    );
    legend = <span className="small muted">dashed: everyone</span>;
  } else if (n >= 1 && kind === 'trust') {
    ymax = 100;
    const y = (v: number) => T + (1 - v / ymax) * (H - T - B);
    const means = pts.map(p => { const a = p.villages.filter(v => v.alive); return a.length ? a.reduce((s, v) => s + v.trust, 0) / a.length / 10 : 0; });
    body = (
      <>
        {villages.map(id => <polyline key={id} fill="none" stroke={colour(id)} strokeWidth={1.4} points={pts.map((p, i) => { const v = p.villages.find(x => x.id === id); return `${x(i)},${y(v && v.alive ? v.trust / 10 : 0)}`; }).join(' ')} />)}
        <polyline fill="none" stroke="#222" strokeWidth={2} strokeDasharray="4 2" points={pts.map((_, i) => `${x(i)},${y(means[i])}`).join(' ')} />
      </>
    );
    legend = <span className="small muted">dashed: the mean, which is the score</span>;
  } else if (n >= 1 && kind === 'tier') {
    ymax = Math.max(4, ...pts.flatMap(p => p.villages.map(v => v.tier)));
    const y = (v: number) => T + (1 - v / ymax) * (H - T - B);
    body = <>{villages.map(id => <polyline key={id} fill="none" stroke={colour(id)} strokeWidth={1.4} points={pts.map((p, i) => `${x(i)},${y(p.villages.find(v => v.id === id)?.tier ?? 0)}`).join(' ')} />)}</>;
  } else if (n >= 1 && kind === 'work') {
    ymax = 1;
    const y = (v: number) => T + (1 - v) * (H - T - B);
    const shares = pts.map(p => { const sum: Record<WorkGroup, number> = { food: 0, land: 0, craft: 0, research: 0, ventures: 0, rest: 0 }; for (const v of p.villages) if (v.alive) for (const g of WORK_GROUPS) sum[g] += v.work[g]; const t = WORK_GROUPS.reduce((a, g) => a + sum[g], 0) || 1; return WORK_GROUPS.map(g => sum[g] / t); });
    let base = shares.map(() => 0);
    body = (
      <>
        {WORK_GROUPS.map((g, gi) => {
          const top = base.map((b, i) => b + shares[i][gi]);
          const path = pts.map((_, i) => `${x(i)},${y(top[i])}`).join(' ') + ' ' + pts.map((_, i) => `${x(n - 1 - i)},${y(base[n - 1 - i])}`).join(' ');
          base = top;
          return <polygon key={g} fill={WORK_COLOUR[g]} stroke="none" points={path} />;
        })}
      </>
    );
    legend = <span className="small muted">{WORK_GROUPS.map(g => <span key={g}><span className="swatch" style={{ background: WORK_COLOUR[g] }} /> {WORK_WORD[g]} </span>)}</span>;
  }
  const years = n ? [pts[0].tick, pts[n - 1].tick].map(t => Math.floor(t / WEEKS_PER_YEAR)) : [0, 0];
  return (
    <div className="chart">
      <div className="small strong">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title}>
        <line x1={L} y1={T} x2={L} y2={H - B} stroke="#999" /><line x1={L} y1={H - B} x2={W - 6} y2={H - B} stroke="#999" />
        <text x={L - 4} y={T + 8} fontSize={9} textAnchor="end" fill="#555">{kind === 'work' ? '100%' : ymax}</text>
        <text x={L - 4} y={H - B} fontSize={9} textAnchor="end" fill="#555">0</text>
        <text x={L} y={H - 4} fontSize={9} fill="#555">year {years[0]}</text><text x={W - 6} y={H - 4} fontSize={9} textAnchor="end" fill="#555">year {years[1]}</text>
        {body ?? <text x={W / 2} y={H / 2} fontSize={11} textAnchor="middle" fill="#777">no readings yet</text>}
      </svg>
      {legend}
    </div>
  );
}
