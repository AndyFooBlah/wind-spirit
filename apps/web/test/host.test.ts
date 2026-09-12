import { describe, expect, it } from 'vitest';
import { MockLlmClient } from '@wind-spirit/agents';
import { SimHost, type HostIO } from '../src/sim/host.ts';
import { DEFAULT_SETTINGS, SPEED_MS, type FromWorker } from '../src/sim/protocol.ts';
import { THINK_GRACE, spokenPart } from '../src/sim/host.ts';

interface Timer { fn: () => void; ms: number; }

/** The worker protocol without a Worker: a fake timer, a message log, and a mock model. */
function harness(answer?: (req: { schema?: object }) => unknown) {
  const posted: FromWorker[] = []; const timers: Timer[] = [];
  const io: HostIO = {
    post: m => posted.push(m),
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: h => { const i = timers.indexOf(h as Timer); if (i >= 0) timers.splice(i, 1); },
    client: new MockLlmClient(answer ?? (() => { throw new Error('no model'); })),
  };
  const host = new SimHost(io);
  const fire = () => { const t = timers.shift(); if (!t) throw new Error('no timer armed'); t.fn(); };
  const of = <T extends FromWorker['type']>(type: T) => posted.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type);
  return { host, posted, timers, fire, of };
}

describe('SimHost protocol', () => {
  it('init posts the static map and a loaded frame', () => {
    const h = harness(); h.host.init('host-1');
    expect(h.of('map').length).toBe(1);
    const map = h.of('map')[0].map; expect(map.terrain.length).toBe(64 * 64); expect(Object.keys(map.names.recipes).length).toBeGreaterThan(20);
    const loaded = h.of('loaded')[0]; expect(loaded.tick).toBe(0); expect(loaded.frame.villages.length).toBe(4); expect(loaded.frame.rolls.length).toBe(5);
  });

  it('speeds arm a timer, ticks post frames and log inputs, step pauses first', () => {
    const h = harness(); h.host.init('host-2');
    h.host.setSpeed('fast');
    expect(h.timers.length).toBe(1); expect(h.timers[0].ms).toBe(SPEED_MS.fast);
    h.fire(); expect(h.of('tick').length).toBe(1); expect(h.timers.length).toBe(1);   // re-armed
    h.host.queue({ type: 'SpiritSpoke', village: 0, text: 'hello' });
    h.fire();
    const t2 = h.of('tick')[1]; expect(t2.tick).toBe(1); expect(t2.inputs.some(i => i.type === 'SpiritSpoke')).toBe(true);
    expect(t2.frame.tick).toBe(2); expect(t2.events.some(e => e.type === 'SpiritSpoke')).toBe(true);
    h.host.step();
    expect(h.host.speed).toBe('pause'); expect(h.timers.length).toBe(0); expect(h.of('tick').length).toBe(3);
    expect(h.of('speed').map(m => m.speed)).toEqual(['fast', 'pause']);
    expect(h.of('snapshot').some(s => s.reason === 'pause')).toBe(true);
  });

  it('chiefs act on habit when the model is off, and the journal says so', () => {
    const h = harness(); h.host.init('host-3');
    for (let i = 0; i < 14; i++) h.host.tick();      // crosses a season start
    const journals = h.of('journal'); expect(journals.length).toBeGreaterThan(0);
    expect(journals.every(j => j.entry.source === 'habit')).toBe(true);
    const decided = h.of('tick').flatMap(t => t.inputs).filter(i => i.type === 'ChiefDecided'); expect(decided.length).toBeGreaterThan(0);
  });

  it('attention events pause the host and are reported', () => {
    const h = harness(); h.host.init('host-4'); h.host.setSettings({ ...DEFAULT_SETTINGS, autoPause: { ...DEFAULT_SETTINGS.autoPause, Prayer: true } });
    h.host.setSpeed('normal');
    h.host.queue({ type: 'Prayer', village: 0, text: 'Spirit, will the rains come?' });
    h.fire();
    const att = h.of('attention'); expect(att.length).toBe(1); expect(att[0].event.type).toBe('Prayer');
    expect(h.host.speed).toBe('pause'); expect(h.timers.length).toBe(0);
  });

  it('village detail carries the view, plots and a rendered history feed', () => {
    const h = harness(); h.host.init('host-5');
    for (let i = 0; i < 30; i++) h.host.tick();
    const d = h.host.villageDetail(0)!;
    expect(d.plots.length).toBe(144); expect(d.plots.filter(p => p.kind === 'structure').length).toBeGreaterThan(0);
    expect(d.view.people.total).toBeGreaterThan(0); expect(d.view.stores.length).toBeGreaterThan(0);
    expect(d.feed.length).toBeGreaterThan(0); expect(d.feed[0].lines.length).toBeGreaterThan(0);
    expect((d.view as unknown as { names?: unknown }).names).toBeUndefined();
  });

  it('a dream streams a reply, records claims and logs the memory side effect for replay', async () => {
    const h = harness(req => (req.schema ? { claims: [{ text: 'rain will come next season', seasonsAhead: 1, weather: 'wet', checkable: true }], memoryNotes: ['the spirit promised rain'] } : 'I hear you, spirit.'));
    h.host.init('host-6'); h.host.setSpeed('normal');
    h.host.dreamStart(0);
    expect(h.host.speed).toBe('pause');
    await h.host.dreamSend('Rain will come next season.');
    expect(h.of('dreamReply')[0].text).toContain('I hear you');
    await h.host.dreamClose();
    const closed = h.of('dreamClosed')[0]; expect(closed.claims.length).toBe(1); expect(closed.memoryNotes).toEqual(['the spirit promised rain']);
    h.host.tick();
    const inputs = h.of('tick')[0].inputs;
    expect(inputs.some(i => i.type === 'ClaimsMade')).toBe(true);
    expect(inputs.some(i => i.type === 'ChiefMemory' && i.memory[0] === 'the spirit promised rain')).toBe(true);
    expect(h.host.world.villages[0].chronicle.length).toBe(1);
    expect(h.host.world.villages[0].chronicle[0].check).toEqual({ kind: 'weather', season: 1, roll: 'wet' });
  });

  it('the clock waits for a slow model chief after the grace period, then runs on', async () => {
    let release: (() => void) | undefined; const gate = new Promise<void>(r => { release = r; });
    const h = harness(); (h.host as unknown as { io: { client: unknown } }).io.client = { generate: async () => { await gate; return { text: '', json: { orders: [], journal: 'slow', memoryNotes: [] }, usage: { input: 1, output: 1 }, model: 'mock', ms: 1 }; } };
    h.host.init('host-7'); h.host.setSettings({ ...DEFAULT_SETTINGS, modelVillages: 'focused', focused: [0] });
    h.host.setSpeed('fast');
    h.fire();                                   // tick 0: season start requests a deliberation for village 0 (model)
    for (let i = 1; i < THINK_GRACE; i++) h.fire();
    const before = h.of('tick').length; expect(before).toBe(THINK_GRACE);
    h.fire(); h.fire();                          // throttled: no ticks, the loop re-arms and reports who it waits for
    expect(h.of('tick').length).toBe(before);
    expect(h.of('waiting').at(-1)?.villages).toEqual([0]);
    expect(h.timers[0].ms).toBeLessThanOrEqual(100);
    release!(); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    h.fire();
    expect(h.of('tick').length).toBe(before + 1);
    expect(h.of('waiting').at(-1)?.villages).toEqual([]);
    expect(h.of('journal').some(j => j.entry.source === 'model' && j.entry.village === 0)).toBe(true);
  });

  it('a dream reply that came back as decision JSON is reduced to the spoken part', () => {
    expect(spokenPart('I hear you, spirit.')).toBe('I hear you, spirit.');
    expect(spokenPart('{"orders":[],"journal":"j","replyToSpirit":"You say you are the wind."}')).toBe('You say you are the wind.');
    expect(spokenPart('```json\n{"orders":[],"journal":"The harvest is in."}\n```')).toBe('The harvest is in.');
    expect(spokenPart('{"orders":[], "replyToSpirit": "Half a reply')).toBe('{"orders":[], "replyToSpirit": "Half a reply');
  });

  it('two hosts with the same seed stay identical', () => {
    const a = harness(), b = harness(); a.host.init('same'); b.host.init('same');
    for (let i = 0; i < 60; i++) { a.host.tick(); b.host.tick(); }
    expect(a.host.hash()).toBe(b.host.hash());
  });
});
