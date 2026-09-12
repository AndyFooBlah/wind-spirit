import { describe, expect, it } from 'vitest';
import { Sim, addStore, storeQty, relation, discover, type Event } from '@wind-spirit/sim';
import { generateWorld } from '@wind-spirit/gen';

function setup(seed: string) {
  const w = generateWorld({ seed }); const sim = new Sim(w);
  const a = w.villages[0], b = w.villages[1];
  a.knowledge.villages.push(b.id); b.knowledge.villages.push(a.id);
  relation(a, b.id).sizeSeen = b.people.length;
  return { w, sim, a, b };
}
function run(sim: Sim, weeks: number, on: (e: Event) => void) { for (let i = 0; i < weeks; i++) for (const e of sim.tick()) on(e); }

describe('diplomacy', () => {
  it('an envoy trades by mandate and comes home with the goods', () => {
    const { w, sim, a, b } = setup('trade');
    addStore(a, 'grain', 40_000); addStore(b, 'wood', 30_000);
    const gift = w.recipes.find(r => !r.start && r.tier === 1)!; discover(sim.ctx, a, gift, 'research');
    sim.queue({ type: 'ChiefDecided', village: a.id, orders: [{ task: 'envoy', workers: 2, params: { target: b.id, offer: 'grain:10000', want: 'wood:8000', floor: 500, transfer: gift.id }, since: 0 }], requestedAt: 0 });
    let arrived = false, completed = false, returned = false, taught = false;
    run(sim, 60, e => {
      if (e.type === 'VisitorArrived' && e.village === b.id) { arrived = true; sim.queue({ type: 'HostDecided', village: b.id, party: e.party, answer: { kind: 'accept' }, requestedAt: e.t }); }
      if (e.type === 'TradeCompleted') completed = true;
      if (e.type === 'TechTransferred') taught = true;
      if (e.type === 'PartyReturned' && e.village === a.id) returned = true;
    });
    expect(arrived).toBe(true); expect(completed).toBe(true); expect(returned).toBe(true); expect(taught).toBe(true); expect(b.recipes).toContain(gift.id);
    expect(storeQty(a, 'wood')).toBeGreaterThanOrEqual(8000);
    expect(relation(a, b.id).trades).toBe(1);
    void w;
  });
  it('a raid resolves and leaves a grudge', () => {
    const { sim, a, b } = setup('raid');
    addStore(b, 'grain', 50_000);
    sim.queue({ type: 'ChiefDecided', village: a.id, orders: [{ task: 'raid', workers: 8, params: { target: b.id }, since: 0 }], requestedAt: 0 });
    let resolved: Event | undefined;
    run(sim, 60, e => { if (e.type === 'RaidResolved') resolved = e; });
    expect(resolved).toBeDefined();
    expect(relation(b, a.id).grudge).toBeGreaterThan(0);
  });
});
