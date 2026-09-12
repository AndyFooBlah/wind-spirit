/**
 * View models built from a World: the per-tick frame, the static map, and the village detail with its rendered
 * history feed. Shared by the live sim worker and the history worker.
 */
import { P, WEEKS_PER_SEASON, commodityById, popCounts, recipeById, seasonIndex, seasonOf, storesWeeks, yearOf, type Event, type Village, type World } from '@wind-spirit/sim';
import { CAP_NAMES } from '@wind-spirit/gen';
import { buildView, renderChronicle, renderEvents, SEASONS } from '@wind-spirit/agents';
import type { FeedGroup, Frame, StaticMap, VillageDetail } from './protocol.ts';

/** Does an event touch this village? (same rule the scheduler uses, minus the weather broadcast) */
export function touches(e: Event, village: number): boolean {
  const any = e as unknown as Record<string, unknown>;
  return any.village === village || any.parent === village || any.attacker === village || any.defender === village || any.guest === village || any.to === village || any.from === village;
}

/** The events worth keeping for village history feeds: per-village events plus each season's weather roll. */
export function historyWorthy(e: Event): boolean {
  if (e.type === 'WeekSummary' || e.type === 'DeliberationRequested' || e.type === 'PathFormed' || e.type === 'ChiefDecided' || e.type === 'HostDecided') return false;
  if (e.type === 'WeatherRolled') return e.season === seasonIndex(e.t);
  return true;
}
/** Which villages an event belongs to in a feed (WeatherRolled belongs to every living village). */
export function feedVillages(w: World, e: Event): number[] {
  if (e.type === 'WeatherRolled') return w.villages.filter(v => v.alive).map(v => v.id);
  return w.villages.filter(v => touches(e, v.id)).map(v => v.id);
}

export function buildFrame(w: World): Frame {
  const cur = seasonIndex(w.tick);
  const paths: number[] = [], roads: number[] = [];
  for (let i = 0; i < w.tiles.length; i++) { const t = w.tiles[i]; if (t.road) roads.push(i); else if (t.trodden >= P.pathAt) paths.push(i); }
  return {
    tick: w.tick, year: yearOf(w.tick), season: seasonOf(w.tick), week: (w.tick % WEEKS_PER_SEASON) + 1,
    villages: w.villages.map(v => ({ id: v.id, name: v.name, tile: v.tile, alive: v.alive, pop: popCounts(v, w.tick), happiness: v.happiness, trust: v.trust, foodWeeks: storesWeeks(w, v), hungryWeek: v.hungryWeek, capabilities: v.capabilities.length })),
    parties: w.parties.map(p => ({ id: p.id, kind: p.kind, home: p.home, at: p.at, boat: p.boat, target: p.target, targetVillage: p.targetVillage, returning: p.returning, size: p.members.length, waiting: p.waiting })),
    paths, roads,
    breath: w.breath / 1000,
    rolls: w.rolls.slice(cur, cur + 5), rollSeasons: [0, 1, 2, 3, 4].map(i => cur + i), wind: w.wind.slice(cur, cur + 5),
    storms: [...w.storms],
  };
}

export function buildStaticMap(w: World): StaticMap {
  return {
    seed: w.seed, width: w.width, height: w.height,
    terrain: w.tiles.map(t => t.terrain), ford: w.tiles.map(t => t.ford), extra: w.tiles.map(t => Object.keys(t.extra)),
    names: { commodities: Object.fromEntries(w.commodities.map(c => [c.id, c.name])), recipes: Object.fromEntries(w.recipes.map(r => [r.id, r.name])), capabilities: { ...CAP_NAMES } },
  };
}

/** The village panel's data; `history` is this village's recent events (oldest first). */
export function buildVillageDetail(w: World, id: number, history: Event[]): VillageDetail | undefined {
  const v = w.villages[id]; if (!v) return undefined;
  const cname = (c: string) => commodityById(w, c)?.name ?? c;
  const rname = (r: string) => recipeById(w, r)?.name ?? r;
  const capName = (c: string) => (CAP_NAMES as Record<string, string>)[c] ?? c;
  const view = buildView(w, v, { events: [], capNames: CAP_NAMES, pendingSpirit: [...v.inbox], chronicle: renderChronicle(w, v) });
  const { names: _names, ...rest } = view; void _names;
  const plots = v.plots.map(p => ({ kind: p.kind, planted: p.planted, recipe: p.recipe ? rname(p.recipe) : '', crop: p.crop ? cname(p.crop) : '', building: p.kind !== 'structure' && p.recipe !== '' }));
  return { id, tick: w.tick, alive: v.alive, view: rest, plots, chronicle: [...v.chronicle], feed: buildFeed(w, v, history, cname, rname, capName), inbox: [...v.inbox], chiefId: v.chief };
}

/** The history feed: a village's events grouped by season and rendered as sentences, newest season first. */
export function buildFeed(w: World, v: Village, events: Event[], cname: (c: string) => string, rname: (r: string) => string, capName: (c: string) => string): FeedGroup[] {
  const groups: { when: string; tick: number; events: Event[] }[] = [];
  for (const e of events) {
    const s = seasonIndex(e.t); const last = groups[groups.length - 1];
    if (last && seasonIndex(last.tick) === s) last.events.push(e);
    else groups.push({ when: `Year ${yearOf(e.t)}, ${SEASONS[seasonOf(e.t)]}`, tick: e.t, events: [e] });
  }
  return groups.map(g => ({ when: g.when, tick: g.tick, lines: renderEvents(w, v, g.events, cname, rname, capName) })).filter(g => g.lines.length).reverse();
}
