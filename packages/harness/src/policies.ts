/** Scripted chief policies: deterministic stand-ins for LLM chiefs. Also the runtime fallback. */
import {
  K, P, Rng, TERRAIN, div, mul, neighbors, popCounts, seasonOf, shelter, storeQty, storesWeeks, structures, tileDistance, yearOf,
  type Order, type Village, type World, type WildResource,
} from '@wind-spirit/sim';

export interface PolicyView { w: World; v: Village; reason: string; rng: Rng; mem: Record<string, number>; }
export type Policy = (view: PolicyView) => Order[];
export type PolicyName = 'forager' | 'farmer' | 'sensible' | 'legacy-farmer-nocap' | 'legacy-farmer-hungerblock' | 'legacy-forager-nogranary';

const order = (task: Order['task'], workers: number, params: Record<string, number | string> = {}): Order => ({ task, workers, params, since: 0 });

function expectedPerWorker(w: World, v: Village, res: WildResource, base: number, seasonFactor: number): number {
  let best = 0;
  for (const t of neighbors(w, v.tile, 1, true)) { const tile = w.tiles[t]; if (tile.cap[res] === 0) continue; best = Math.max(best, div(tile.stock[res], tile.cap[res])); }
  return mul(mul(base, best), seasonFactor);
}

/** Split `n` workers across food sources in proportion to expected yield. */
function foodOrders(w: World, v: Village, n: number, season: number): Order[] {
  if (n <= 0) return [];
  const ex = [
    { task: 'forage' as const, y: expectedPerWorker(w, v, 'plants', P.yield.forage, P.seasonPlants[season]) },
    { task: 'hunt' as const, y: expectedPerWorker(w, v, 'game', P.yield.hunt, P.seasonGame[season]) },
    { task: 'fish' as const, y: expectedPerWorker(w, v, 'fish', P.yield.fish, P.seasonFish[season]) },
  ].filter(e => e.y > 0).sort((a, b) => b.y - a.y);
  if (!ex.length) return [order('forage', n)];
  const total = ex.reduce((a, e) => a + e.y, 0);
  const out: Order[] = []; let left = n;
  for (let i = 0; i < ex.length; i++) {
    const share = i === ex.length - 1 ? left : Math.min(left, Math.round((n * ex[i].y) / total));
    if (share > 0) out.push(order(ex[i].task, share)); left -= share;
  }
  return out;
}

function plotCounts(v: Village) {
  let cleared = 0, planted = 0, huts = 0, granary = 0, tents = 0;
  for (const p of v.plots) {
    if (p.kind === 'clear' || p.kind === 'field') cleared++;
    if (p.planted) planted++;
    if (p.kind === 'structure') { if (p.recipe === 'hut') huts++; else if (p.recipe === 'granary') granary++; else if (p.recipe === 'tent') tents++; }
  }
  return { cleared, planted, huts, granary, tents };
}

interface Features { farm: boolean; granary: boolean; explore: boolean; colonize: boolean; noPlotCap?: boolean; hungerBlocksFarming?: boolean; }

function decide(view: PolicyView, f: Features): Order[] {
  const { w, v, rng, mem } = view; const tick = w.tick; const season = seasonOf(tick); const year = yearOf(tick);
  const counts = popCounts(v, tick); const pop = counts.total;
  let free = Math.max(0, counts.adults - 1);
  const out: Order[] = [];
  const pc = plotCounts(v); const sh = shelter(w, v);
  const weeks = storesWeeks(w, v);
  const hungry = v.hungryWeek > 0;

  // farming: never skipped, hunger is exactly when planting matters
  if (f.farm && !(f.hungerBlocksFarming && hungry)) {
    if (season === 0) { const plots = Math.ceil(pc.cleared / 2); const n = Math.min(Math.trunc(free * 0.4), Math.ceil(plots / P.plotsPerFarmer)); if (n > 0) { out.push(order('farm', n, f.noPlotCap ? {} : { plots })); free -= n; } }
    else if (season === 2) { const n = Math.min(Math.trunc(free * 0.6), Math.ceil(pc.planted / P.plotsPerFarmer)); if (n > 0) { out.push(order('farm', n)); free -= n; } }
  }
  // shelter
  if (sh.capacity < pop && free > 0 && !hungry) {
    if (storeQty(v, 'wood') >= 8000 && pc.cleared > 0) { out.push(order('build', 'hut' === 'hut' ? 2 : 2, { recipe: 'hut' })); free -= Math.min(free, 2); }
    else if (storeQty(v, 'wood') < 8000) { out.push(order('gather', 1, { c: 'wood' })); free -= 1; }
    else { out.push(order('clear', 1)); free -= 1; }
  }
  // granary
  if (f.granary && pc.granary === 0 && pop >= 15 && free > 1 && !hungry) {
    const wood = storeQty(v, 'wood'), stone = storeQty(v, 'stone');
    if (wood >= 12_000 && stone >= 4000 && pc.cleared > 0) { out.push(order('build', 2, { recipe: 'granary' })); free -= 2; }
    else { if (wood < 12_000) { out.push(order('gather', 1, { c: 'wood' })); free -= 1; } if (stone < 4000 && free > 0) { out.push(order('gather', 1, { c: 'stone' })); free -= 1; } }
  }
  // clearing
  if (f.farm && !hungry && (season === 1 || season === 3)) {
    const target = Math.max(8, Math.min(120, Math.trunc(pop * 0.6)));
    if (pc.cleared < target && free > 1) { const n = Math.min(2, free - 1); out.push(order('clear', n)); free -= n; }
  }
  // exploration
  if (f.explore && season === 0 && counts.adults >= 8 && free > 3 && year - (mem.lastExplore ?? -10) >= 3) {
    mem.lastExplore = year;
    const dirs = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]; const d = dirs[rng.int(8)];
    out.push(order('explore', 2, { dx: d[0], dy: d[1], dist: rng.range(4, 8) })); free -= 2;
  }
  // colonize
  if (f.colonize && season === 0 && pop >= 30 && counts.adults >= 10 && year - (mem.lastColony ?? -10) >= 8) {
    const perWorker = expectedPerWorker(w, v, 'plants', P.yield.forage, K);
    if (mem.baseYield === undefined) mem.baseYield = perWorker;
    const pressure = v.calmWeeks < 26 || perWorker < mul(mem.baseYield, 600) || pc.cleared >= 90;
    if (pressure) {
      const target = pickColonySite(w, v);
      if (target >= 0) { mem.lastColony = year; out.push(order('colonize', 0, { tile: target, share: 400 })); }
    }
  }
  out.push(...foodOrders(w, v, free, season));
  return out;
}

function pickColonySite(w: World, v: Village): number {
  let best = -1, bestScore = 0;
  for (const t of v.knowledge.tiles) {
    const tile = w.tiles[t]; const info = TERRAIN[tile.terrain];
    if (!info.passable || !info.forage || tile.village !== -1 || tile.terrain === 'mountain') continue;
    const d = tileDistance(w, v.tile, t); if (d < 6 || d > 15) continue;
    if (w.villages.some(o => o.alive && tileDistance(w, o.tile, t) < 5)) continue;
    let score = 0; for (const nb of neighbors(w, t, 1, true)) { const c = w.tiles[nb].cap; score += c.plants + c.game + c.fish; }
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

export const POLICIES: Record<PolicyName, Policy> = {
  forager: view => decide(view, { farm: false, granary: true, explore: false, colonize: false }),
  farmer: view => decide(view, { farm: true, granary: true, explore: false, colonize: false }),
  sensible: view => decide(view, { farm: true, granary: true, explore: true, colonize: true }),
  'legacy-farmer-nocap': view => decide(view, { farm: true, granary: true, explore: false, colonize: false, noPlotCap: true }),
  'legacy-farmer-hungerblock': view => decide(view, { farm: true, granary: true, explore: false, colonize: false, hungerBlocksFarming: true }),
  'legacy-forager-nogranary': view => decide(view, { farm: false, granary: false, explore: false, colonize: false }),
};

export { structures };
