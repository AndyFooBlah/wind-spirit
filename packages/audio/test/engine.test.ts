import { afterEach, describe, expect, it } from 'vitest';
import type { Event as SimEvent } from '@wind-spirit/sim';
import { BUSES, createAudioEngine, SOUNDS, type AudioEngine, type Scene } from '../src/index.js';
import { FakeAudioContext, FakeGain } from './fakeContext.js';

const scene = (over: Partial<Scene> = {}): Scene => ({ season: 0, roll: 'normal', biome: 'grass', zoom: 'local', speed: 'normal', ...over });
const born = (t: number): SimEvent => ({ t, type: 'Born', village: 1, person: t });
const discovered = (t: number): SimEvent => ({ t, type: 'Discovered', village: 1, recipe: 'pottery', how: 'research' });

let engines: AudioEngine[] = [];
afterEach(() => { for (const e of engines) e.dispose(); engines = []; });

async function started(): Promise<{ ctx: FakeAudioContext; engine: AudioEngine }> {
  const ctx = new FakeAudioContext();
  const engine = createAudioEngine({ context: ctx.asContext(), seed: 'smoke' });
  engines.push(engine);
  await engine.resume();
  return { ctx, engine };
}

describe('createAudioEngine', () => {
  it('allocates nothing and tolerates every call before resume()', () => {
    const ctx = new FakeAudioContext();
    const engine = createAudioEngine({ context: ctx.asContext(), seed: 'smoke' });
    engines.push(engine);
    expect(ctx.sources).toBe(0);
    engine.setScene(scene()); engine.setVillage({ population: 30, building: true, famine: false, hasInstruments: true, festival: false });
    engine.onEvents([born(1)], 1); engine.spirit('nudge', 0.5); engine.tick(13); engine.setBusGain('ambient', 0.5); engine.mute('music', true);
    engine.setMusic({ enabled: true, intensity: 'tension' }); engine.play('prayer');
    expect(ctx.sources).toBe(0);
    const s = engine.snapshot();
    expect(s.started).toBe(false);
    expect(s.contextState).toBe('suspended');
    expect(s.buses.ambient.gain).toBe(0.5);
    expect(s.buses.music.muted).toBe(true);
    expect(s.music.intensity).toBe('tension');
  });

  it('without a context it fails clearly in node and never touches globals at import', async () => {
    const engine = createAudioEngine({ seed: 'lazy' });
    engines.push(engine);
    expect(engine.snapshot().contextState).toBe('none');
    await expect(engine.resume()).rejects.toThrow(/Web Audio/);
  });

  it('builds the graph on resume and applies the stored state', async () => {
    const ctx = new FakeAudioContext();
    const engine = createAudioEngine({ context: ctx.asContext(), seed: 'smoke' });
    engines.push(engine);
    engine.setScene(scene({ biome: 'coast', season: 1 }));
    engine.setVillage({ population: 50, building: true, famine: false, hasInstruments: true, festival: true });
    engine.setBusGain('master', 0.7);
    await engine.resume();
    const s = engine.snapshot();
    expect(s.started).toBe(true);
    expect(s.contextState).toBe('running');
    const intoDestination = ctx.nodes.filter((n) => n.connections.includes(ctx.destination));
    expect(intoDestination.length).toBe(1); // only the master bus reaches the output
    expect(ctx.sources).toBeGreaterThan(5); // drone oscillators, ambient noise layers
    const master = intoDestination[0] as FakeGain;
    expect(master.gain.value).toBeCloseTo(0.7);
    engine.setBusGain('master', 0.2);
    expect(master.gain.value).toBeCloseTo(0.2);
    engine.mute('master', true);
    expect(master.gain.value).toBeLessThan(0.001);
    engine.mute('master', false);
    expect(master.gain.value).toBeCloseTo(0.2);
    for (const b of BUSES) { engine.setBusGain(b, 0.5); engine.mute(b, false); }
  });

  it('every one-shot, spirit action and scene creates sources without throwing', async () => {
    const { ctx, engine } = await started();
    for (const sound of SOUNDS) {
      const before = ctx.sources;
      engine.play(sound, { count: 3, focused: false });
      expect(ctx.sources, sound).toBeGreaterThan(before);
      ctx.currentTime += 1;
    }
    for (const kind of ['message', 'sail', 'nudge', 'override', 'storm'] as const) {
      const before = ctx.sources;
      engine.spirit(kind, 0.1);
      expect(ctx.sources, kind).toBeGreaterThan(before);
    }
    engine.spirit('dream-open', 1);
    expect(engine.snapshot().dreaming).toBe(true);
    engine.spirit('dream-open', 1);
    engine.spirit('dream-close', 1);
    expect(engine.snapshot().dreaming).toBe(false);
    for (const season of [0, 1, 2, 3] as const) for (const biome of ['grass', 'forest', 'hills', 'mountain', 'desert', 'oasis', 'marsh', 'river', 'lake', 'coast', 'ocean'] as const) {
      for (const zoom of ['world', 'local', 'village'] as const) engine.setScene(scene({ season, biome, zoom, roll: season === 2 ? 'storm' : 'wet' }));
    }
    for (const intensity of ['drone', 'melody', 'tension', 'lament', 'festival'] as const) engine.setMusic({ enabled: true, intensity });
    engine.setMusic({ enabled: false, intensity: 'melody' });
    engine.setVillage(null);
  });

  it('plays events by speed and season motifs at every speed', async () => {
    const { ctx, engine } = await started();
    engine.setScene(scene({ speed: 'normal' }));
    let before = ctx.sources;
    engine.onEvents([born(1), born(1), born(1)], 1);
    expect(ctx.sources).toBeGreaterThan(before);

    engine.setScene(scene({ speed: 'fast' }));
    before = ctx.sources;
    engine.onEvents([born(2)], 1);
    expect(ctx.sources).toBe(before); // minor at fast: dropped
    engine.onEvents([discovered(2)], 1);
    expect(ctx.sources).toBe(before); // major at fast: pending
    engine.tick(2 + 6);
    expect(ctx.sources).toBeGreaterThan(before); // released after the window (and the week: no pulse at fast)

    engine.setScene(scene({ speed: 'veryfast' }));
    before = ctx.sources;
    engine.onEvents([born(20), discovered(20), { t: 20, type: 'Prayer', village: 1, text: 'x' }], 1);
    engine.tick(20);
    expect(ctx.sources).toBe(before); // nothing at very fast
    engine.tick(26);
    expect(ctx.sources).toBeGreaterThan(before); // ...except the season motif
    expect(engine.snapshot().coalescer.suppressed).toBe(3);
    before = ctx.sources;
    ctx.currentTime += 1;
    engine.setScene(scene({ speed: 'slow' }));
    expect(ctx.sources).toBeGreaterThan(before); // the summary sound
    expect(engine.snapshot().coalescer.suppressed).toBe(0);

    before = ctx.sources;
    engine.tick(27);
    expect(ctx.sources).toBeGreaterThan(before); // week pulse at slow
    before = ctx.sources;
    engine.tick(27);
    expect(ctx.sources).toBe(before); // a tick is never sounded twice
    before = ctx.sources;
    engine.tick(52);
    expect(ctx.sources).toBeGreaterThan(before); // new year + spring motif
  });

  it('schedules music and ambient chirps as time passes', async () => {
    const { ctx, engine } = await started();
    engine.setScene(scene({ season: 0, biome: 'coast' }));
    engine.setVillage({ population: 80, building: true, famine: false, hasInstruments: true, festival: true });
    engine.setMusic({ enabled: true, intensity: 'festival' });
    const before = ctx.sources;
    ctx.currentTime += 5;
    await new Promise((r) => setTimeout(r, 300));
    expect(ctx.sources).toBeGreaterThan(before + 10);
  });

  it('suspends, resumes and disposes cleanly', async () => {
    const { ctx, engine } = await started();
    await engine.suspend();
    expect(ctx.state).toBe('suspended');
    await engine.resume();
    expect(ctx.state).toBe('running');
    engine.dispose();
    engine.dispose();
    expect(ctx.state).toBe('running'); // not ours to close
    await expect(engine.resume()).rejects.toThrow(/disposed/);
  });
});
