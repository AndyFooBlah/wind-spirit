/**
 * The event coalescer: pure logic, no audio. Maps sim events onto sound cues and decides, by speed,
 * which cues play and which merge.
 *
 * - pause/step/slow/normal: every event plays; identical sounds arriving in the same tick merge into
 *   one cue with a count (six births in one week are one sound).
 * - fast: only major sounds play, coalesced over a window of several ticks so a burst of raids or
 *   discoveries becomes one cue each.
 * - veryfast: nothing plays (season motifs are handled by the markers, not here); events are counted
 *   and released as a single `summary` cue when the speed drops.
 */
import type { SimEvent, SoundName, Speed } from './types.js';

export interface Cue {
  sound: SoundName;
  /** Occurrences merged into this cue. */
  count: number;
  /** Village of the (last) event, or null. */
  village: number | null;
  /** True when any merged event concerns the focused village. Major sounds are always played as focused. */
  focused: boolean;
  major: boolean;
  /** Tick of the first merged event. */
  tick: number;
  /** For `summary`: what was suppressed at very fast speed. */
  detail?: Partial<Record<SoundName, number>>;
}

/** Sounds that still play at fast speed. */
export const MAJOR: ReadonlySet<SoundName> = new Set<SoundName>([
  'chiefDeath', 'raid', 'discovery', 'prayer', 'villageFounded', 'villageDied', 'storm',
]);

/** Coalescing window in ticks per speed. 0 = only same-tick merging; Infinity = suppress everything. */
export const DEFAULT_WINDOWS: Readonly<Record<Speed, number>> = {
  pause: 0, step: 0, slow: 0, normal: 0, fast: 6, veryfast: Infinity,
};

/** Map a sim event onto a sound, or null when it is silent (its information is visual only). */
export function cueFor(e: SimEvent): { sound: SoundName; village: number | null } | null {
  switch (e.type) {
    case 'Discovered': return { sound: 'discovery', village: e.village };
    case 'Born': return { sound: 'birth', village: e.village };
    case 'Died': return { sound: 'death', village: e.village };
    case 'ChiefSucceeded': return e.reason === 'death' ? { sound: 'chiefDeath', village: e.village } : null;
    case 'PartyLeft': return { sound: 'partyLeft', village: e.village };
    case 'PartyReturned': return { sound: 'partyReturned', village: e.village };
    case 'Harvested': return { sound: 'harvest', village: e.village };
    case 'RaidResolved': return { sound: 'raid', village: e.defender };
    case 'TradeCompleted': return { sound: 'trade', village: e.village };
    case 'Prayer': return { sound: 'prayer', village: e.village };
    case 'VillageFounded': return { sound: 'villageFounded', village: e.village };
    case 'VillageDied': return { sound: 'villageDied', village: e.village };
    case 'StormStruck': return { sound: 'storm', village: null };
    case 'Built': return { sound: 'built', village: e.village };
    case 'Famine': return { sound: 'famine', village: e.village };
    default: return null;
  }
}

interface Group { cue: Cue }

export class Coalescer {
  private speed: Speed;
  private pending = new Map<SoundName, Group>();
  private suppressed = new Map<SoundName, number>();
  private windows: Record<Speed, number>;

  constructor(speed: Speed = 'normal', windows: Partial<Record<Speed, number>> = {}) {
    this.speed = speed;
    this.windows = { ...DEFAULT_WINDOWS, ...windows };
  }

  get currentSpeed(): Speed { return this.speed; }
  get pendingCount(): number { return this.pending.size; }
  get suppressedCount(): number { let n = 0; for (const v of this.suppressed.values()) n += v; return n; }

  /**
   * Change speed. Pending groups are released immediately; when leaving very fast with suppressed
   * events, a single `summary` cue is emitted in their place.
   */
  setSpeed(speed: Speed, tick: number): Cue[] {
    const out = this.release(tick, true);
    if (speed !== 'veryfast' && this.suppressed.size > 0) {
      const detail: Partial<Record<SoundName, number>> = {};
      let count = 0;
      for (const [k, v] of this.suppressed) { detail[k] = v; count += v; }
      out.push({ sound: 'summary', count, village: null, focused: true, major: true, tick, detail });
      this.suppressed.clear();
    }
    this.speed = speed;
    return out;
  }

  /** Feed one tick's events. Returns the cues to play now. */
  push(events: readonly SimEvent[], focusedVillage: number | null, tick: number): Cue[] {
    const window = this.windows[this.speed];
    const out: Cue[] = [];
    const immediate = new Map<SoundName, Cue>();
    for (const e of events) {
      const c = cueFor(e);
      if (!c) continue;
      const major = MAJOR.has(c.sound);
      if (window === Infinity) { this.suppressed.set(c.sound, (this.suppressed.get(c.sound) ?? 0) + 1); continue; }
      if (this.speed === 'fast' && !major) continue;
      const focused = major || (focusedVillage !== null && c.village === focusedVillage);
      const bucket = window === 0 ? immediate : null;
      if (bucket) {
        const cur = bucket.get(c.sound);
        if (cur) { cur.count++; cur.focused ||= focused; cur.village = c.village; }
        else bucket.set(c.sound, { sound: c.sound, count: 1, village: c.village, focused, major, tick });
      } else {
        const g = this.pending.get(c.sound);
        if (g) { g.cue.count++; g.cue.focused ||= focused; g.cue.village = c.village; }
        else this.pending.set(c.sound, { cue: { sound: c.sound, count: 1, village: c.village, focused, major, tick } });
      }
    }
    out.push(...immediate.values());
    out.push(...this.release(tick, false));
    return out;
  }

  /** Release groups whose window has elapsed by `tick`, or all of them when `all` is set. */
  flush(tick: number, all = false): Cue[] { return this.release(tick, all); }

  private release(tick: number, all: boolean): Cue[] {
    const window = this.windows[this.speed];
    const out: Cue[] = [];
    for (const [k, g] of this.pending) {
      if (all || tick - g.cue.tick >= window) { out.push(g.cue); this.pending.delete(k); }
    }
    return out;
  }
}
