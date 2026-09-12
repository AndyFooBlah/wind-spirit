import { describe, expect, it } from 'vitest';
import { Rng, Sim, replayTo, cyrb53, type Input, type InputLog } from '@wind-spirit/sim';
import { generateWorld } from '@wind-spirit/gen';
import { POLICIES } from '../src/policies.js';

describe('replay', () => {
  it('rebuilds any past week from a snapshot plus the logged inputs', () => {
    const seed = 'scrub'; const w = generateWorld({ seed }); const sim = new Sim(w); const rng = Rng.fromSeed(seed, 'work'); const mem: Record<number, Record<string, number>> = {};
    const log: InputLog = {}; const snapshots: Record<number, string> = { 0: sim.snapshot() }; const hashes: Record<number, string> = {};
    for (let t = 0; t < 130; t++) {
      const ev = sim.tick(); const q: Input[] = [];
      for (const e of ev) if (e.type === 'DeliberationRequested') { const v = w.villages[e.village]; if (v.alive) q.push({ type: 'ChiefDecided', village: v.id, orders: POLICIES.sensible({ w, v, reason: e.reason, rng, mem: (mem[v.id] ??= {}) }), requestedAt: e.t }); }
      if (q.length) log[w.tick] = q; for (const i of q) sim.queue(i);
      if (w.tick % 52 === 0) snapshots[w.tick] = sim.snapshot();
      if (w.tick === 77 || w.tick === 120) hashes[w.tick] = sim.hash();
    }
    const at77 = replayTo(snapshots[52], log, 77); expect(cyrb53(JSON.stringify({ ...at77, rng: {} })).length).toBeGreaterThan(0);
    expect(new Sim(at77).hash()).toBe(hashes[77]);
    expect(new Sim(replayTo(snapshots[104], log, 120)).hash()).toBe(hashes[120]);
  });
});
