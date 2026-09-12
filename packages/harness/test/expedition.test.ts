import { describe, expect, it } from 'vitest';
import { Sim, storeQty, knowledgeUnion, tileDistance } from '@wind-spirit/sim';
import { generateWorld } from '@wind-spirit/gen';

describe('expedition', () => {
  it('collects a far regional commodity and brings it home', () => {
    const w = generateWorld({ seed: 'exp', startFoodWeeks: 100 }); const sim = new Sim(w); const v = w.villages[0];
    const far = w.tiles.map((t, i) => i).find(i => Object.keys(w.tiles[i].extra).length && tileDistance(w, v.tile, i) > 3 && tileDistance(w, v.tile, i) < 10);
    if (far === undefined) return;
    const c = Object.keys(w.tiles[far].extra)[0]; knowledgeUnion(v.knowledge, [far]);
    sim.queue({ type: 'ChiefDecided', village: v.id, orders: [{ task: 'expedition', workers: 3, params: { c, weeks: 3 }, since: 0 }, { task: 'forage', workers: 6, params: {}, since: 0 }], requestedAt: 0 });
    let returned = false; for (let i = 0; i < 40 && !returned; i++) for (const e of sim.tick()) if (e.type === 'PartyReturned' && e.village === v.id) returned = true;
    expect(returned).toBe(true); expect(storeQty(v, c)).toBeGreaterThan(0);
  });
});
