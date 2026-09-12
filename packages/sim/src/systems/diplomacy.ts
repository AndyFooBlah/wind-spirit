/** Envoys, trade by mandate, tech transfer, tribute, raids, refugees, grudges. */
import { K, mul } from '../fixed.js';
import { P } from '../params.js';
import type { HostAnswer, Mandate, Party, Village } from '../types.js';
import { addStore, goodsTotal, hasCap, knowledgeUnion, popCounts, recipeById, relation, stageOf, storeQty, structures, takeStore, type Ctx } from '../world.js';
import { discover } from './work.js';

/** An envoy reaches the host village: share knowledge, remember each other, ask the host chief. */
export function envoyArrives(ctx: Ctx, p: Party, host: Village): void {
  const { w } = ctx; const home = w.villages[p.home];
  meet(ctx, home, host, p);
  // a gift of knowledge is given on arrival, whatever comes of the trade
  if (p.mandate?.transfer) { const r = recipeById(w, p.mandate.transfer); if (r && home.recipes.includes(r.id) && !host.recipes.includes(r.id)) { discover(ctx, host, r, 'transfer'); relation(host, p.home).grudge = Math.max(0, relation(host, p.home).grudge - 100); ctx.events.push({ t: w.tick, type: 'TechTransferred', village: host.id, from: p.home, recipe: r.id }); } }
  p.waiting = 1;
  ctx.events.push({ t: w.tick, type: 'VisitorArrived', village: host.id, party: p.id, from: p.home, mandate: p.mandate ?? { offer: {}, want: {}, floor: K } });
}

function meet(ctx: Ctx, a: Village, b: Village, p?: Party): void {
  const { w } = ctx;
  for (const [x, y] of [[a, b], [b, a]] as [Village, Village][]) {
    const r = relation(x, y.id); r.lastContact = w.tick; r.sizeSeen = y.people.length;
    if (!x.knowledge.villages.includes(y.id)) x.knowledge.villages.push(y.id);
  }
  if (p) { knowledgeUnion(b.knowledge, p.seen); for (const t of b.knowledge.tiles) if (!p.seen.includes(t)) p.seen.push(t); }
}

/** Apply the host chief's answer to a waiting envoy. Executes the exchange and sends the envoy home. */
export function hostDecides(ctx: Ctx, host: Village, p: Party, answer: HostAnswer): void {
  const { w } = ctx; const home = w.villages[p.home]; const m = p.mandate ?? { offer: {}, want: {}, floor: K };
  p.waiting = 0;
  const offered = cargoOf(p);
  let give: Record<string, number> = {}, take: Record<string, number> = {};
  if (answer.kind === 'accept') { give = { ...m.want }; take = { ...offered }; }
  else if (answer.kind === 'counter') { give = { ...answer.give }; take = { ...answer.take }; }
  if (answer.kind === 'refuse') {
    if (m.threat) relation(home, host.id).grudge = Math.min(K, relation(home, host.id).grudge + 300);
    ctx.events.push({ t: w.tick, type: 'TradeRefused', village: host.id, guest: p.home, reason: answer.reason ?? '' });
    p.result = 'refused'; goHome(ctx, p); return;
  }
  // the host can only give what it has; the envoy only accepts if the deal clears its floor
  for (const c of Object.keys(give)) give[c] = Math.min(give[c], storeQty(host, c));
  for (const c of Object.keys(take)) take[c] = Math.min(take[c], offered[c] ?? 0);
  const wanted = goodsTotal(m.want);
  if (wanted > 0 && goodsTotal(give) < mul(wanted, m.floor)) {
    ctx.events.push({ t: w.tick, type: 'TradeRefused', village: host.id, guest: p.home, reason: 'below floor' });
    p.result = 'no deal'; goHome(ctx, p); return;
  }
  for (const [c, q] of Object.entries(take)) { takeCargo(p, c, q); addStore(host, c, q); }
  for (const [c, q] of Object.entries(give)) { takeStore(host, c, q); addCargo(p, c, q); }
  const rh = relation(host, p.home), rg = relation(home, host.id);
  rh.trades++; rg.trades++; rh.grudge = Math.max(0, rh.grudge - 100); rg.grudge = Math.max(0, rg.grudge - 100);
  if (m.threat && goodsTotal(give) > 0) ctx.events.push({ t: w.tick, type: 'TributePaid', village: host.id, to: p.home, goods: give });
  else ctx.events.push({ t: w.tick, type: 'TradeCompleted', village: host.id, guest: p.home, gave: give, got: take });
  p.result = 'traded'; goHome(ctx, p);
}

/** Envoys that wait too long give up. */
export function envoyTimeouts(ctx: Ctx): void {
  for (const p of ctx.w.parties) if (p.kind === 'envoy' && p.waiting > 0) {
    p.waiting++;
    if (p.waiting > P.envoyPatience) { const host = ctx.w.villages[p.targetVillage ?? -1]; if (host) ctx.events.push({ t: ctx.w.tick, type: 'TradeRefused', village: host.id, guest: p.home, reason: 'no answer' }); p.result = 'ignored'; goHome(ctx, p); }
  }
}

function goHome(ctx: Ctx, p: Party): void { p.returning = true; p.route = []; /* travel.ts routes home next tick */ }

export function cargoOf(p: Party): Record<string, number> { const out: Record<string, number> = {}; for (const s of p.cargo) out[s.c] = (out[s.c] ?? 0) + s.qty; return out; }
export function addCargo(p: Party, c: string, qty: number): void { if (qty <= 0) return; const s = p.cargo.find(x => x.c === c); if (s) s.qty += qty; else p.cargo.push({ c, qty, age: 0 }); }
export function takeCargo(p: Party, c: string, qty: number): number { let left = qty; for (const s of p.cargo) if (s.c === c) { const t = Math.min(s.qty, left); s.qty -= t; left -= t; } p.cargo = p.cargo.filter(s => s.qty > 0); return qty - left; }

/** Combat strength multiplier from weapons. */
function weapons(v: Village): number { let f = K; if (hasCap(v, 'spear')) f += 200; if (hasCap(v, 'bow')) f += 400; if (hasCap(v, 'bronzeweapons')) f += 800; return f; }

/** Raiders reach the target: resolve the engagement, take what they can, or destroy the village. */
export function raidArrives(ctx: Ctx, p: Party, host: Village): void {
  const { w } = ctx; const rng = ctx.rng.get('combat'); const home = w.villages[p.home];
  const defendersN = host.people.filter(x => stageOf(x.born, w.tick) === 'adult').length;
  let defense = K; for (const s of structures(w, host)) if (s.output.structure?.defense) defense = Math.max(defense, s.output.structure.defense);
  const seen = host.knowledge.tiles.includes(p.at) && !p.boat; const watched = structures(w, host).some(s => s.output.structure?.watch);
  const surprise = seen ? K : p.boat && !watched ? 1500 : 1300;
  const A = mul(mul(p.members.length * K, weapons(home)), surprise) * (700 + rng.int(600)) / K;
  const D = mul(mul(Math.max(1, defendersN) * K, weapons(host)), defense) * (700 + rng.int(600)) / K;
  const ratio = D > 0 ? A / D : 10;
  const success = ratio > 1;
  const attackersLost = Math.min(p.members.length, Math.round(p.members.length * 0.15 * Math.min(3, 1 / Math.max(0.2, ratio))));
  const defendersLost = Math.min(defendersN, Math.round(defendersN * 0.15 * Math.min(3, ratio)));
  for (const m of p.members.splice(0, attackersLost)) ctx.events.push({ t: w.tick, type: 'Died', village: p.home, person: m.id, cause: 'raid', stage: 'adult' }); home.year.deathsRaid += attackersLost;
  let lost = defendersLost; host.people = host.people.filter(x => { if (lost > 0 && stageOf(x.born, w.tick) === 'adult' && x.id !== host.chief) { lost--; ctx.events.push({ t: w.tick, type: 'Died', village: host.id, person: x.id, cause: 'raid', stage: 'adult' }); return false; } return true; });
  host.year.deathsRaid += defendersLost;
  const taken: Record<string, number> = {}; let destroyed = false;
  if (success) {
    const capacity = p.members.length * P.carryPerPerson * (p.cart ? 3 : 1);
    let room = capacity;
    for (const s of [...host.stores].sort((a, b) => b.qty - a.qty)) { if (room <= 0) break; const q = Math.min(s.qty, Math.trunc(s.qty * 0.6), room); if (q <= 0) continue; takeStore(host, s.c, q); addCargo(p, s.c, q); taken[s.c] = (taken[s.c] ?? 0) + q; room -= q; }
    if (ratio > 3 && defendersN - defendersLost < 3) {
      destroyed = true; host.alive = false; w.tiles[host.tile].village = -1;
      ctx.events.push({ t: w.tick, type: 'VillageDied', village: host.id });
      // survivors flee to the nearest other village
      const survivors = host.people; host.people = [];
      const others = w.villages.filter(v => v.alive && v.id !== host.id && v.id !== p.home);
      if (survivors.length && others.length) { const dest = others[0]; const rp: Party = { id: w.nextId++, home: host.id, kind: 'refugee', members: survivors, rations: 0, cargo: [], mode: 'foraging', boat: false, cart: false, sail: false, route: [], at: host.tile, dayCarry: 0, target: dest.id, returning: true, seen: [], lostWeeks: 0, waiting: 0 }; w.parties.push(rp); }
    }
  }
  const rh = relation(host, p.home), rg = relation(home, host.id);
  rh.raids++; rh.grudge = Math.min(K, rh.grudge + (success ? 500 : 300)); rg.lastContact = w.tick; rh.lastContact = w.tick; rg.sizeSeen = defendersN;
  if (!host.knowledge.villages.includes(p.home)) host.knowledge.villages.push(p.home);
  ctx.events.push({ t: w.tick, type: 'RaidResolved', attacker: p.home, defender: host.id, success, attackersLost, defendersLost, taken, destroyed });
  p.result = success ? 'raided' : 'repulsed'; goHome(ctx, p);
}

export function decayGrudges(ctx: Ctx): void {
  if (ctx.w.tick % 13 !== 0) return;
  for (const v of ctx.w.villages) for (const r of Object.values(v.relations)) if (r.grudge > 0) r.grudge = Math.max(0, r.grudge - 10);
}

export { popCounts };
