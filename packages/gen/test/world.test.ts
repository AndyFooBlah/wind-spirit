import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/index.js';
import { Sim, TERRAIN, route } from '@wind-spirit/sim';

describe('world generation', () => {
  it('places the requested villages on habitable, watered tiles', () => {
    for (const seed of ['a', 'b', 'c']) {
      const w = generateWorld({ seed, villages: 4 });
      expect(w.villages.length).toBe(4);
      for (const v of w.villages) { expect(TERRAIN[w.tiles[v.tile].terrain].forage).toBe(true); expect(v.people.length).toBe(20); expect(w.tiles[v.tile].village).toBe(v.id); }
    }
  });
  it('has a mix of terrain', () => {
    const w = generateWorld({ seed: 'mix' });
    const counts: Record<string, number> = {}; for (const t of w.tiles) counts[t.terrain] = (counts[t.terrain] ?? 0) + 1;
    expect(counts.grass ?? 0).toBeGreaterThan(200); expect((counts.ocean ?? 0) + (counts.lake ?? 0) + (counts.river ?? 0)).toBeGreaterThan(50);
  });
  it('villages can reach one another by land', () => {
    const w = generateWorld({ seed: 'reach' });
    const r = route(w, w.villages[0].tile, w.villages[1].tile);
    expect(r.length).toBeGreaterThan(0);
  });
  it('is deterministic', () => {
    const a = new Sim(generateWorld({ seed: 'd' })).hash(), b = new Sim(generateWorld({ seed: 'd' })).hash();
    expect(a).toBe(b);
  });
});
