import { runOne, type RunResult } from './run.js';
import { median, type Check } from './report.js';

export interface Suite { checks: Check[]; results: Record<string, RunResult[]>; }

const seeds = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

/** The balance ladder and determinism, from the concept document. */
export function runSuite(nSeeds: number, log: (s: string) => void = () => {}): Suite {
  const checks: Check[] = []; const results: Record<string, RunResult[]> = {};

  log('determinism');
  const a = runOne({ seed: 'det-0', years: 40, policy: 'sensible', replayCheck: true });
  const b = runOne({ seed: 'det-0', years: 40, policy: 'sensible' });
  checks.push({ name: 'Determinism: same seed twice gives the same hash', pass: a.hash === b.hash, detail: `${a.hash} vs ${b.hash}` });
  checks.push({ name: 'Replay: recorded inputs reproduce the live run', pass: a.replayHash === a.hash, detail: `${a.replayHash} vs ${a.hash}` });

  log('forager 20');
  const f20 = seeds('f20', nSeeds).map(s => runOne({ seed: s, years: 100, policy: 'forager', startPop: 20 }));
  results['forager-20'] = f20;
  const survive = f20.flatMap(r => r.rows.filter(x => x.year === 99 && x.village < 4).map(x => x.alive));
  const surviveRate = survive.reduce((s, v) => s + v, 0) / Math.max(1, survive.length);
  checks.push({ name: 'A village of 20 survives 100 years on wild food (≥ 90% of villages)', pass: surviveRate >= 0.9, detail: `${(surviveRate * 100).toFixed(0)}% survived; median final pop ${median(f20.map(r => r.finalPop / Math.max(1, r.finalVillages)))}` });

  log('forager 50');
  const f50 = seeds('f50', nSeeds).map(s => runOne({ seed: s, years: 60, policy: 'forager', startPop: 50 }));
  results['forager-50'] = f50;
  const f50final = median(f50.map(r => r.finalPop / Math.max(1, r.finalVillages)));
  checks.push({ name: 'A village of 50 cannot hold on wild food alone (median falls below 45 within 60 years)', pass: f50final < 45, detail: `median final village pop ${f50final}` });

  log('farmer');
  const fa = seeds('farm', nSeeds).map(s => runOne({ seed: s, years: 150, policy: 'farmer', startPop: 20 }));
  results['farmer'] = fa;
  const peak = median(fa.map(r => r.peakPop));
  checks.push({ name: 'Farming lifts a village past 50 but plateaus below 250 (median peak)', pass: peak > 50 && peak < 250, detail: `median peak village pop ${peak}` });
  const hungerShare = fa.map(r => { const h = r.rows.reduce((s, x) => s + x.deathsHunger, 0), t = r.rows.reduce((s, x) => s + x.deathsAge + x.deathsHunger + x.deathsTravel, 0); return t ? h / t : 0; });
  checks.push({ name: 'Under farming without expansion, hunger is a minority cause of death (median share < 50%)', pass: median(hungerShare) < 0.5, detail: `median hunger share ${(median(hungerShare) * 100).toFixed(0)}%` });

  log('sensible');
  const se = seeds('sens', nSeeds).map(s => runOne({ seed: s, years: 300, policy: 'sensible', startPop: 20 }));
  results['sensible'] = se;
  const colonized = se.filter(r => r.villagesFounded > 0).length / se.length;
  checks.push({ name: 'Colonies are founded in ≥ 70% of 300-year worlds', pass: colonized >= 0.7, detail: `${(colonized * 100).toFixed(0)}% of seeds; median founded ${median(se.map(r => r.villagesFounded))}` });
  const first = se.filter(r => r.firstColonyYear >= 0).map(r => r.firstColonyYear);
  checks.push({ name: 'Median first colony within 150 years', pass: first.length > 0 && median(first) <= 150, detail: `median first colony year ${first.length ? median(first) : 'never'}` });
  const alive = se.filter(r => r.finalVillages > 0).length / se.length;
  checks.push({ name: 'Civilization persists 300 years in ≥ 90% of worlds', pass: alive >= 0.9, detail: `${(alive * 100).toFixed(0)}% of seeds have a living village; median final pop ${median(se.map(r => r.finalPop))}` });
  const seHunger = se.map(r => { const h = r.rows.reduce((s, x) => s + x.deathsHunger, 0), t = r.rows.reduce((s, x) => s + x.deathsAge + x.deathsHunger + x.deathsTravel, 0); return t ? h / t : 0; });
  checks.push({ name: 'With expansion, hunger falls below 45% of deaths', pass: median(seHunger) < 0.45, detail: `median hunger share ${(median(seHunger) * 100).toFixed(0)}%` });
  const paths = median(se.map(r => r.pathTiles));
  checks.push({ name: 'Paths form (median ≥ 5 path tiles after 300 years)', pass: paths >= 5, detail: `median path tiles ${paths}` });

  return { checks, results };
}
