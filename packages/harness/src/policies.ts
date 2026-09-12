/** Scripted chief policies: deterministic stand-ins for LLM chiefs. Also the runtime fallback. */
import {
  K, P, Rng, TERRAIN, div, mul, neighbors, popCounts, seasonOf, shelter, storeQty, storesWeeks, structures, tileDistance, yearOf, hasCap, nearWater, recipeById, commodityById, storeByCategory,
  type Order, type Village, type World, type WildResource, type Recipe, type Capability, type Mandate, type HostAnswer,
} from '@wind-spirit/sim';

export interface PolicyView { w: World; v: Village; reason: string; rng: Rng; mem: Record<string, number>; }
export type Policy = (view: PolicyView) => Order[];
export type HostPolicy = (view: PolicyView, mandate: Mandate, guest: Village) => HostAnswer;
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

interface Features { farm: boolean; granary: boolean; explore: boolean; colonize: boolean; tech?: boolean; trade?: boolean; raid?: boolean; noPlotCap?: boolean; hungerBlocksFarming?: boolean; }

/** Send an envoy when we lack a regional input for our next capability and have a surplus to offer. */
function tradeOrders(view: PolicyView, free: number): { orders: Order[]; used: number } {
  const { w, v, rng, mem } = view; const out: Order[] = []; const year = yearOf(w.tick);
  if (free < 3 || v.people.length < 15 || year - (mem.lastEnvoy ?? -10) < 2) return { orders: out, used: 0 };
  const partners = v.knowledge.villages.filter(id => id !== v.id && w.villages[id]?.alive && (v.relations[id]?.grudge ?? 0) < 400);
  if (!partners.length) return { orders: out, used: 0 };
  // what do we lack? inputs of known-but-unbuilt capability recipes that we cannot gather here
  const known = v.recipes.map(id => recipeById(w, id)).filter((r): r is Recipe => !!r);
  const lacking = new Set<string>();
  for (const r of known) if (r.output.capability && !hasCap(v, r.output.capability)) for (const i of r.inputs) if (storeQty(v, i.c) < i.qty && !gatherable(w, v, i.c)) lacking.add(i.c);
  // regional commodities we have heard of but never held are worth asking for too
  for (const c of v.known) { const cm = commodityById(w, c); if (cm?.regional && storeQty(v, c) === 0 && !gatherable(w, v, c)) lacking.add(c); }
  if (!lacking.size) return { orders: out, used: 0 };
  // prefer a partner known to have what we lack nearby; otherwise ask anyway
  const knownSet = new Set(v.knowledge.tiles);
  const nearPartner = (id: number, c: string) => { const o = w.villages[id]; return neighbors(w, o.tile, 2, true).some(t => knownSet.has(t) && !!w.tiles[t].extra[c]); };
  const options = partners.flatMap(id => [...lacking].filter(c => nearPartner(id, c)).map(c => ({ id, c })));
  const pickd = options.length ? rng.pick(options) : { id: rng.pick(partners), c: rng.pick([...lacking]) };
  const want = pickd.c;
  // surplus: durable food beyond 20 weeks, plus goods we make
  const surplus: Record<string, number> = {};
  const grain = storeQty(v, 'grain'); const need20 = v.people.length * 20 * 1000; if (grain > need20) surplus.grain = Math.min(30_000, grain - need20);
  for (const s of v.stores) { const cm = commodityById(w, s.c); if (cm && (cm.regional || cm.category === 'cloth' || cm.category === 'curio') && s.qty > 4000) surplus[s.c] = Math.min(10_000, Math.trunc(s.qty / 2)); }
  if (!Object.keys(surplus).length) return { orders: out, used: 0 };
  const target = pickd.id;
  mem.lastEnvoy = year;
  // friends share knowledge: after a couple of good trades, carry a recipe along
  const friendly = (v.relations[target]?.trades ?? 0) >= 1;
  // share our most advanced knowledge: it is the least likely to be known already
  const shareable = friendly ? v.recipes.map(id => recipeById(w, id)).filter((r): r is Recipe => !!r && !r.start && r.tier >= 2).sort((a, b) => b.tier - a.tier).slice(0, 3).map(r => r.id) : [];
  const params: Record<string, number | string> = { target, offer: Object.entries(surplus).map(([c, q]) => `${c}:${q}`).join(','), want: `${want}:4000`, floor: 500 };
  if (shareable.length) params.transfer = rng.pick(shareable);
  out.push(order('envoy', 2, params));
  return { orders: out, used: 2 };
}

/** Raid only under real pressure, against a smaller village we hold a grudge against or that is much weaker. */
function raidOrders(view: PolicyView, free: number, hungry: boolean): { orders: Order[]; used: number } {
  const { w, v, mem } = view; const year = yearOf(w.tick); const out: Order[] = [];
  if (free < 8 || year - (mem.lastRaid ?? -10) < 6) return { orders: out, used: 0 };
  const desperate = hungry && v.hardship > 250;
  const targets = v.knowledge.villages.filter(id => id !== v.id && w.villages[id]?.alive).map(id => ({ id, r: v.relations[id] })).filter(x => x.r && x.r.sizeSeen > 0 && x.r.sizeSeen * 2 < v.people.length && (x.r.grudge >= 500 || desperate));
  if (!targets.length) return { orders: out, used: 0 };
  const t = targets.sort((a, b) => b.r.grudge - a.r.grudge)[0];
  const n = Math.min(free - 4, Math.max(6, Math.trunc(free / 2)));
  mem.lastRaid = year;
  out.push(order('raid', n, { target: t.id }));
  return { orders: out, used: n };
}

/** Host answer: accept when the ask is affordable and the offer is worth it, counter with what we can spare, else refuse. */
export function hostAnswer(view: PolicyView, mandate: Mandate, guest: Village): HostAnswer {
  const { w, v } = view;
  const grudge = v.relations[guest.id]?.grudge ?? 0;
  if (mandate.threat) { const weaker = v.people.length < (v.relations[guest.id]?.sizeSeen ?? guest.people.length) * 0.6; if (!weaker) return { kind: 'refuse', reason: 'we do not pay tribute' }; }
  else if (grudge >= 600) return { kind: 'refuse', reason: 'old wounds' };
  const give: Record<string, number> = {}; let canGive = 0;
  for (const [c, q] of Object.entries(mandate.want)) {
    const have = storeQty(v, c); const cm = commodityById(w, c);
    const reserve = cm && cm.food > 0 ? v.people.length * 8 * 1000 : Math.trunc(have / 3);
    const spare = Math.max(0, have - reserve); const g = Math.min(q, spare); if (g > 0) { give[c] = g; canGive += g; }
  }
  const offered = Object.values(mandate.offer).reduce((a, b) => a + b, 0);
  const wanted = Object.values(mandate.want).reduce((a, b) => a + b, 0);
  if (mandate.threat) return canGive > 0 ? { kind: 'counter', give, take: {} } : { kind: 'refuse', reason: 'nothing to give' };
  if (wanted === 0) return { kind: 'accept' };
  if (canGive === 0) return { kind: 'refuse', reason: 'we have none to spare' };
  if (canGive >= wanted && offered >= wanted * 0.6) return { kind: 'accept' };
  return { kind: 'counter', give, take: { ...mandate.offer } };
}

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
  // feed first: reserve enough food workers to cover need (with a margin) at current expected yields, then spend the rest
  const expected = Math.max(1, ['plants', 'game', 'fish'].map((r, i) => expectedPerWorker(w, v, r as WildResource, [P.yield.forage, P.yield.hunt, P.yield.fish][i], [P.seasonPlants, P.seasonGame, P.seasonFish][i][season])).sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0) / 2);
  const grainPerWeek = Math.trunc(storeQty(v, 'grain') / 26);
  const needPerWeek = Math.max(0, pop * P.foodPerPersonWeek * (hungry ? 1300 : 1100) / 1000 - grainPerWeek);
  const reserve = Math.min(free, Math.ceil(needPerWeek / expected));
  const spendable = Math.max(0, free - reserve);
  const investBudget = { left: spendable };

  const reserved = reserve; free = spendable; void investBudget;
  // farming: never skipped, hunger is exactly when planting matters (farming counts as food work, so it may dip into the reserve)
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
  if (f.explore && season === 0 && counts.adults >= 8 && free > 3 && year - (mem.lastExplore ?? -10) >= 2) {
    mem.lastExplore = year;
    const dirs = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]; const d = dirs[rng.int(8)];
    out.push(order('explore', 2, { dx: d[0], dy: d[1], dist: rng.range(6, 14) })); free -= 2;
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
  // stockpile local specialties: they are what we have to trade
  if (f.trade && !hungry && free >= 6) {
    const local = v.known.filter(c => commodityById(w, c)?.regional && gatherable(w, v, c)).sort((a, b) => storeQty(v, a) - storeQty(v, b));
    if (local.length && storeQty(v, local[0]) < 20_000) { const n = free >= 10 ? 2 : 1; out.push(order('gather', n, { c: local[0] })); free -= n; }
  }
  if (f.tech) { const t = techOrders(view, free, hungry); out.push(...t.orders); free -= t.used; }
  if (f.trade && !hungry) { const t = tradeOrders(view, free); out.push(...t.orders); free -= t.used; }
  if (f.raid) { const t = raidOrders(view, free, hungry); out.push(...t.orders); free -= t.used; }
  free += reserved;
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
  sensible: view => decide(view, { farm: true, granary: true, explore: true, colonize: true, tech: true, trade: true, raid: true }),
  'legacy-farmer-nocap': view => decide(view, { farm: true, granary: true, explore: false, colonize: false, noPlotCap: true }),
  'legacy-farmer-hungerblock': view => decide(view, { farm: true, granary: true, explore: false, colonize: false, hungerBlocksFarming: true }),
  'legacy-forager-nogranary': view => decide(view, { farm: false, granary: false, explore: false, colonize: false }),
};

export { structures };
