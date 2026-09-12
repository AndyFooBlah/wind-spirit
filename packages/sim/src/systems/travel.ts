import { K, mul } from '../fixed.js';
import { P, seasonOf, TERRAIN, TILE_MILES, WEEKS_PER_YEAR } from '../params.js';
import type { Party, PartyKind, Person, Village, World } from '../types.js';
import { addStore, foundVillage, knowledgeUnion, neighbors, xy, type Ctx } from '../world.js';
import { isPath, tread } from './paths.js';

/** Days (thousandths) to enter `to` from adjacent `from`. Infinity if impassable. Boats may use water at paddle or sail speed. */
export function stepCost(w: World, from: number, to: number, boat = false, sail = false): number {
  const t = w.tiles[to]; const info = TERRAIN[t.terrain];
  if (info.water) { if (!boat) return Infinity; const [fx, fy] = xy(w, from), [tx, ty] = xy(w, to); const diag = fx !== tx && fy !== ty; return Math.trunc((TILE_MILES * (diag ? 1414 : 1000)) / (sail ? 60 : 25)); }
  if (!info.passable) return Infinity;
  const mpd = isPath(t.trodden, t.road) ? info.mpdPath : info.mpdWild;
  const [fx, fy] = xy(w, from), [tx, ty] = xy(w, to);
  const diagonal = fx !== tx && fy !== ty;
  let days = Math.trunc((TILE_MILES * K * (diagonal ? 1414 : 1000)) / (mpd * K));
  if (t.terrain === 'river' && !t.ford && !t.road) days += 1000;
  return days;
}

/** A* route from `from` to `to` over passable tiles. Returns tiles to enter in order (excluding `from`); empty if unreachable. */
export function route(w: World, from: number, to: number, boat = false, sail = false): number[] {
  if (from === to) return [];
  const n = w.width * w.height;
  const g = new Float64Array(n).fill(Infinity); const came = new Int32Array(n).fill(-1);
  const [tx, ty] = xy(w, to);
  const h = (id: number) => { const [x, y] = xy(w, id); return Math.max(Math.abs(x - tx), Math.abs(y - ty)) * 200; };
  // binary heap of [f, id]
  const heap: number[][] = []; const push = (f: number, id: number) => { heap.push([f, id]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = (): number[] => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  g[from] = 0; push(h(from), from);
  const closed = new Uint8Array(n);
  while (heap.length) {
    const [, cur] = pop();
    if (cur === to) break;
    if (closed[cur]) continue; closed[cur] = 1;
    for (const nb of neighbors(w, cur, 1)) {
      const c = stepCost(w, cur, nb, boat, sail); if (c === Infinity) continue;
      const ng = g[cur] + c;
      if (ng < g[nb]) { g[nb] = ng; came[nb] = cur; push(ng + h(nb), nb); }
    }
  }
  if (g[to] === Infinity) return [];
  const out: number[] = []; for (let c = to; c !== from; c = came[c]) out.push(c);
  return out.reverse();
}

function addSeen(p: Party, tiles: number[]): void { for (const t of tiles) if (!p.seen.includes(t)) p.seen.push(t); }

export function spawnParty(ctx: Ctx, v: Village, kind: PartyKind, members: Person[], rations: number, target: number, gear: { boat: boolean; cart: boolean; sail: boolean } = { boat: false, cart: false, sail: false }): Party | null {
  const { w } = ctx;
  const r = route(w, v.tile, target, gear.boat, gear.sail);
  if (!r.length && target !== v.tile) return null;
  for (const m of members) m.hungry = 0;
  const p: Party = { id: w.nextId++, home: v.id, kind, members, rations, cargo: [], mode: 'provisioned', boat: gear.boat, cart: gear.cart, sail: gear.sail, route: r, at: v.tile, dayCarry: 0, target, returning: false, seen: [], lostWeeks: 0 };
  addSeen(p, neighbors(w, v.tile, 1, true));
  w.parties.push(p);
  ctx.events.push({ t: w.tick, type: 'PartyLeft', village: v.id, party: p.id, kind, size: members.length });
  return p;
}

export function moveParties(ctx: Ctx): void {
  const { w } = ctx; const rng = ctx.rng.get('travel'); const mort = ctx.rng.get('mortality');
  const winter = seasonOf(w.tick) === 3;
  for (const p of [...w.parties]) {
    const home = w.villages[p.home];
    if (p.lostWeeks > 0) { p.lostWeeks--; eat(ctx, p); continue; }
    if (p.route.length && !home.knowledge.tiles.includes(p.at) && rng.chance(P.lostChanceK)) { p.lostWeeks = 1; eat(ctx, p); continue; }
    let mult = K;
    if (p.mode === 'foraging') mult = winter ? P.winterForagingSpeed : P.foragingSpeed; else if (winter) mult = P.winterSpeed;
    if (!p.cart && p.rations > p.members.length * 2 * P.foodPerPersonWeek) mult = mul(mult, P.loadSpeed);
    let budget = mul(7000, mult) + p.dayCarry;
    while (p.route.length) {
      const next = p.route[0]; const cost = stepCost(w, p.at, next, p.boat, p.sail);
      if (cost === Infinity) { p.route = route(w, p.at, p.route[p.route.length - 1], p.boat, p.sail); if (!p.route.length) break; continue; }
      if (cost > budget) break;
      budget -= cost; p.at = next; p.route.shift();
      if (!TERRAIN[w.tiles[next].terrain].water) tread(ctx, next, p.cart ? P.treadCart : P.treadParty);
      addSeen(p, neighbors(w, next, 1, true));
    }
    p.dayCarry = Math.min(budget, 3500);
    eat(ctx, p);
    // starvation
    const survivors: Person[] = [];
    for (const m of p.members) {
      if (m.hungry > 0) {
        const h = m.hungry / 1000; const pM = Math.min(999_999, Math.trunc((P.annualDeath.adult / WEEKS_PER_YEAR) * (1 + h * h * h)));
        if (mort.chanceM(pM)) { home.year.deathsTravel++; ctx.events.push({ t: w.tick, type: 'Died', village: p.home, person: m.id, cause: 'travel', stage: 'adult' }); continue; }
      }
      survivors.push(m);
    }
    p.members = survivors;
    if (!p.members.length) { ctx.events.push({ t: w.tick, type: 'PartyLost', village: p.home, party: p.id, cause: 'starved' }); remove(w, p); continue; }
    if (!p.route.length) arrive(ctx, p);
  }
}

function eat(ctx: Ctx, p: Party): void {
  const need = p.members.length * P.foodPerPersonWeek;
  const t = ctx.w.tiles[p.at].terrain; const canForage = TERRAIN[t].forage || (p.boat && TERRAIN[t].water);
  const fed = () => { for (const m of p.members) m.hungry = 0; };
  const starve = () => { p.rations = 0; for (const m of p.members) m.hungry = Math.min(12_000, m.hungry + 1000); };
  if (p.mode === 'provisioned') {
    if (p.rations >= need) { p.rations -= need; fed(); }
    else if (canForage) { p.mode = 'foraging'; p.rations = 0; fed(); }
    else starve();
  } else if (canForage) fed();
  else if (p.rations >= need) { p.rations -= need; fed(); }
  else starve();
}

function remove(w: World, p: Party): void { w.parties = w.parties.filter(q => q.id !== p.id); }

function habitable(w: World, tile: number): boolean {
  const t = w.tiles[tile]; const info = TERRAIN[t.terrain];
  return info.passable && info.forage && t.village === -1 && t.terrain !== 'mountain';
}

function arrive(ctx: Ctx, p: Party): void {
  const { w } = ctx; const home = w.villages[p.home];
  if (p.kind === 'refugee') {
    const target = w.villages[p.target];
    if (target && target.alive) { for (const m of p.members) { m.hungry = 0; target.people.push(m); } }
    remove(w, p); return;
  }
  if (p.kind === 'colonize' && !p.returning) {
    let site = habitable(w, p.at) ? p.at : -1;
    if (site === -1) for (const nb of neighbors(w, p.at, 2)) if (habitable(w, nb)) { site = nb; break; }
    if (site !== -1 && site !== p.at) { p.route = route(w, p.at, site, p.boat, p.sail); if (p.route.length) return; site = -1; }
    if (site !== -1) {
      const v = foundVillage(ctx, { tile: site, people: p.members, parent: p.home, culture: home.culture, recipes: home.recipes, capabilities: home.capabilities.filter(c => ['fire', 'stonetools', 'spear', 'net', 'paddle', 'drying', 'pottery', 'weaving', 'bow', 'medicine'].includes(c)),
        knownTiles: [...home.knowledge.tiles, ...p.seen], food: p.rations, tents: Math.max(2, Math.ceil(p.members.length / 5)) });
      v.knowledge.villages.push(p.home); if (!home.knowledge.villages.includes(v.id)) home.knowledge.villages.push(v.id);
      knowledgeUnion(home.knowledge, p.seen);
      ctx.events.push({ t: w.tick, type: 'VillageFounded', village: v.id, parent: p.home, tile: site, size: p.members.length });
      remove(w, p); return;
    }
  }
  if (!p.returning) {
    p.returning = true;
    if (!home.alive) return goRefugee(ctx, p);
    p.route = route(w, p.at, home.tile, p.boat, p.sail);
    if (!p.route.length && p.at !== home.tile) { remove(w, p); }
    return;
  }
  if (!home.alive) return goRefugee(ctx, p);
  for (const m of p.members) { m.hungry = 0; home.people.push(m); }
  knowledgeUnion(home.knowledge, p.seen);
  if (p.rations > 0) addStore(home, 'plants', p.rations);
  for (const s of p.cargo) addStore(home, s.c, s.qty, s.age);
  ctx.events.push({ t: w.tick, type: 'PartyReturned', village: p.home, party: p.id, tilesSeen: p.seen.length });
  remove(w, p);
}

function goRefugee(ctx: Ctx, p: Party): void {
  const { w } = ctx;
  let best = -1, bestD = Infinity;
  for (const v of w.villages) if (v.alive) { const d = route(w, p.at, v.tile, p.boat, p.sail).length; if (d && d < bestD) { bestD = d; best = v.id; } }
  if (best === -1) { remove(w, p); return; }
  p.kind = 'refugee'; p.target = best; p.route = route(w, p.at, w.villages[best].tile, p.boat, p.sail); p.returning = true;
}
