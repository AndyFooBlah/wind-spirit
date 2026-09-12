/** Scripted chief policies: deterministic stand-ins for LLM chiefs. Also the runtime fallback. */
import {
  K, P, Rng, TERRAIN, div, mul, neighbors, popCounts, seasonOf, shelter, storeQty, storesWeeks, structures, tileDistance, yearOf, hasCap, nearWater, recipeById, commodityById, storeByCategory,
  type Order, type Village, type World, type WildResource, type Recipe, type Capability,
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

interface Features { farm: boolean; granary: boolean; explore: boolean; colonize: boolean; tech?: boolean; noPlotCap?: boolean; hungerBlocksFarming?: boolean; }

/** Preferred order for acquiring capabilities; tier and situation decide the rest. */
const CAP_PRIORITY: Capability[] = ['fire', 'stonetools', 'net', 'spear', 'drying', 'pottery', 'paddle', 'bow', 'weaving', 'medicine', 'cart', 'husbandry', 'irrigation', 'hull', 'kiln', 'roadbuilding', 'sail', 'metaltools', 'plough', 'hook', 'wagon', 'bronzeweapons', 'seagoing'];

function gatherable(w: World, v: Village, c: string): boolean {
  const cm = commodityById(w, c); if (!cm) return false;
  if (cm.source) return neighbors(w, v.tile, 1, true).some(t => w.tiles[t].cap[cm.source!] > 0);
  if (cm.regional) return neighbors(w, v.tile, 2, true).some(t => w.tiles[t].extra[c]);
  return false;
}

/** Orders that move a village toward crafting recipe r: gather or craft each missing input, then craft r. Returns workers used. */
function pursue(w: World, v: Village, r: Recipe, out: Order[], free: number, depth = 0): number {
  let used = 0;
  const missing = r.inputs.filter(i => storeQty(v, i.c) < i.qty);
  if (!missing.length) { const n = Math.min(free, 2); if (n > 0) { out.push(order('craft', n, { recipe: r.id, qty: r.output.commodity ? r.output.commodity.qty : 0 })); used += n; } return used; }
  for (const m of missing) {
    if (free - used <= 0) break;
    if (gatherable(w, v, m.c)) { out.push(order('gather', 1, { c: m.c })); used += 1; continue; }
    if (depth < 1) { const maker = v.recipes.map(id => recipeById(w, id)).find(x => x?.output.commodity?.c === m.c && (!x.requires || hasCap(v, x.requires))); if (maker) used += pursue(w, v, maker, out, free - used, depth + 1); }
  }
  return used;
}

function techOrders(view: PolicyView, free: number, hungry: boolean): { orders: Order[]; used: number } {
  const { w, v, rng, mem } = view; const out: Order[] = []; let used = 0; const year = yearOf(w.tick);
  if (hungry || free < 3) return { orders: out, used };
  // 1. acquire the next capability we know a recipe for
  const known = v.recipes.map(id => recipeById(w, id)).filter((r): r is Recipe => !!r);
  const capTargets = known.filter(r => r.output.capability && !hasCap(v, r.output.capability) && (!r.requires || hasCap(v, r.requires)) && !(r.output.capability === 'irrigation' && !nearWater(w, v)) && !(r.output.capability === 'paddle' && !nearWater(w, v)))
    .sort((a, b) => CAP_PRIORITY.indexOf(a.output.capability!) - CAP_PRIORITY.indexOf(b.output.capability!));
  if (capTargets.length) used += pursue(w, v, capTargets[0], out, free - used);
  // 2. goods: cloth for warmth, one instrument, occasional novelty food
  if (free - used > 1) {
    const wantCloth = storeByCategory(w, v, 'cloth') < Math.trunc((v.people.length * K) / 2);
    const clothR = known.find(r => r.output.commodity && commodityById(w, r.output.commodity.c)?.category === 'cloth' && (!r.requires || hasCap(v, r.requires)));
    if (wantCloth && clothR) used += pursue(w, v, clothR, out, free - used);
    const instR = known.find(r => r.output.commodity && commodityById(w, r.output.commodity.c)?.category === 'instrument' && (!r.requires || hasCap(v, r.requires)));
    if (instR && storeByCategory(w, v, 'instrument') === 0 && free - used > 0) used += pursue(w, v, instR, out, free - used);
    const foodR = known.filter(r => r.output.commodity && (commodityById(w, r.output.commodity.c)?.food ?? 0) > 0 && (!r.requires || hasCap(v, r.requires)) && r.inputs.every(i => storeQty(v, i.c) >= i.qty * 3));
    if (foodR.length && free - used > 0 && w.tick % 4 === 0) { const r = foodR[rng.int(foodR.length)]; out.push(order('craft', 1, { recipe: r.id, qty: r.output.commodity!.qty * 3 })); used += 1; }
  }
  // 3. research: one worker, chasing hints first, otherwise plausible pairs
  if (free - used > 0 && v.people.length >= 12) {
    const unknownHinted = w.recipes.filter(r => !v.recipes.includes(r.id) && (v.hints[r.id] ?? 0) >= r.hints.length && r.hints.length > 0 && r.inputs.every(i => v.known.includes(i.c)));
    let ingredients = '';
    if (unknownHinted.length) ingredients = unknownHinted[0].inputs.map(i => i.c).join(',');
    else {
      const key = `research:${year}`; if (mem[key] === undefined) mem[key] = 1;
      const stock = v.known.filter(c => storeQty(v, c) > 0 || (commodityById(w, c)?.source));
      const caps = v.capabilities;
      const r = rng.int(3);
      if (r === 0 || stock.length < 2) ingredients = rng.pick(stock);
      else if (r === 1 && caps.length) ingredients = `${rng.pick(stock)},${rng.pick(caps)}`;
      else { const a = rng.pick(stock); let b = rng.pick(stock); if (b === a) b = rng.pick(stock); ingredients = a === b ? a : `${a},${b}`; }
    }
    if (ingredients) { out.push(order('research', 1, { ingredients })); used += 1; }
  }
  return { orders: out, used };
}

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
  if (f.tech) { const t = techOrders(view, free, hungry); out.push(...t.orders); free -= t.used; }
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
  sensible: view => decide(view, { farm: true, granary: true, explore: true, colonize: true, tech: true }),
  'legacy-farmer-nocap': view => decide(view, { farm: true, granary: true, explore: false, colonize: false, noPlotCap: true }),
  'legacy-farmer-hungerblock': view => decide(view, { farm: true, granary: true, explore: false, colonize: false, hungerBlocksFarming: true }),
  'legacy-forager-nogranary': view => decide(view, { farm: false, granary: false, explore: false, colonize: false }),
};

export { structures };
