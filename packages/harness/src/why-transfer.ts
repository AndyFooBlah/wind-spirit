import { Rng, Sim, type Input } from '@wind-spirit/sim';
import { generateWorld } from '@wind-spirit/gen';
import { POLICIES, hostAnswer } from './policies.js';
const seed = 'run-1'; const w = generateWorld({ seed }); const sim = new Sim(w); const rng = Rng.fromSeed(seed, 'work'); const mem: Record<number, Record<string, number>> = {};
let envoyOrders = 0, withTransfer = 0, visitorsWithTransfer = 0, completed = 0, transferred = 0, refused: Record<string, number> = {};
for (let t = 0; t < 200 * 52; t++) {
  const ev = sim.tick(); const q: Input[] = [];
  for (const e of ev) {
    if (e.type === 'DeliberationRequested') { const v = w.villages[e.village]; if (v.alive) { const orders = POLICIES.sensible({ w, v, reason: e.reason, rng, mem: (mem[v.id] ??= {}) }); for (const o of orders) if (o.task === 'envoy') { envoyOrders++; if (o.params.transfer) withTransfer++; } q.push({ type: 'ChiefDecided', village: v.id, orders, requestedAt: e.t }); } }
    if (e.type === 'VisitorArrived') { if (e.mandate.transfer) visitorsWithTransfer++; const h = w.villages[e.village]; q.push({ type: 'HostDecided', village: h.id, party: e.party, answer: hostAnswer({ w, v: h, reason: 'visitor', rng, mem: (mem[h.id] ??= {}) }, e.mandate, w.villages[e.from]), requestedAt: e.t }); }
    if (e.type === 'TradeCompleted') completed++;
    if (e.type === 'TradeRefused') refused[e.reason] = (refused[e.reason] ?? 0) + 1;
    if (e.type === 'TechTransferred') transferred++;
  }
  for (const i of q) sim.queue(i);
}
console.log({ envoyOrders, withTransfer, visitorsWithTransfer, completed, transferred, refused });
const pairs = w.villages.flatMap(v => Object.entries(v.relations).map(([id, r]) => r.trades)).filter(x => x > 0);
console.log('relations with trades>0:', pairs.length, 'max', Math.max(0, ...pairs));
