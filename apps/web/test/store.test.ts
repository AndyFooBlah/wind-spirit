import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { MockLlmClient } from '@wind-spirit/agents';
import { WEEKS_PER_YEAR } from '@wind-spirit/sim';
import { SimHost, type HostIO } from '../src/sim/host.ts';
import { ATTENTION_EVENTS, DEFAULT_SETTINGS, type AutoPause, type FromWorker } from '../src/sim/protocol.ts';
import { loadResume, listWorlds, createWorld, openStore, Persister, loadJournals, deleteWorld } from '../src/store/db.ts';

/** A host whose messages flow straight into the store, the way the main thread persists them. */
function hostWithPersister(persister: Persister, onMsg?: (m: FromWorker) => void): SimHost {
  const io: HostIO = {
    post: m => { onMsg?.(m); if (m.type === 'tick') void persister.tick(m.tick, m.inputs); else if (m.type === 'snapshot') void persister.snapshot(m.tick, m.json, m.reason); else if (m.type === 'journal') void persister.journal(m.entry); },
    setTimer: () => 0, clearTimer: () => undefined,
    client: new MockLlmClient(() => { throw new Error('the model must not be called'); }),
  };
  const host = new SimHost(io);
  // no attention pauses: the only snapshots in this test are the yearly ones and the explicit ones
  host.setSettings({ ...DEFAULT_SETTINGS, autoPause: Object.fromEntries(ATTENTION_EVENTS.map(k => [k, false])) as AutoPause });
  return host;
}

describe('store round trip', () => {
  it('save, load and replay reproduce the live hash after three years of scripted chiefs', async () => {
    const db = await openStore('ws-test-roundtrip');
    const meta = await createWorld(db, { id: 'w1', name: 'test', seed: 'store-1', options: { villages: 4 } });
    const persister = new Persister(db, meta.id);
    const journals: number[] = [];
    const host = hostWithPersister(persister, m => { if (m.type === 'journal') journals.push(m.entry.tick); });
    host.init('store-1', meta.options);
    host.postSnapshot('start');
    // the spirit speaks and breathes along the way, so the log has spirit inputs too
    for (let t = 0; t < 3 * WEEKS_PER_YEAR; t++) {
      if (t === 10) host.queue({ type: 'SpiritSpoke', village: 0, text: 'Plant early; the summer will be wet.' });
      if (t === 20) host.queue({ type: 'SpiritBreathed', action: { kind: 'nudge', season: 3, direction: 'wetter' } });
      if (t === 70) host.queue({ type: 'ClaimsMade', village: 1, claims: [{ text: 'rain by autumn', due: 91, check: { kind: 'weather', season: 6, roll: 'wet' } }] });
      host.tick();
    }
    await persister.flush();
    const live = host.hash(); const liveTick = host.world.tick;
    expect(liveTick).toBe(3 * WEEKS_PER_YEAR);
    expect(journals.length).toBeGreaterThan(10);

    const worlds = await listWorlds(db);
    expect(worlds[0].lastTick).toBe(liveTick);
    const resume = await loadResume(db, meta.id);
    expect(resume).toBeDefined();
    expect(resume!.snapshotTick).toBe(2 * WEEKS_PER_YEAR);          // yearly snapshot at the start of year 2
    expect(resume!.inputsAfter.length).toBe(WEEKS_PER_YEAR);
    expect(resume!.inputsAfter.some(i => i.length > 0)).toBe(true);  // chief decisions were logged

    const host2 = hostWithPersister(new Persister(db, 'w-replay'));
    host2.load(resume!.snapshot, resume!.inputsAfter);
    expect(host2.world.tick).toBe(liveTick);
    expect(host2.hash()).toBe(live);
    expect((await loadJournals(db, meta.id)).length).toBe(journals.length);

    // a pause snapshot mid-year: resume from it must also match
    for (let t = 0; t < 30; t++) host.tick();
    host.postSnapshot('pause');
    await persister.flush();
    const resume2 = await loadResume(db, meta.id);
    expect(resume2!.snapshotTick).toBe(liveTick + 30);
    expect(resume2!.inputsAfter.length).toBe(0);
    const host3 = hostWithPersister(new Persister(db, 'w-replay-2'));
    host3.load(resume2!.snapshot, resume2!.inputsAfter);
    expect(host3.hash()).toBe(host.hash());

    await deleteWorld(db, meta.id);
    expect((await listWorlds(db)).length).toBe(0);
    expect(await loadResume(db, meta.id)).toBeUndefined();
  });
});

describe('chief faces', () => {
  it('always picks a real face, and the same one for the same chief', async () => {
    const { chiefFace } = await import('../src/ui/Portrait.tsx');
    const seen = new Set<string>();
    for (let v = 0; v < 40; v++) for (const c of [-1, 0, 1, 7, 12, 999, 123456]) {
      const f = chiefFace(v, c);
      expect(f, `village ${v} chief ${c}`).toMatch(/^chief-[a-h]$/);
      expect(chiefFace(v, c)).toBe(f);   // stable
      seen.add(f);
    }
    expect(seen.size).toBeGreaterThan(4);   // and it spreads across the set
  });
});
