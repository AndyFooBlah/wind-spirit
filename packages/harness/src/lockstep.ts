/** Run the same seed twice in lockstep and report the first tick where snapshots diverge. Usage: tsx src/lockstep.ts <seed> <years> */
import { Rng, Sim, type Input } from '@wind-spirit/sim';
import { generateWorld } from '@wind-spirit/gen';
import { POLICIES } from './policies.js';
const [seed = 'rep', years = '20'] = process.argv.slice(2).filter(a => a !== '--');
function mk() { const w = generateWorld({ seed }); const sim = new Sim(w); const rng = Rng.fromSeed(seed, 'work'); const mem: Record<number, Record<string, number>> = {}; return { w, sim, rng, mem }; }
const A = mk(), B = mk();
if (A.sim.hash() !== B.sim.hash()) { console.log('worlds differ at generation'); process.exit(1); }
for (let t = 0; t < Number(years) * 52; t++) {
  for (const X of [A, B]) {
    const ev = X.sim.tick(); const q: Input[] = [];
    for (const e of ev) if (e.type === 'DeliberationRequested') { const v = X.w.villages[e.village]; if (v.alive) q.push({ type: 'ChiefDecided', village: v.id, orders: POLICIES.sensible({ w: X.w, v, reason: e.reason, rng: X.rng, mem: (X.mem[v.id] ??= {}) }), requestedAt: e.t }); }
    for (const i of q) X.sim.queue(i);
  }
  const a = A.sim.snapshot(), b = B.sim.snapshot();
  if (a !== b) {
    let i = 0; while (i < a.length && a[i] === b[i]) i++;
    console.log(`diverged at tick ${t}`); console.log('A:', a.slice(Math.max(0, i - 300), i + 200)); console.log('B:', b.slice(Math.max(0, i - 300), i + 200)); process.exit(1);
  }
}
console.log('identical for', years, 'years');
