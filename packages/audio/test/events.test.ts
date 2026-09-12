import { describe, expect, it } from 'vitest';
import type { Event as SimEvent } from '@wind-spirit/sim';
import { Coalescer, cueFor, DEFAULT_WINDOWS, MAJOR } from '../src/index.js';

const born = (t: number, village = 1): SimEvent => ({ t, type: 'Born', village, person: 100 + t });
const died = (t: number, village = 1): SimEvent => ({ t, type: 'Died', village, person: 1, cause: 'age', stage: 'elder' });
const discovered = (t: number, village = 1): SimEvent => ({ t, type: 'Discovered', village, recipe: 'pottery', how: 'research' });
const raid = (t: number): SimEvent => ({ t, type: 'RaidResolved', attacker: 2, defender: 1, success: true, attackersLost: 0, defendersLost: 1, taken: {}, destroyed: false });
const prayer = (t: number): SimEvent => ({ t, type: 'Prayer', village: 1, text: 'help' });
const chiefDied = (t: number): SimEvent => ({ t, type: 'ChiefSucceeded', village: 1, chief: 5, reason: 'death' });
const coup = (t: number): SimEvent => ({ t, type: 'ChiefSucceeded', village: 1, chief: 5, reason: 'coup' });

describe('cueFor', () => {
  it('maps sim events onto sounds and leaves silent events alone', () => {
    expect(cueFor(born(0))?.sound).toBe('birth');
    expect(cueFor(died(0))?.sound).toBe('death');
    expect(cueFor(chiefDied(0))?.sound).toBe('chiefDeath');
    expect(cueFor(coup(0))).toBeNull();
    expect(cueFor(raid(0))).toEqual({ sound: 'raid', village: 1 });
    expect(cueFor({ t: 0, type: 'WeekSummary', births: 1, deaths: 0, pop: 10, villages: 1 })).toBeNull();
    expect(cueFor({ t: 0, type: 'StormStruck', tile: 4, parties: 0, drowned: 0 })).toEqual({ sound: 'storm', village: null });
  });
  it('major sounds are the attention events', () => {
    for (const s of ['chiefDeath', 'raid', 'discovery', 'prayer', 'villageFounded', 'villageDied', 'storm'] as const) expect(MAJOR.has(s)).toBe(true);
    expect(MAJOR.has('birth')).toBe(false);
  });
});

describe('Coalescer', () => {
  it('at slow and normal speed every event plays, immediately', () => {
    for (const speed of ['slow', 'normal', 'step', 'pause'] as const) {
      const c = new Coalescer(speed);
      const cues = c.push([born(3), died(3), discovered(3)], 1, 3);
      expect(cues.map((q) => q.sound).sort()).toEqual(['birth', 'death', 'discovery']);
      expect(c.pendingCount).toBe(0);
    }
  });

  it('six births in one week become one sound', () => {
    const c = new Coalescer('normal');
    const cues = c.push([born(3), born(3), born(3), born(3), born(3), born(3)], 1, 3);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ sound: 'birth', count: 6, focused: true, major: false });
  });

  it('marks cues from other villages as unfocused, but major ones always focused', () => {
    const c = new Coalescer('normal');
    const cues = c.push([born(1, 7), prayer(1)], 1, 1);
    expect(cues.find((q) => q.sound === 'birth')?.focused).toBe(false);
    expect(cues.find((q) => q.sound === 'prayer')?.focused).toBe(true);
    expect(c.push([born(2, 7), born(2, 1)], 1, 2)[0].focused).toBe(true);
  });

  it('at fast speed only major events play, coalesced over a window', () => {
    const c = new Coalescer('fast');
    expect(c.push([born(0), died(0), born(0)], 1, 0)).toEqual([]);
    expect(c.pendingCount).toBe(0);
    expect(c.push([discovered(0)], 1, 0)).toEqual([]);
    expect(c.push([discovered(1), raid(1)], 1, 1)).toEqual([]);
    expect(c.push([discovered(2)], 1, 2)).toEqual([]);
    expect(c.pendingCount).toBe(2);
    const w = DEFAULT_WINDOWS.fast;
    expect(c.flush(w - 1)).toEqual([]);
    const out = c.flush(w);
    expect(out.map((q) => q.sound)).toEqual(['discovery']); // opened at tick 0
    expect(out[0].count).toBe(3);
    const later = c.flush(w + 1); // the raid group opened at tick 1
    expect(later.map((q) => q.sound)).toEqual(['raid']);
    expect(c.flush(w + 2)).toEqual([]);
  });

  it('at very fast speed nothing plays; one summary sound when the speed drops', () => {
    const c = new Coalescer('veryfast');
    for (let t = 0; t < 13; t++) expect(c.push([born(t), discovered(t), raid(t), prayer(t)], 1, t)).toEqual([]);
    expect(c.flush(100)).toEqual([]);
    expect(c.suppressedCount).toBe(52);
    const out = c.setSpeed('normal', 13);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sound: 'summary', count: 52, major: true });
    expect(out[0].detail).toEqual({ birth: 13, discovery: 13, raid: 13, prayer: 13 });
    expect(c.suppressedCount).toBe(0);
    expect(c.setSpeed('slow', 14)).toEqual([]);
  });

  it('staying very fast, or moving between other speeds, emits no summary', () => {
    const c = new Coalescer('veryfast');
    c.push([born(0)], 1, 0);
    expect(c.setSpeed('veryfast', 1)).toEqual([]);
    expect(c.suppressedCount).toBe(1);
    const d = new Coalescer('normal');
    expect(d.setSpeed('fast', 0)).toEqual([]);
  });

  it('changing speed releases pending groups', () => {
    const c = new Coalescer('fast');
    c.push([chiefDied(0), chiefDied(0)], 1, 0);
    const out = c.setSpeed('normal', 1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sound: 'chiefDeath', count: 2 });
    expect(c.pendingCount).toBe(0);
  });
});
