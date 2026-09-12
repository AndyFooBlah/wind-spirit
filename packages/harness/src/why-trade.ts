import { Rng, Sim, storeQty, recipeById, commodityById, hasCap, type Input, type Recipe } from '@wind-spirit/sim';
import { generateWorld } from '@wind-spirit/gen';
import { POLICIES, hostAnswer } from './policies.js';
const [seed = 'run-0', years = '60'] = process.argv.slice(2).filter(a => a !== '--');
const w = generateWorld({ seed }); const sim = new Sim(w); const rng = Rng.fromSeed(seed, 'work'); const mem: Record<number, Record<string, number>> = {};
for (let t = 0; t < Number(years) * 52; t++) {
  const ev = sim.tick(); const q: Input[] = [];
  for (const e of ev) {
    if (e.type === 'DeliberationRequested') { const v = w.villages[e.village]; if (v.alive) q.push({ type: 'ChiefDecided', village: v.id, orders: POLICIES.sensible({ w, v, reason: e.reason, rng, mem: (mem[v.id] ??= {}) }), requestedAt: e.t }); }
    if (e.type === 'VisitorArrived') { const h = w.villages[e.village]; q.push({ type: 'HostDecided', village: h.id, party: e.party, answer: hostAnswer({ w, v: h, reason: 'visitor', rng, mem: (mem[h.id] ??= {}) }, e.mandate, w.villages[e.from]), requestedAt: e.t }); }
  }
  for (const i of q) sim.queue(i);
}
for (const v of w.villages.slice(0, 6)) {
  if (!v.alive) continue;
  const known = v.recipes.map(id => recipeById(w, id)).filter((r): r is Recipe => !!r);
  const lacking: string[] = [];
  for (const r of known) if (r.output.capability && !hasCap(v, r.output.capability)) for (const i of r.inputs) if (storeQty(v, i.c) < i.qty) lacking.push(`${r.id}:${i.c}`);
  const grain = storeQty(v, 'grain');
  console.log(`v${v.id} pop ${v.people.length} caps [${v.capabilities.join(',')}] knowsVillages [${v.knowledge.villages.join(',')}] grain ${Math.round(grain / 1000)}w=${Math.round(grain / 1000 / v.people.length)}wk lacking [${lacking.join(' ')}] known ${v.known.length} regionalKnown [${v.known.filter(c => commodityById(w, c)?.regional).join(',')}] mem ${JSON.stringify(mem[v.id] ?? {})}`);
}
