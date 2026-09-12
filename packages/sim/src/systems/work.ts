import { K, mul, div } from '../fixed.js';
import { harvestWeatherFactor, P, seasonOf, TERRAIN, WEEKS_PER_SEASON } from '../params.js';
import type { Capability, Order, Person, Recipe, Village, WildResource } from '../types.js';
import { CAPABILITIES } from '../types.js';
import { addStore, commodityById, craftLaborMult, hasCap, idx, inBounds, learnCommodities, nearWater, neighbors, parseGoods, popCounts, recipeById, stageOf, storeQty, takeStore, xy, type Ctx } from '../world.js';
import { addCargo } from './diplomacy.js';
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
    if (season === 3 && w.tick % WEEKS_PER_SEASON === 0) for (const p of v.plots) if (p.planted) { p.planted = false; p.crop = ''; p.fertility = Math.max(0, p.fertility - P.fertilityDropPerHarvest); }
    let free = v.people.filter(p => stageOf(p.born, w.tick) === 'adult' && p.id !== v.chief).length;
    const keep: Order[] = [];
    let cleared = 0;
    for (const o of v.orders) {
      const n = Math.min(o.workers, free);
      if (n <= 0 && o.task !== 'explore' && o.task !== 'colonize') { keep.push(o); continue; }
      switch (o.task) {
        case 'forage': case 'hunt': case 'fish': gatherFood(ctx, v, o.task, n, season, roll); free -= n; keep.push(o); break;
        case 'gather': gatherAny(ctx, v, String(o.params.c ?? 'wood'), n); free -= n; keep.push(o); break;
        case 'clear': cleared += clearPlots(v, n); free -= n; keep.push(o); break;
        case 'farm': farm(ctx, v, n, season, Number(o.params.plots ?? 0), String(o.params.crop ?? 'grain')); free -= n; keep.push(o); break;
        case 'build': cleared += build(ctx, v, String(o.params.recipe ?? ''), n); free -= n; keep.push(o); break;
        case 'craft': { const done = craft(ctx, v, String(o.params.recipe ?? ''), n, Number(o.params.qty ?? 0), o); free -= n; if (!done) keep.push(o); break; }
        case 'research': research(ctx, v, String(o.params.ingredients ?? ''), n); free -= n; keep.push(o); break;
        case 'road': { const done = road(ctx, v, Number(o.params.tile ?? -1), n); free -= n; if (!done) keep.push(o); break; }
        case 'explore': { const used = explore(ctx, v, o, free); free -= used; break; }
        case 'colonize': { const used = colonize(ctx, v, o, free); free -= used; break; }
        case 'envoy': { const used = envoy(ctx, v, o, free); free -= used; break; }
        case 'raid': { const used = raid(ctx, v, o, free); free -= used; break; }
        case 'expedition': { const used = expedition(ctx, v, o, free); free -= used; break; }
        case 'rest': free -= n; keep.push(o); break;
      }
    }
    v.orders = keep;
    if (cleared > 0) ctx.events.push({ t: w.tick, type: 'Cleared', village: v.id, plots: cleared });
    serendipity(ctx, v);
    // enjoying goods: instruments, cloth and curiosities in store count as novelty this week
    for (const s of v.stores) { const c = commodityById(w, s.c); if (c && c.food === 0 && c.novelty > 0) v.tasted[c.id] = w.tick; }
  }
}

function sourceTiles(ctx: Ctx, v: Village, res: WildResource): number[] {
  return neighbors(ctx.w, v.tile, 1, true).filter(t => ctx.w.tiles[t].cap[res] > 0);
}

function foodCapFactor(v: Village, task: 'forage' | 'hunt' | 'fish'): number {
  let f = K;
  if (task === 'hunt') { if (hasCap(v, 'spear')) f = mul(f, 1200); if (hasCap(v, 'bow')) f = mul(f, 1400); if (hasCap(v, 'husbandry')) f = mul(f, 1300); }
  if (task === 'fish') { if (hasCap(v, 'spear')) f = mul(f, 1200); if (hasCap(v, 'net')) f = mul(f, 1500); if (hasCap(v, 'hook')) f = mul(f, 1250); }
  return f;
}

function gatherFood(ctx: Ctx, v: Village, task: 'forage' | 'hunt' | 'fish', workers: number, season: number, roll: string): void {
  const { w } = ctx; const src = SOURCE[task];
  const tiles = sourceTiles(ctx, v, src.res); if (!tiles.length) return;
  let factor = mul(src.season[season], foodCapFactor(v, task));
  if (roll === 'hard' && season === 3) factor = Math.trunc(factor * (P.legacy.hardWinter === 'all' || task === 'forage' ? 500 : 750) / 1000);
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
  if (total > 0) {
    addStore(v, src.out, total); v.year[task] += total;
    if (task === 'hunt') addStore(v, 'hide', Math.trunc(total / 5));
  }
}

/** Gather wood, stone, or a regional commodity from the home tile and its neighbours. */
function gatherAny(ctx: Ctx, v: Village, c: string, workers: number): void {
  const { w } = ctx;
  const cm = commodityById(w, c); if (!cm) return;
  let total = 0;
  if (cm.source === 'timber' || cm.source === 'stone') {
    const res = cm.source; const base = res === 'stone' ? P.yield.stone : P.yield.wood;
    const toolMult = res === 'timber' ? (hasCap(v, 'metaltools') ? 1600 : hasCap(v, 'stonetools') ? 1300 : K) : K;
    const tiles = sourceTiles(ctx, v, res); if (!tiles.length) return;
    for (let i = 0; i < workers; i++) {
      let best = -1, bestFrac = 0;
      for (const t of tiles) { const tile = w.tiles[t]; const frac = div(tile.stock[res], tile.cap[res]); if (frac > bestFrac) { bestFrac = frac; best = t; } }
      if (best === -1) break;
      const tile = w.tiles[best]; const y = Math.min(tile.stock[res], mul(mul(base, bestFrac), toolMult)); tile.stock[res] -= y; total += y;
      if (best !== v.tile) tread(ctx, best, P.treadForage);
    }
    if (total > 0) { addStore(v, c, total); if (res === 'stone') v.year.stone += total; else v.year.wood += total; }
    return;
  }
  if (cm.regional) {
    const tiles = neighbors(w, v.tile, 2, true).filter(t => w.tiles[t].extra[c]);
    if (!tiles.length) return;
    for (let i = 0; i < workers; i++) {
      let best = -1, bestFrac = 0;
      for (const t of tiles) { const e = w.tiles[t].extra[c]; const frac = div(e.stock, e.cap); if (frac > bestFrac) { bestFrac = frac; best = t; } }
      if (best === -1) break;
      const e = w.tiles[best].extra[c]; const y = Math.min(e.stock, mul(P.yield.regional, bestFrac)); e.stock -= y; total += y;
      if (best !== v.tile) tread(ctx, best, P.treadForage);
    }
    if (total > 0) { addStore(v, c, total); v.year.gathered += total; }
  }
}

/** Returns number of plots finished this week. */
function clearPlots(v: Village, workers: number): number {
  let done = 0; let effort = workers * K;
  const labor = mul(P.clearLabor, hasCap(v, 'metaltools') ? 500 : hasCap(v, 'stonetools') ? 750 : K);
  while (effort > 0) {
    const plot = v.plots.find(p => p.kind === 'wild' && p.progress > 0) ?? v.plots.find(p => p.kind === 'wild');
    if (!plot) break;
    const need = labor - plot.progress; const put = Math.min(need, effort); plot.progress += put; effort -= put;
    if (plot.progress >= labor) { plot.kind = 'clear'; plot.progress = 0; done++; addStore(v, 'wood', 3000); }
  }
  return done;
}

function farm(ctx: Ctx, v: Village, workers: number, season: number, maxPlots: number, cropId: string): void {
  const { w } = ctx;
  const crop = commodityById(w, cropId); const plantable = crop?.crop && (cropId === 'grain' || v.recipes.some(r => recipeById(w, r)?.output.crop === cropId));
  if (season === 0) {
    if (!plantable) return;
    let n = workers * P.plotsPerFarmer;
    if (maxPlots > 0) { const already = v.plots.filter(p => p.planted).length; n = Math.min(n, Math.max(0, maxPlots - already)); }
    const cands = v.plots.filter(p => (p.kind === 'clear' || p.kind === 'field') && !p.planted && p.recipe === '').sort((a, b) => b.fertility - a.fertility);
    for (const p of cands) { if (n === 0) break; p.planted = true; p.kind = 'field'; p.crop = cropId; n--; }
  } else if (season === 2) {
    let n = workers * P.plotsPerFarmer; const out: Record<string, number> = {}; let plots = 0;
    let wf = harvestWeatherFactor(currentRoll(ctx));
    if (hasCap(v, 'irrigation') && nearWater(w, v)) { if (wf < K) wf = 800; wf = mul(wf, 1300); }
    if (hasCap(v, 'plough')) wf = mul(wf, 1300);
    for (const p of v.plots) {
      if (n === 0) break; if (!p.planted) continue;
      const c = commodityById(w, p.crop || 'grain'); const perPlot = c?.crop?.yield ?? P.harvestPerPlot;
      const y = mul(mul(perPlot, p.fertility), wf); out[p.crop || 'grain'] = (out[p.crop || 'grain'] ?? 0) + y; plots++; n--;
      p.planted = false; p.crop = ''; p.fertility = Math.max(0, p.fertility - P.fertilityDropPerHarvest);
    }
    let qty = 0; for (const [c, q] of Object.entries(out)) { addStore(v, c, q); qty += q; }
    if (qty > 0) { v.year.farm += qty; ctx.events.push({ t: w.tick, type: 'Harvested', village: v.id, qty, plots }); }
  }
}

/** Returns plots cleared as a side effect (when no cleared plot was available). */
function build(ctx: Ctx, v: Village, recipeId: string, workers: number): number {
  const { w } = ctx; const r = recipeById(w, recipeId); if (!r || !r.output.structure || !v.recipes.includes(recipeId)) return 0;
  let plot = v.plots.find(p => p.kind === 'clear' && p.recipe === recipeId && p.progress > 0);
  if (!plot) {
    const free = v.plots.find(p => p.kind === 'clear' && p.recipe === '' && !p.planted && p.progress === 0);
    if (!free) return clearPlots(v, workers);
    for (const inp of r.inputs) if (storeQty(v, inp.c) < inp.qty) return 0;
    for (const inp of r.inputs) takeStore(v, inp.c, inp.qty);
    plot = free; plot.recipe = recipeId;
  }
  plot.progress += mul(workers * K, div(K, craftLaborMult(v)));
  if (plot.progress >= r.labor * K) { plot.kind = 'structure'; plot.progress = 0; plot.planted = false; ctx.events.push({ t: w.tick, type: 'Built', village: v.id, recipe: recipeId }); }
  return 0;
}

/** Craft a known recipe: capabilities once, commodities repeatedly. Returns true when the order is finished. */
function craft(ctx: Ctx, v: Village, recipeId: string, workers: number, qty: number, o: Order): boolean {
  const { w } = ctx; const r = recipeById(w, recipeId);
  if (!r || !v.recipes.includes(recipeId) || r.output.structure || r.output.crop) return true;
  if (r.requires && !hasCap(v, r.requires)) return true;
  if (r.output.capability && hasCap(v, r.output.capability)) return true;
  if (r.output.capability === 'irrigation' && !nearWater(w, v)) return true;
  const started = (v.craft[recipeId] ?? 0) > 0;
  if (!started) {
    for (const inp of r.inputs) if (storeQty(v, inp.c) < inp.qty) return false;   // wait for inputs
    for (const inp of r.inputs) takeStore(v, inp.c, inp.qty);
    v.craft[recipeId] = 1;
  }
  v.craft[recipeId] = (v.craft[recipeId] ?? 0) + mul(workers * K, div(K, craftLaborMult(v)));
  if (v.craft[recipeId] < r.labor * K) return false;
  v.craft[recipeId] = 0;
  if (r.output.capability) {
    v.capabilities.push(r.output.capability);
    ctx.events.push({ t: w.tick, type: 'CapabilityGained', village: v.id, capability: r.output.capability });
    return true;
  }
  if (r.output.commodity) {
    addStore(v, r.output.commodity.c, r.output.commodity.qty); learnCommodities(w, v);
    v.year.crafted += r.output.commodity.qty;
    ctx.events.push({ t: w.tick, type: 'Crafted', village: v.id, recipe: recipeId, qty: r.output.commodity.qty });
    const made = Number(o.params.made ?? 0) + r.output.commodity.qty; o.params.made = made;
    return qty > 0 && made >= qty;
  }
  return true;
}

function isCapability(s: string): s is Capability { return (CAPABILITIES as readonly string[]).includes(s); }

/** Research: name one ingredient to explore, two (or one plus a capability) to test a specific idea. */
function research(ctx: Ctx, v: Village, ingredients: string, workers: number): void {
  const { w } = ctx; const rng = ctx.rng.get('research');
  const parts = ingredients.split(',').map(s => s.trim()).filter(Boolean);
  const comm = parts.filter(p => !isCapability(p) && v.known.includes(p));
  const caps = parts.filter(isCapability);
  if (!comm.length && !caps.length) return;
  const unknown = w.recipes.filter(r => !v.recipes.includes(r.id) && !r.start);
  const reachable = (r: Recipe) => r.inputs.every(i => v.known.includes(i.c)) && (!r.requires || hasCap(v, r.requires));
  const cands = unknown.filter(r => reachable(r) && comm.every(c => r.inputs.some(i => i.c === c)) && caps.every(c => r.requires === c));
  const focused = comm.length >= 2 || (comm.length >= 1 && caps.length >= 1);
  for (let i = 0; i < workers; i++) {
    if (cands.length) {
      const r = cands[rng.int(cands.length)];
      const exact = r.inputs.length === comm.length && r.inputs.every(inp => comm.includes(inp.c));
      const hintsDone = (v.hints[r.id] ?? 0) >= r.hints.length && r.hints.length > 0;
      let p = focused ? P.researchFocused : P.researchExplore;
      if (exact) p *= 2; if (hintsDone) p = Math.max(p, P.researchKnown);
      if (rng.chance(Math.min(900, p))) { discover(ctx, v, r, 'research'); return; }
    }
    // a failed attempt may still reveal a hint about something that shares an ingredient
    const related = unknown.filter(r => reachable(r) && (v.hints[r.id] ?? 0) < r.hints.length && (comm.some(c => r.inputs.some(i => i.c === c)) || caps.some(c => r.requires === c)));
    if (related.length && rng.chance(focused ? P.hintFocused : P.hintExplore)) {
      const r = related[rng.int(related.length)]; const k = v.hints[r.id] ?? 0; v.hints[r.id] = k + 1;
      ctx.events.push({ t: w.tick, type: 'HintRevealed', village: v.id, recipe: r.id, hint: r.hints[k] });
    }
  }
}

export function discover(ctx: Ctx, v: Village, r: Recipe, how: 'research' | 'accident' | 'transfer'): void {
  if (v.recipes.includes(r.id)) return;
  v.recipes.push(r.id); v.hints[r.id] = r.hints.length;
  learnCommodities(ctx.w, v);
  ctx.events.push({ t: ctx.w.tick, type: 'Discovered', village: v.id, recipe: r.id, how });
}

/** Cooks have accidents: a village with fire may stumble on a tier-1 food recipe whose inputs it holds. */
function serendipity(ctx: Ctx, v: Village): void {
  const { w } = ctx; const rng = ctx.rng.get('research');
  if (!rng.chance(P.serendipity, 100_000)) return;
  const cands = w.recipes.filter(r => !v.recipes.includes(r.id) && !r.start && r.tier === 1 && (!r.requires || hasCap(v, r.requires)) && r.inputs.every(i => storeQty(v, i.c) > 0));
  if (cands.length) discover(ctx, v, cands[rng.int(cands.length)], 'accident');
}

/** Build a road on a well-trodden tile within reach of the village. Returns true when done or impossible. */
function road(ctx: Ctx, v: Village, tile: number, workers: number): boolean {
  const { w } = ctx; if (!hasCap(v, 'roadbuilding')) return true;
  if (tile < 0 || tile >= w.tiles.length) return true;
  const t = w.tiles[tile]; if (t.road || !TERRAIN[t.terrain].passable || neighbors(w, v.tile, 3, true).indexOf(tile) < 0) return true;
  if (t.trodden < P.roadAt) return true;
  const key = `road:${tile}`;
  if (!(v.craft[key] > 0)) { if (storeQty(v, 'stone') < P.roadStone) return false; takeStore(v, 'stone', P.roadStone); v.craft[key] = 1; }
  v.craft[key] += workers * K;
  if (v.craft[key] < P.roadLabor * K) return false;
  delete v.craft[key]; t.road = true; ctx.events.push({ t: w.tick, type: 'RoadBuilt', village: v.id, tile });
  return true;
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
  const boat = hasCap(v, 'paddle');
  const passable = (t: number) => TERRAIN[w.tiles[t].terrain].passable || (boat && TERRAIN[w.tiles[t].terrain].water);
  if (!passable(target)) { const alt = neighbors(w, target, 2).find(passable); if (alt === undefined) return 0; target = alt; }
  const members = takeAdults(v, w.tick, n);
  const rations = takeStore(v, 'grain', members.length * 4 * P.foodPerPersonWeek);
  const party = spawnParty(ctx, v, 'explore', members, rations, target, { boat, cart: hasCap(v, 'cart'), sail: hasCap(v, 'sail') });
  if (!party) { v.people.push(...members); addStore(v, 'grain', rations); return 0; }
  return n;
}

function envoy(ctx: Ctx, v: Village, o: Order, free: number): number {
  const { w } = ctx; const target = w.villages[Number(o.params.target ?? -1)];
  if (!target || !target.alive || target.id === v.id || !v.knowledge.villages.includes(target.id)) return 0;
  const n = Math.max(1, Math.min(o.workers || 2, free)); if (free < n) return 0;
  const offer = parseGoods(String(o.params.offer ?? '')); const want = parseGoods(String(o.params.want ?? ''));
  for (const c of Object.keys(offer)) offer[c] = Math.min(offer[c], storeQty(v, c));
  const members = takeAdults(v, w.tick, n);
  const rations = takeStore(v, 'grain', members.length * 6 * P.foodPerPersonWeek);
  const party = spawnParty(ctx, v, 'envoy', members, rations, target.tile, { boat: hasCap(v, 'paddle'), cart: hasCap(v, 'cart'), sail: hasCap(v, 'sail') });
  if (!party) { v.people.push(...members); addStore(v, 'grain', rations); return 0; }
  party.targetVillage = target.id;
  const capacity = members.length * P.carryPerPerson * (party.cart ? 3 : 1) * (party.boat ? 4 : 1); let room = capacity;
  for (const [c, q] of Object.entries(offer)) { const take = Math.min(q, room); if (take <= 0) continue; takeStore(v, c, take); addCargo(party, c, take); room -= take; }
  party.mandate = { offer: Object.fromEntries(party.cargo.map(s => [s.c, s.qty])), want, floor: Math.max(0, Math.min(K, Number(o.params.floor ?? 700))), transfer: o.params.transfer ? String(o.params.transfer) : undefined, threat: !!o.params.threat, message: o.params.message ? String(o.params.message) : undefined };
  return n;
}

function raid(ctx: Ctx, v: Village, o: Order, free: number): number {
  const { w } = ctx; const target = w.villages[Number(o.params.target ?? -1)];
  if (!target || !target.alive || target.id === v.id || !v.knowledge.villages.includes(target.id)) return 0;
  const n = Math.min(o.workers, free); if (n < 2) return 0;
  const members = takeAdults(v, w.tick, n);
  const rations = takeStore(v, 'grain', members.length * 6 * P.foodPerPersonWeek);
  const party = spawnParty(ctx, v, 'raid', members, rations, target.tile, { boat: hasCap(v, 'paddle'), cart: hasCap(v, 'cart'), sail: hasCap(v, 'sail') });
  if (!party) { v.people.push(...members); addStore(v, 'grain', rations); return 0; }
  party.targetVillage = target.id;
  return n;
}

/** Send a party to a known far tile to collect a commodity for some weeks and bring it back. */
function expedition(ctx: Ctx, v: Village, o: Order, free: number): number {
  const { w } = ctx; const c = String(o.params.c ?? ''); const cm = commodityById(w, c); if (!cm) return 0;
  const n = Math.min(o.workers, free); if (n < 1) return 0;
  const has = (t: number) => cm.regional ? !!w.tiles[t].extra[c] : cm.source ? w.tiles[t].cap[cm.source] > 0 && w.tiles[t].village === -1 : false;
  let target = Number(o.params.tile ?? -1);
  if (target < 0 || !has(target)) { let best = -1, bestD = 99; for (const t of v.knowledge.tiles) if (has(t)) { const d = Math.max(Math.abs(xy(w, t)[0] - xy(w, v.tile)[0]), Math.abs(xy(w, t)[1] - xy(w, v.tile)[1])); if (d > 1 && d < bestD) { bestD = d; best = t; } } target = best; }
  if (target < 0) return 0;
  const weeks = Math.max(1, Math.min(8, Number(o.params.weeks ?? 3)));
  const members = takeAdults(v, w.tick, n);
  const rations = takeStore(v, 'grain', members.length * (weeks + 4) * P.foodPerPersonWeek);
  const party = spawnParty(ctx, v, 'expedition', members, rations, target, { boat: hasCap(v, 'paddle'), cart: hasCap(v, 'cart'), sail: hasCap(v, 'sail') });
  if (!party) { v.people.push(...members); addStore(v, 'grain', rations); return 0; }
  party.gather = { c, weeks };
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
  const party = spawnParty(ctx, v, 'colonize', members, rations, target, { boat: hasCap(v, 'paddle'), cart: hasCap(v, 'cart'), sail: hasCap(v, 'sail') });
  if (!party) { v.people.push(...members); addStore(v, 'grain', rations); return 0; }
  return nAdults;
}
