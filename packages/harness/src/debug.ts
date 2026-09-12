/** Weekly trace of one village under a policy, for tuning. Usage: tsx src/debug.ts <seed> <policy> <pop> <years> [village] */
import { Rng, Sim, seasonOf, popCounts, totalFood, neighbors, div, type Input, type Village } from '@wind-spirit/sim';
import { generateWorld } from '@wind-spirit/gen';
import { POLICIES, type PolicyName } from './policies.js';

const [seed = 'f20-0', policyName = 'forager', pop = '20', years = '40', vid = '0'] = process.argv.slice(2).filter(a => a !== '--');
const world = generateWorld({ seed, villages: 4, startPop: Number(pop) });
const sim = new Sim(world); const policy = POLICIES[policyName as PolicyName]; const rng = Rng.fromSeed(seed, 'work'); const mem: Record<number, Record<string, number>> = {};
const v: Village = world.villages[Number(vid)];
const prev = { food: 0 };
console.log('tick yr s | pop ch ad el | orders | prod need stores | hungerAvg calm | plants game fish (stock frac of best tile) | deaths');
for (let t = 0; t < Number(years) * 52; t++) {
  const events = sim.tick(); const queued: Input[] = [];
  let deaths = 0;
  for (const e of events) {
    if (e.type === 'DeliberationRequested') { const vv = world.villages[e.village]; if (vv.alive) queued.push({ type: 'ChiefDecided', village: vv.id, orders: policy({ w: world, v: vv, reason: e.reason, rng, mem: (mem[vv.id] ??= {}) }), requestedAt: e.t }); }
    if (e.type === 'Died' && e.village === v.id) deaths++;
  }
  for (const i of queued) sim.queue(i);
  const y = v.year; const food = y.forage + y.hunt + y.fish + y.farm; const prod = food - prev.food; prev.food = world.tick % 52 === 0 ? 0 : food;
  if (world.tick % 52 === 0) prev.food = 0;
  const c = popCounts(v, world.tick);
  const frac = (r: 'plants' | 'game' | 'fish') => Math.max(...neighbors(world, v.tile, 1, true).map(i => world.tiles[i].cap[r] ? div(world.tiles[i].stock[r], world.tiles[i].cap[r]) : 0));
  const hungerAvg = v.people.length ? Math.trunc(v.people.reduce((s, p) => s + p.hungry, 0) / v.people.length) : 0;
  const orders = v.orders.map(o => `${o.task}${o.workers}`).join(' ');
  const fields = v.plots.filter(p => p.kind === 'clear' || p.kind === 'field'); const planted = fields.filter(p => p.planted).length; const fert = fields.length ? Math.trunc(fields.reduce((s, p) => s + p.fertility, 0) / fields.length) : 0;
  if (t % 4 === 0 || deaths > 0) console.log(`${String(world.tick).padStart(4)} ${String(Math.floor(world.tick / 52)).padStart(2)} ${seasonOf(world.tick)} | ${String(c.total).padStart(3)} ${c.children} ${c.adults} ${c.elders} | ${orders.padEnd(28)} | ${String(Math.round(prod / 1000)).padStart(3)} ${String(v.people.length).padStart(3)} ${String(Math.round(totalFood(world, v) / 1000)).padStart(4)} | ${String(hungerAvg).padStart(5)} ${String(v.calmWeeks).padStart(3)} | ${frac('plants')} ${frac('game')} ${frac('fish')} | ${planted}/${fields.length} f${fert} grain${Math.round((v.stores.filter(s => s.c === 'grain').reduce((a, s) => a + s.qty, 0)) / 1000)} | ${deaths || ''}`);
  if (!v.alive) { console.log('village died'); break; }
}
