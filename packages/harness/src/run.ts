import { Rng, Sim, WEEKS_PER_YEAR, isPath, popCounts, shelter, storesWeeks, type Event, type Input, type World } from '@wind-spirit/sim';
import { generateWorld } from '@wind-spirit/gen';
import { POLICIES, type PolicyName } from './policies.js';

export interface RunOptions { seed: string; years: number; policy: PolicyName; villages?: number; startPop?: number; replayCheck?: boolean; }

export interface YearRow {
  seed: string; year: number; village: number; name: string; alive: number; pop: number; children: number; adults: number; elders: number;
  storesWeeks: number; happiness: number; shelter: number; births: number; deathsAge: number; deathsHunger: number; deathsTravel: number;
  forage: number; hunt: number; fish: number; farm: number; spoiled: number; cleared: number; huts: number; granary: number;
}
export interface RunResult {
  seed: string; policy: PolicyName; years: number; rows: YearRow[]; hash: string; replayHash?: string;
  villagesFounded: number; firstColonyYear: number; pathTiles: number; peakPop: number; finalPop: number; finalVillages: number;
  events: Record<string, number>; ms: number;
}

export function runOne(o: RunOptions): RunResult {
  const t0 = Date.now();
  const world = generateWorld({ seed: o.seed, villages: o.villages ?? 4, startPop: o.startPop ?? 20 });
  const initial = world.villages.length;
  const sim = new Sim(world);
  const policy = POLICIES[o.policy]; const rng = Rng.fromSeed(o.seed, 'work'); const mem: Record<number, Record<string, number>> = {};
  const inputs: Input[][] = [];
  const rows: YearRow[] = []; const counts: Record<string, number> = {};
  let firstColonyYear = -1, peakPop = 0;
  const total = o.years * WEEKS_PER_YEAR;
  for (let t = 0; t < total; t++) {
    const events = sim.tick();
    const queued: Input[] = [];
    for (const e of events) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
      if (e.type === 'DeliberationRequested') {
        const v = world.villages[e.village]; if (!v.alive) continue;
        const orders = policy({ w: world, v, reason: e.reason, rng, mem: (mem[v.id] ??= {}) });
        queued.push({ type: 'ChiefDecided', village: v.id, orders, requestedAt: e.t });
      }
      if (e.type === 'VillageFounded' && firstColonyYear < 0) firstColonyYear = Math.floor(e.t / WEEKS_PER_YEAR);
    }
    inputs.push(queued); for (const i of queued) sim.queue(i);
    if (world.tick % WEEKS_PER_YEAR === 0) {
      const year = world.tick / WEEKS_PER_YEAR - 1;
      for (const v of world.villages) {
        const c = popCounts(v, world.tick); if (c.total > peakPop) peakPop = c.total;
        let cleared = 0, huts = 0, granary = 0; for (const p of v.plots) { if (p.kind === 'clear' || p.kind === 'field') cleared++; if (p.kind === 'structure') { if (p.recipe === 'hut') huts++; if (p.recipe === 'granary') granary++; } }
        rows.push({ seed: o.seed, year, village: v.id, name: v.name, alive: v.alive ? 1 : 0, pop: c.total, children: c.children, adults: c.adults, elders: c.elders,
          storesWeeks: storesWeeks(world, v), happiness: v.happiness, shelter: shelter(world, v).score, ...v.year, cleared, huts, granary });
      }
    }
  }
  const hash = sim.hash();
  let replayHash: string | undefined;
  if (o.replayCheck) {
    const w2 = generateWorld({ seed: o.seed, villages: o.villages ?? 4, startPop: o.startPop ?? 20 }); const s2 = new Sim(w2);
    for (let t = 0; t < total; t++) { s2.tick(); for (const i of inputs[t]) s2.queue(i); }
    replayHash = s2.hash();
  }
  let pathTiles = 0; for (const t of world.tiles) if (isPath(t.trodden, t.road)) pathTiles++;
  let finalPop = 0, finalVillages = 0; for (const v of world.villages) if (v.alive) { finalVillages++; finalPop += v.people.length; }
  return { seed: o.seed, policy: o.policy, years: o.years, rows, hash, replayHash, villagesFounded: world.villages.length - initial, firstColonyYear, pathTiles, peakPop, finalPop, finalVillages, events: counts, ms: Date.now() - t0 };
}

export function toCsv(rows: YearRow[]): string {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]) as (keyof YearRow)[];
  return [keys.join(','), ...rows.map(r => keys.map(k => r[k]).join(','))].join('\n');
}

export type { Event, World };
