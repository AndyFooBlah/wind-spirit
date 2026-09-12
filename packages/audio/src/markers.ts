/**
 * Time markers: a soft pulse each week at slow speeds, a motif on each season change (four, in the
 * seed's scale) and a deeper tone at the new year. `markerFor` is pure; `MarkerPlayer` sounds it.
 */
import { WEEKS_PER_SEASON, WEEKS_PER_YEAR, seasonOf } from '@wind-spirit/sim';
import { deriveMotifs, type Motif, type MusicSpec } from './music.js';
import { midiToHz, type SynthKit } from './synth.js';
import type { Season, Speed } from './types.js';

export interface Marker { week: boolean; season: Season | null; newYear: boolean }

export const PULSE_SPEEDS: ReadonlySet<Speed> = new Set<Speed>(['step', 'slow']);

/** What tick `tick` marks at this speed. Season motifs play at every speed, the week pulse only at step/slow. */
export function markerFor(tick: number, speed: Speed): Marker {
  return {
    week: PULSE_SPEEDS.has(speed),
    season: tick % WEEKS_PER_SEASON === 0 ? seasonOf(tick) : null,
    newYear: tick > 0 && tick % WEEKS_PER_YEAR === 0,
  };
}

export class MarkerPlayer {
  readonly motifs: Record<Season, Motif>;
  private lastTick = -1;

  constructor(private kit: SynthKit, private out: AudioNode, private spec: MusicSpec) {
    this.motifs = deriveMotifs(spec);
  }

  /** Play whatever `tick` marks. A tick is never sounded twice. */
  tick(tick: number, speed: Speed): Marker | null {
    if (tick === this.lastTick) return null;
    this.lastTick = tick;
    const m = markerFor(tick, speed);
    const t = this.kit.now + 0.02;
    if (m.newYear) this.newYear(t);
    if (m.season !== null) this.motif(m.season, t + (m.newYear ? 0.6 : 0));
    else if (m.week) this.pulse(t);
    return m;
  }

  pulse(t: number): void {
    const hz = midiToHz(this.spec.root - 12) * this.kit.vary(0.01);
    this.kit.tone({ wave: 'sine', hz: hz * 1.5, glideTo: hz, t, dur: 0.1, gain: 0.16, out: this.out, env: { attack: 0.004, release: 0.12 } });
    this.kit.tone({ wave: 'triangle', hz: hz * 8, t, dur: 0.03, gain: 0.03, out: this.out, env: { attack: 0.002, release: 0.05 }, lowpass: 2500 });
  }

  motif(season: Season, t: number): void {
    const m = this.motifs[season];
    let at = t;
    const gain = season === 3 ? 0.18 : 0.24;
    for (let i = 0; i < m.notes.length; i++) {
      const dur = m.durs[i] * this.kit.vary(0.05);
      this.kit.flute(m.notes[i], at, dur, gain, this.out);
      at += dur * 0.95;
    }
  }

  newYear(t: number): void {
    const hz = midiToHz(this.spec.root - 24);
    this.kit.tone({ wave: 'sine', hz, t, dur: 2.2, gain: 0.3, out: this.out, env: { attack: 0.25, release: 1.2 } });
    this.kit.tone({ wave: 'sine', hz: hz * 1.5, t: t + 0.1, dur: 1.8, gain: 0.12, out: this.out, env: { attack: 0.3, release: 1 } });
    this.kit.tone({ wave: 'triangle', hz: hz * 2, t, dur: 1.5, gain: 0.05, out: this.out, env: { attack: 0.2, release: 0.8 }, lowpass: 600 });
  }
}
