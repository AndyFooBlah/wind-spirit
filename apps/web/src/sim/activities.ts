/**
 * What each villager is doing this week, derived from the standing orders and the people list. Nothing here is
 * stored in the sim: the same world always yields the same assignment (workers are walked in id order, orders in
 * their listed order), so the picture is stable from frame to frame and identical in the history scrubber.
 */
import { Rng, stageOf, type Plot, type Village, type World } from '@wind-spirit/sim';
import { name as genName } from '@wind-spirit/gen';
import type { PersonView } from './protocol.ts';

/** Where a task is done, for placing the villager: on a plot, off the tile, or at home. */
function siteFor(task: string, params: Record<string, number | string>, v: Village, cursor: Record<string, number>): { plot?: number; out?: boolean } {
  const pick = (key: string, cands: number[]): number | undefined => { if (!cands.length) return undefined; const k = (cursor[key] ?? 0) % cands.length; cursor[key] = k + 1; return cands[k]; };
  const idx = (pred: (p: Plot) => boolean) => v.plots.map((p, i) => (pred(p) ? i : -1)).filter(i => i >= 0);
  const homes = idx(p => p.kind === 'structure');
  switch (task) {
    case 'farm': return { plot: pick('farm', idx(p => p.kind === 'field' && p.planted)) ?? pick('farm2', idx(p => p.kind === 'field' || (p.kind === 'clear' && p.recipe === ''))) ?? pick('home', homes) };
    case 'build': return { plot: pick('build', idx(p => p.kind !== 'structure' && p.recipe !== '' && (params.recipe === undefined || p.recipe === params.recipe))) ?? pick('build2', idx(p => p.kind !== 'structure' && p.recipe !== '')) ?? pick('home', homes) };
    case 'clear': return { plot: pick('clear', idx(p => p.kind === 'wild' && p.recipe === '' && p.progress > 0)) ?? pick('clear2', idx(p => p.kind === 'clear' && p.recipe === '' && !p.planted)) ?? { out: true } as never };
    case 'craft': case 'research': case 'rest': return { plot: pick('home', homes) };
    default: return { out: true };   // forage, hunt, fish, gather, road, explore, colonize, envoy, raid, expedition: away from the plots
  }
}

const VERB: Record<string, (params: Record<string, number | string>, names: (c: string) => string, rnames: (r: string) => string) => string> = {
  forage: () => 'foraging for wild plants', hunt: () => 'hunting', fish: () => 'fishing',
  gather: (p, n) => `gathering ${n(String(p.c ?? ''))}`, clear: () => 'clearing ground for fields',
  farm: () => 'working the fields', build: (p, _n, r) => `building ${r(String(p.recipe ?? ''))}`,
  craft: (p, _n, r) => `making ${r(String(p.recipe ?? ''))}`, research: () => 'trying things out',
  road: () => 'laying a road', explore: () => 'setting out to explore', colonize: () => 'preparing to found a village',
  envoy: () => 'readying an envoy', raid: () => 'readying a raid', expedition: () => 'readying an expedition', rest: () => 'resting',
};

const SEASON_FARM = ['planting', 'weeding the fields', 'harvesting', 'mending tools'];

/** A stable given name for a villager: seeded from the village and the person, in the village's naming tradition. */
export function personName(villageId: number, personId: number): string {
  return genName(Rng.fromSeed(`person:${villageId}`, String(personId)), 2, villageId % 4);
}

export function assignActivities(w: World, v: Village, cname: (c: string) => string, rname: (r: string) => string): PersonView[] {
  const tick = w.tick; const season = Math.floor((tick % 52) / 13);
  const people = [...v.people].sort((a, b) => a.id - b.id);
  const cursor: Record<string, number> = {};
  const homes = v.plots.map((p, i) => (p.kind === 'structure' ? i : -1)).filter(i => i >= 0);
  const homeOf = (id: number) => (homes.length ? homes[id % homes.length] : undefined);
  const out: PersonView[] = [];
  // Adults take the orders in listed order; whoever is left over rests at home.
  const adults = people.filter(p => stageOf(p.born, tick) === 'adult');
  let ai = 0;
  for (const o of v.orders) {
    for (let k = 0; k < o.workers && ai < adults.length; k++, ai++) {
      const p = adults[ai]; const site = siteFor(o.task, o.params, v, cursor);
      const doing = o.task === 'farm' ? SEASON_FARM[season] : (VERB[o.task] ?? (() => o.task))(o.params, cname, rname);
      out.push({ id: p.id, name: personName(v.id, p.id), age: Math.floor((tick - p.born) / 52), stage: 'adult', doing, plot: site.plot ?? (site.out ? undefined : homeOf(p.id)), out: !!site.out, chief: p.id === v.chief });
    }
  }
  for (; ai < adults.length; ai++) { const p = adults[ai]; out.push({ id: p.id, name: personName(v.id, p.id), age: Math.floor((tick - p.born) / 52), stage: 'adult', doing: p.id === v.chief ? 'keeping counsel' : 'resting', plot: homeOf(p.id), out: false, chief: p.id === v.chief }); }
  for (const p of people) {
    const stage = stageOf(p.born, tick); if (stage === 'adult') continue;
    const age = Math.floor((tick - p.born) / 52);
    if (stage === 'elder') out.push({ id: p.id, name: personName(v.id, p.id), age, stage, doing: 'sitting by the hearth', plot: homeOf(p.id), out: false, chief: p.id === v.chief });
    else out.push({ id: p.id, name: personName(v.id, p.id), age, stage, doing: age < 3 ? 'being carried about' : 'playing', plot: undefined, out: false, chief: false });
  }
  return out;
}
