import { describe, expect, it } from 'vitest';
import { Sim, P, seasonIndex, type Event } from '@wind-spirit/sim';
import { generateWorld } from '@wind-spirit/gen';

describe('spirit', () => {
  it('messages reach the chief and trigger a deliberation', () => {
    const w = generateWorld({ seed: 's', startFoodWeeks: 200 }); const sim = new Sim(w);
    sim.queue({ type: 'SpiritSpoke', village: 0, text: 'Store food; the winter will be hard.' });
    const ev = sim.tick();
    expect(w.villages[0].inbox).toEqual(['Store food; the winter will be hard.']);
    expect(ev.some(e => e.type === 'DeliberationRequested' && e.village === 0 && e.reason.includes('spirit'))).toBe(true);
  });
  it('breath nudges a coming season, costs breath, and is logged with natural and adjusted rolls', () => {
    const w = generateWorld({ seed: 's', startFoodWeeks: 200 }); const sim = new Sim(w); sim.tick();
    const season = seasonIndex(w.tick) + 2; const before = w.rolls[season]; const pool = w.breath;
    sim.queue({ type: 'SpiritBreathed', action: { kind: 'override', season, roll: 'wet' } });
    const ev = sim.tick();
    const e = ev.find(x => x.type === 'SpiritBreathed') as Extract<Event, { type: 'SpiritBreathed' }>;
    expect(e.natural).toBe(before); expect(e.adjusted).toBe('wet'); expect(w.rolls[season]).toBe('wet');
    expect(w.breath).toBe(pool - P.breathOverride + P.breathRegen);
  });
  it('a weather claim resolves when its season ends and moves trust', () => {
    const w = generateWorld({ seed: 's', startFoodWeeks: 200 }); const sim = new Sim(w); sim.tick();
    const v = w.villages[0]; const season = seasonIndex(w.tick) + 1; const t0 = v.trust;
    sim.queue({ type: 'ClaimsMade', village: 0, claims: [{ text: 'next season will be as the sky wills', due: (season + 1) * 13, check: { kind: 'weather', season, roll: w.rolls[season] } }] });
    let resolved: Event | undefined;
    for (let i = 0; i < 40 && !resolved; i++) resolved = sim.tick().find(e => e.type === 'ClaimResolved');
    expect(resolved).toBeDefined(); expect((resolved as Extract<Event, { type: 'ClaimResolved' }>).outcome).toBe('fulfilled');
    expect(v.trust).toBeGreaterThan(t0);
  });
  it('a judged claim waits for the chief', () => {
    const w = generateWorld({ seed: 's', startFoodWeeks: 200 }); const sim = new Sim(w); sim.tick(); const v = w.villages[0]; const t0 = v.trust;
    sim.queue({ type: 'ClaimsMade', village: 0, claims: [{ text: 'raiders will come', due: w.tick + 2, check: { kind: 'judged' } }] });
    for (let i = 0; i < 5; i++) sim.tick();
    expect(v.chronicle[0].outcome).toBe('pending');
    sim.queue({ type: 'ChiefJudged', village: 0, verdicts: [{ claim: v.chronicle[0].id, verdict: 'failed' }] }); sim.tick();
    expect(v.chronicle[0].outcome).toBe('failed'); expect(v.trust).toBe(Math.max(0, t0 + P.trustFailed));
  });
});
