import { describe, expect, it } from 'vitest';
import { Sim, WEEKS_PER_YEAR } from '@wind-spirit/sim';
import { generateWorld } from '@wind-spirit/gen';
import { runOne } from '../src/index.js';

describe('sim', () => {
  it('ticks a year without hunger deaths when nobody works but durable stores suffice', () => {
    const sim = new Sim(generateWorld({ seed: 't', startFoodWeeks: 120 })); // half is perishable and spoils within a month
    let hunger = 0;
    for (let i = 0; i < WEEKS_PER_YEAR; i++) for (const e of sim.tick()) if (e.type === 'Died' && e.cause === 'hunger') hunger++;
    expect(hunger).toBe(0);
  });
  it('is deterministic under a scripted policy and replays from inputs', () => {
    const a = runOne({ seed: 'rep', years: 20, policy: 'sensible', replayCheck: true });
    const b = runOne({ seed: 'rep', years: 20, policy: 'sensible' });
    expect(a.hash).toBe(b.hash); expect(a.replayHash).toBe(a.hash);
  });
  it('snapshot round-trips', () => {
    const sim = new Sim(generateWorld({ seed: 'snap' }));
    for (let i = 0; i < 10; i++) sim.tick();
    const s = Sim.fromSnapshot(sim.snapshot());
    for (let i = 0; i < 10; i++) { sim.tick(); s.tick(); }
    expect(s.hash()).toBe(sim.hash());
  });
});
