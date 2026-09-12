import { describe, expect, it } from 'vitest';
import { generateTech } from '../src/index.js';
import { CAPABILITIES } from '@wind-spirit/sim';

describe('tech generation', () => {
  it('produces every capability exactly once and only reachable inputs', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const t = generateTech(seed);
      for (const cap of CAPABILITIES) expect(t.recipes.filter(r => r.output.capability === cap).length).toBe(1);
      const ids = new Set(t.commodities.map(c => c.id));
      for (const r of t.recipes) for (const i of r.inputs) expect(ids.has(i.c)).toBe(true);
      expect(new Set(t.commodities.map(c => c.name)).size).toBe(t.commodities.length);
      expect(t.recipes.filter(r => r.curiosity).length).toBeGreaterThanOrEqual(4);
    }
  });
  it('is deterministic and differs across seeds', () => {
    expect(JSON.stringify(generateTech('x'))).toBe(JSON.stringify(generateTech('x')));
    expect(JSON.stringify(generateTech('x'))).not.toBe(JSON.stringify(generateTech('y')));
  });
});
