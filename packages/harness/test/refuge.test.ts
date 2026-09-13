import { describe, expect, it } from 'vitest';
import { Sim, popCounts, relation, lineageOf, foundVillage, type Event } from '@wind-spirit/sim';
import { generateWorld } from '@wind-spirit/gen';

/** Drive a world with two villages: abandon one toward the other and watch the asking. */
function setup(seed: string) {
  const w = generateWorld({ seed, villages: 4 });
  const sim = new Sim(w);
  const [a, b] = w.villages;
  a.knowledge.villages.push(b.id); b.knowledge.villages.push(a.id);
  return { w, sim, a, b };
}
function runUntil(sim: Sim, pred: (ev: Event[]) => boolean, max = 400): Event[] {
  const all: Event[] = [];
  for (let i = 0; i < max; i++) { const ev = sim.tick(); all.push(...ev); if (pred(ev)) break; }
  return all;
}

describe('abandon and refuge', () => {
  it('abandoning empties the village and the host is asked; accepting merges them', () => {
    const { w, sim, a, b } = setup('refuge-accept');
    const before = a.people.length; const bPop = b.people.length;
    sim.queue({ type: 'ChiefDecided', village: a.id, orders: [{ task: 'abandon', workers: 0, params: { target: b.id }, since: 0 }], requestedAt: 0 });
    const ev1 = runUntil(sim, ev => ev.some(e => e.type === 'VillageAbandoned'), 3);
    expect(ev1.some(e => e.type === 'VillageAbandoned')).toBe(true);
    expect(a.alive).toBe(false); expect(a.people.length).toBe(0);
    const party = w.parties.find(p => p.kind === 'refugee' && p.home === a.id)!; expect(party).toBeTruthy(); expect(party.members.length).toBe(before);
    const ev2 = runUntil(sim, ev => ev.some(e => e.type === 'VisitorArrived' && e.village === b.id));
    const ask = ev2.find(e => e.type === 'VisitorArrived' && e.village === b.id) as Extract<Event, { type: 'VisitorArrived' }>;
    expect(ask).toBeTruthy(); expect(ask.mandate.refuge).toBe(party.members.length);
    sim.queue({ type: 'HostDecided', village: b.id, party: party.id, answer: { kind: 'accept' }, requestedAt: w.tick });
    const ev3 = runUntil(sim, ev => ev.some(e => e.type === 'RefugeesAdmitted'), 2);
    expect(ev3.some(e => e.type === 'RefugeesAdmitted')).toBe(true);
    expect(b.people.length).toBeGreaterThan(bPop); expect(w.parties.find(p => p.id === party.id)).toBeUndefined();
  });
  it('turned away, the refugees walk on to another village', () => {
    const { w, sim, a, b } = setup('refuge-refuse');
    sim.queue({ type: 'ChiefDecided', village: a.id, orders: [{ task: 'abandon', workers: 0, params: { target: b.id }, since: 0 }], requestedAt: 0 });
    runUntil(sim, ev => ev.some(e => e.type === 'VisitorArrived' && e.village === b.id));
    const party = w.parties.find(p => p.kind === 'refugee' && p.home === a.id)!;
    sim.queue({ type: 'HostDecided', village: b.id, party: party.id, answer: { kind: 'refuse', reason: 'no room' }, requestedAt: w.tick });
    const ev = runUntil(sim, ev => ev.some(e => e.type === 'RefugeesTurnedAway'), 2);
    expect(ev.some(e => e.type === 'RefugeesTurnedAway')).toBe(true);
    expect(party.refused).toContain(b.id); expect(party.target).not.toBe(b.id); expect(w.villages[party.target]?.alive).toBe(true);
  });
  it('a colony and its parent are kin', () => {
    const { w, sim, a } = setup('kin');
    // found a colony with the helper the sim itself uses on a settler party's arrival
    const ctx = sim.ctx;
    const people = a.people.splice(0, 5);
    const c = foundVillage(ctx, { tile: a.tile + 3, people, parent: a.id, culture: a.culture, recipes: a.recipes, capabilities: a.capabilities, knownTiles: [], food: 0, tents: 1 });
    expect(relation(a, c.id).kin).toBe(true); expect(relation(c, a.id).kin).toBe(true);
    expect(lineageOf(w, c)).toBe(lineageOf(w, a));
    expect(popCounts(c, w.tick).total).toBe(5);
  });
});
