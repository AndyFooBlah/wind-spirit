import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { MockLlmClient } from '@wind-spirit/agents';
import { WEEKS_PER_YEAR } from '@wind-spirit/sim';
import { SimHost, type HostIO } from '../src/sim/host.ts';
import { worldAt, worldHash } from '../src/sim/history.ts';
import { buildFrame, buildVillageDetail, historyWorthy } from '../src/sim/views.ts';
import { ATTENTION_EVENTS, DEFAULT_SETTINGS, type AutoPause } from '../src/sim/protocol.ts';
import { createWorld, loadEvents, loadHistoryWindow, openStore, Persister, snapshotTicks } from '../src/store/db.ts';
import { dominantTerrain } from '../src/audio/audio.ts';

describe('history scrubbing', () => {
  it('replays to any past tick from the store and matches the live hash there', async () => {
    const db = await openStore('ws-test-history');
    const meta = await createWorld(db, { id: 'h1', name: 'h', seed: 'history-1', options: { villages: 4 } });
    const persister = new Persister(db, meta.id);
    const io: HostIO = {
      post: m => { if (m.type === 'tick') void persister.tick(m.tick, m.inputs, m.events.filter(historyWorthy)); else if (m.type === 'snapshot') void persister.snapshot(m.tick, m.json, m.reason); },
      setTimer: () => 0, clearTimer: () => undefined, client: new MockLlmClient(() => { throw new Error('no model'); }),
    };
    const host = new SimHost(io);
    host.setSettings({ ...DEFAULT_SETTINGS, autoPause: Object.fromEntries(ATTENTION_EVENTS.map(k => [k, false])) as AutoPause });
    host.init('history-1', meta.options); host.postSnapshot('start');
    const probes = [7, 52, 60, 103, 130, 155]; const live = new Map<number, string>();
    for (let t = 0; t < 3 * WEEKS_PER_YEAR; t++) {
      if (t === 30) host.queue({ type: 'SpiritSpoke', village: 1, text: 'The winter will be hard; store what you can.' });
      if (t === 80) host.queue({ type: 'SpiritBreathed', action: { kind: 'override', season: 8, roll: 'wet' } });
      if (probes.includes(host.world.tick)) live.set(host.world.tick, host.hash());
      host.tick();
    }
    await persister.flush();
    expect(await snapshotTicks(db, meta.id)).toEqual([0, 52, 104]);
    for (const t of probes) {
      const win = await loadHistoryWindow(db, meta.id, t); expect(win).toBeDefined();
      expect(win!.snapshotTick).toBe(Math.floor(t / WEEKS_PER_YEAR) * WEEKS_PER_YEAR);
      const w = worldAt(win!, t);
      expect(w.tick).toBe(t);
      expect(worldHash(w)).toBe(live.get(t));
      expect(buildFrame(w).tick).toBe(t);
    }
    // the feed at a past moment comes from the stored events up to that tick
    const events = await loadEvents(db, meta.id, 0, 130, 1);
    expect(events.length).toBeGreaterThan(5); expect(events.every(e => e.t < 130)).toBe(true);
    expect(events.some(e => e.type === 'SpiritSpoke')).toBe(true);
    const w130 = worldAt((await loadHistoryWindow(db, meta.id, 130))!, 130);
    const detail = buildVillageDetail(w130, 1, events.slice(-200))!;
    expect(detail.tick).toBe(130); expect(detail.feed.length).toBeGreaterThan(0);
    expect(detail.feed.every(g => g.tick < 130)).toBe(true);
    expect(worldHash(w130)).toBe(live.get(130));           // building views does not disturb the world
  });

  it('picks the dominant terrain on screen for the ambient bed', () => {
    const terrain = Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? 'ocean' : 'forest')) as ('ocean' | 'forest')[];
    expect(dominantTerrain(terrain, 4, 4, 'local', { x: 2, y: 2 })).toBe('forest');
    expect(dominantTerrain(terrain, 4, 4, 'village', { x: 2, y: 2 }, 0)).toBe('ocean');
  });
});
