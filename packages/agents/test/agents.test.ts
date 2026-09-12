import { describe, expect, it } from 'vitest';
import { Sim, type Input } from '@wind-spirit/sim';
import { generateWorld, CAP_NAMES } from '@wind-spirit/gen';
import { POLICIES, hostAnswer } from '@wind-spirit/harness';
import { ChiefScheduler, MockLlmClient, buildView, statePrompt, systemPrompt, parseDecision } from '../src/index.js';
import { Rng } from '@wind-spirit/sim';

describe('chief agent', () => {
  it('builds a view and a prompt without leaking unknown things', () => {
    const w = generateWorld({ seed: 'agent' }); const v = w.villages[0];
    const view = buildView(w, v, { events: [], capNames: CAP_NAMES });
    const prompt = statePrompt(view, 'season');
    expect(systemPrompt(view)).toContain(v.name); expect(prompt).not.toMatch(/tier/i);
    for (const r of w.recipes) if (!v.recipes.includes(r.id)) expect(prompt).not.toContain(r.name);
    expect(systemPrompt(view)).toContain('chief');
  });
  it('parses a decision, mapping names to ids and dropping invalid orders', () => {
    const w = generateWorld({ seed: 'agent' }); const v = w.villages[0];
    const view = buildView(w, v, { events: [], capNames: CAP_NAMES });
    const grainName = w.commodities.find(c => c.id === 'grain')!.name;
    const p = parseDecision(view, { orders: [
      { task: 'forage', workers: 4 }, { task: 'gather', workers: 1, commodity: 'wood' }, { task: 'research', workers: 1, ingredients: [grainName, 'fire making'] },
      { task: 'build', workers: 2, recipe: 'wood hut' }, { task: 'craft', workers: 1, recipe: 'no such thing' }, { task: 'explore', workers: 2, direction: 'north', days: 3 },
    ], journal: 'We eat.', memoryNotes: ['note'] });
    expect(p.orders.map(o => o.task)).toEqual(['forage', 'gather', 'research', 'build', 'explore']);
    expect(p.orders[2].params.ingredients).toBe('grain,fire');
    expect(p.dropped.length).toBe(1);
  });
  it('runs a village with a mock chief for ten years without ever blocking the sim', async () => {
    const w = generateWorld({ seed: 'agent' }); const sim = new Sim(w); const rng = Rng.fromSeed('agent', 'work'); const mem: Record<number, Record<string, number>> = {};
    const client = new MockLlmClient(req => req.schema && 'properties' in (req.schema as object) && 'answer' in ((req.schema as { properties: object }).properties)
      ? { answer: 'accept', journal: 'Welcome.' }
      : { orders: [{ task: 'forage', workers: 4 }, { task: 'hunt', workers: 3 }, { task: 'fish', workers: 3 }, { task: 'clear', workers: 1 }], journal: 'We gather and clear.', memoryNotes: ['clear more'] });
    const sched = new ChiefScheduler({ client, capNames: CAP_NAMES, modelVillages: id => id === 0, fallback: {
      decide: (w2, v, reason) => POLICIES.sensible({ w: w2, v, reason, rng, mem: (mem[v.id] ??= {}) }),
      host: (w2, v, m, g) => hostAnswer({ w: w2, v, reason: 'visitor', rng, mem: (mem[v.id] ??= {}) }, m, g),
    } });
    for (let t = 0; t < 520; t++) { const ev = sim.tick(); await Promise.all(sched.onEvents(w, ev)); for (const i of sched.drain() as Input[]) sim.queue(i); }
    expect(client.calls).toBeGreaterThan(30);
    expect(sched.journals.filter(j => j.village === 0 && j.source === 'model').length).toBeGreaterThan(30);
    expect(w.villages[0].memory).toEqual(['clear more']);
  });
});
