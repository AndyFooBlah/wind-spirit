import { K, mul, div } from '../fixed.js';
import { harvestWeatherFactor, P, seasonOf, TERRAIN, WEEKS_PER_SEASON } from '../params.js';
import type { Order, Person, Village, WildResource } from '../types.js';
import { addStore, idx, inBounds, neighbors, popCounts, recipeById, stageOf, storeQty, takeStore, xy, type Ctx } from '../world.js';
import { tread } from './paths.js';
import { spawnParty } from './travel.js';
import { currentRoll } from './weather.js';

const SOURCE: Record<'forage' | 'hunt' | 'fish', { res: WildResource; out: string; base: number; season: readonly number[] }> = {
  forage: { res: 'plants', out: 'plants', base: P.yield.forage, season: P.seasonPlants },
  hunt: { res: 'game', out: 'meat', base: P.yield.hunt, season: P.seasonGame },
  fish: { res: 'fish', out: 'fish', base: P.yield.fish, season: P.seasonFish },
};

export function work(ctx: Ctx): void {
  const { w } = ctx; const season = seasonOf(w.tick); const roll = currentRoll(ctx);
  for (const v of w.villages) {
    if (!v.alive) continue;
    // first week of winter: unharvested fields are lost
    if (season === 3 && w.tick % WEEKS_PER_SEASON === 0) for (const p of v.plots) if (p.planted) { p.planted = false; p.fertility = Math.max(0, p.fertility - P.fertilityDropPerHarvest); }
    let free = v.people.filter(p => stageOf(p.born, w.tick) === 'adult' && p.id !== v.chief).length;
    const keep: Order[] = [];
    let cleared = 0;
    for (const o of v.orders) {
      const n = Math.min(o.workers, free);
      if (n <= 0 && o.task !== 'explore' && o.task !== 'colonize') { keep.push(o); continue; }
      switch (o.task) {
        case 'forage': case 'hunt': case 'fish': gatherFood(ctx, v, o.task, n, season, roll); free -= n; keep.push(o); break;
        case 'gather': gatherMaterial(ctx, v, String(o.params.c ?? 'wood'), n); free -= n; keep.push(o); break;
        case 'clear': cleared += clearPlots(v, n); free -= n; keep.push(o); break;
        case 'farm': farm(ctx, v, n, season, Number(o.params.plots ?? 0)); free -= n; keep.push(o); break;
        case 'build': cleared += build(ctx, v, String(o.params.recipe ?? ''), n); free -= n; keep.push(o); break;
        case 'explore': { const used = explore(ctx, v, o, free); free -= used; break; }        // one-shot
        case 'colonize': { const used = colonize(ctx, v, o, free); free -= used; break; }      // one-shot
        case 'rest': free -= n; keep.push(o); break;
      }
    }
    v.orders = keep;
    if (cleared > 0) ctx.events.push({ t: w.tick, type: 'Cleared', village: v.id, plots: cleared });
  }
}

function sourceTiles(ctx: Ctx, v: Village, res: WildResource): number[] {
  return neighbors(ctx.w, v.tile, 1, true).filter(t => ctx.w.tiles[t].cap[res] > 0);
}

function gatherFood(ctx: Ctx, v: Village, task: 'forage' | 'hunt' | 'fish', workers: number, season: number, roll: string): void {
  const { w } = ctx; const src = SOURCE[task];
  const tiles = sourceTiles(ctx, v, src.res); if (!tiles.length) return;
  let factor = src.season[season];
  if (roll === 'hard' && season === 3) factor = Math.trunc(factor * (task === 'forage' ? 500 : 750) / 1000);
  let total = 0;
  for (let i = 0; i < workers; i++) {
    let best = -1, bestFrac = 0;
    for (const t of tiles) { const tile = w.tiles[t]; const frac = div(tile.stock[src.res], tile.cap[src.res]); if (frac > bestFrac) { bestFrac = frac; best = t; } }
    if (best === -1) break;
    const tile = w.tiles[best];
    const y = Math.min(tile.stock[src.res], mul(mul(src.base, bestFrac), factor));
    tile.stock[src.res] -= y; total += y;
    if (best !== v.tile) tread(ctx, best, P.treadForage);
  }
  if (total > 0) { addStore(v, src.out, total); v.year[task] += total; }
}

function gatherMaterial(ctx: Ctx, v: Village, c: string, workers: number): void {
  const { w } = ctx; const res: WildResource = c === 'stone' ? 'stone' : 'timber'; const base = c === 'stone' ? P.yield.stone : P.yield.wood;
  const tiles = sourceTiles(ctx, v, res); if (!tiles.length) return;
  let total = 0;
  for (let i = 0; i < workers; i++) {
    let best = -1, bestFrac = 0;
    for (const t of tiles) { const tile = w.tiles[t]; const frac = div(tile.stock[res], tile.cap[res]); if (frac > bestFrac) { bestFrac = frac; best = t; } }
    if (best === -1) break;
    const tile = w.tiles[best]; const y = Math.min(tile.stock[res], mul(base, bestFrac)); tile.stock[res] -= y; total += y;
    if (best !== v.tile) tread(ctx, best, P.treadForage);
  }
  if (total > 0) { addStore(v, c === 'stone' ? 'stone' : 'wood', total); if (c === 'stone') v.year.stone += total; else v.year.wood += total; }
}

/** Returns number of plots finished this week. */
function clearPlots(v: Village, workers: number): number {
  let done = 0; let effort = workers * K;
  while (effort > 0) {
    let plot = v.plots.find(p => p.kind === 'wild' && p.progress > 0) ?? v.plots.find(p => p.kind === 'wild');
    if (!plot) break;
    const need = P.clearLabor - plot.progress; const put = Math.min(need, effort); plot.progress += put; effort -= put;
    if (plot.progress >= P.clearLabor) { plot.kind = 'clear'; plot.progress = 0; done++; addStore(v, 'wood', 3000); }
  }
  return done;
}

function farm(ctx: Ctx, v: Village, workers: number, season: number, maxPlots: number): void {
  const { w } = ctx;
  if (season === 0) {
    let n = workers * P.plotsPerFarmer;
    if (maxPlots > 0) { const already = v.plots.filter(p => p.planted).length; n = Math.min(n, Math.max(0, maxPlots - already)); }
    const cands = v.plots.filter(p => (p.kind === 'clear' || p.kind === 'field') && !p.planted && p.recipe === '').sort((a, b) => b.fertility - a.fertility);
    for (const p of cands) { if (n === 0) break; p.planted = true; p.kind = 'field'; n--; }
  } else if (season === 2) {
    let n = workers * P.plotsPerFarmer; let qty = 0, plots = 0; const wf = harvestWeatherFactor(currentRoll(ctx) as never);
    for (const p of v.plots) {
      if (n === 0) break; if (!p.planted) continue;
      const y = mul(mul(P.harvestPerPlot, p.fertility), wf); qty += y; plots++; n--;
      p.planted = false; p.fertility = Math.max(0, p.fertility - P.fertilityDropPerHarvest);
    }
    if (qty > 0) { addStore(v, 'grain', qty); v.year.farm += qty; ctx.events.push({ t: w.tick, type: 'Harvested', village: v.id, qty, plots }); }
  }
}

/** Returns plots cleared as a side effect (when no cleared plot was available). */
function build(ctx: Ctx, v: Village, recipeId: string, workers: number): number {
  const { w } = ctx; const r = recipeById(w, recipeId); if (!r || !r.structure) return 0;
  let plot = v.plots.find(p => p.kind === 'clear' && p.recipe === recipeId && p.progress > 0);
  if (!plot) {
    const free = v.plots.find(p => p.kind === 'clear' && p.recipe === '' && !p.planted && p.progress === 0);
    if (!free) return clearPlots(v, workers);
    for (const inp of r.inputs) if (storeQty(v, inp.c) < inp.qty) return 0;
    for (const inp of r.inputs) takeStore(v, inp.c, inp.qty);
    plot = free; plot.recipe = recipeId;
  }
  plot.progress += workers * K;
  if (plot.progress >= r.labor * K) { plot.kind = 'structure'; plot.progress = 0; plot.planted = false; ctx.events.push({ t: w.tick, type: 'Built', village: v.id, recipe: recipeId }); }
  return 0;
}

function takeAdults(v: Village, tick: number, n: number): Person[] {
  const adults = v.people.filter(p => stageOf(p.born, tick) === 'adult' && p.id !== v.chief);
  const chosen = adults.slice(-n);
  const ids = new Set(chosen.map(p => p.id)); v.people = v.people.filter(p => !ids.has(p.id));
  return chosen;
}

function explore(ctx: Ctx, v: Village, o: Order, free: number): number {
  const { w } = ctx; const n = Math.min(o.workers, free); if (n <= 0) return 0;
  const dx = Math.sign(Number(o.params.dx ?? 0)), dy = Math.sign(Number(o.params.dy ?? -1)); const dist = Math.max(1, Number(o.params.dist ?? 4));
  const [hx, hy] = xy(w, v.tile);
  let tx = hx + dx * dist, ty = hy + dy * dist;
  tx = Math.max(0, Math.min(w.width - 1, tx)); ty = Math.max(0, Math.min(w.height - 1, ty));
  let target = idx(w, tx, ty);
  if (!TERRAIN[w.tiles[target].terrain].passable) { const alt = neighbors(w, target, 2).find(t => TERRAIN[w.tiles[t].terrain].passable); if (alt === undefined) return 0; target = alt; }
  const members = takeAdults(v, w.tick, n);
  const rations = Math.min(takeStore(v, 'grain', members.length * 4 * P.foodPerPersonWeek) , 1e12);
  const party = spawnParty(ctx, v, 'explore', members, rations, target);
  if (!party) { v.people.push(...members); addStore(v, 'grain', rations); return 0; }
  return n;
}

function colonize(ctx: Ctx, v: Village, o: Order, free: number): number {
  const { w } = ctx; const target = Number(o.params.tile ?? -1); if (target < 0 || !inBounds(w, ...xy(w, target))) return 0;
  const share = Math.max(100, Math.min(600, Number(o.params.share ?? 400)));
  const counts = popCounts(v, w.tick);
  const nAdults = Math.min(free, Math.max(2, Math.trunc((counts.adults * share) / K)));
  if (nAdults < 2 || counts.adults - nAdults < 2) return 0;
  const members = takeAdults(v, w.tick, nAdults);
  const nOther = Math.trunc(((counts.children + counts.elders) * share) / K);
  const others = v.people.filter(p => stageOf(p.born, w.tick) !== 'adult').slice(-nOther);
  const ids = new Set(others.map(p => p.id)); v.people = v.people.filter(p => !ids.has(p.id)); members.push(...others);
  const wantFood = members.length * 8 * P.foodPerPersonWeek;
  let rations = takeStore(v, 'grain', wantFood); if (rations < wantFood) rations += takeStore(v, 'plants', wantFood - rations);
  const party = spawnParty(ctx, v, 'colonize', members, rations, target);
  if (!party) { v.people.push(...members); addStore(v, 'grain', rations); return 0; }
  return nAdults;
}
