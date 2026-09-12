/**
 * The focused village's sound: hubbub scaled by population, hammering while building, quiet in
 * famine, instruments once discovered and busier at festivals.
 */
import { degreeToMidi, type MusicSpec } from './music.js';
import type { SynthKit } from './synth.js';
import type { VillageState, Zoom } from './types.js';

export const ZOOM_SCALE: Readonly<Record<Zoom, number>> = { world: 0, local: 0.6, village: 1 };

/** Hubbub level 0..1 for a population: 5 people ≈ 0.3, 30 ≈ 0.6, 300+ ≈ 1. */
export function hubbubLevel(population: number): number {
  return Math.max(0, Math.min(1, Math.log10(population + 1) / 2.5));
}

export class VillageLayer {
  private hub: ReturnType<SynthKit['noiseLayer']>;
  private children: ReturnType<SynthKit['noiseLayer']>;
  private extras: { stop(t: number): void }[] = [];
  private state: VillageState | null = null;
  private zoomScale = 0;
  private nextHammer = 0;
  private nextNote = 0;
  private nextDrum = 0;
  private stopped = false;

  constructor(private kit: SynthKit, private out: AudioNode, private spec: MusicSpec) {
    this.hub = kit.noiseLayer('pink', out, { type: 'bandpass', hz: 520, q: 0.8 });
    this.children = kit.noiseLayer('pink', out, { type: 'bandpass', hz: 1500, q: 1.2 });
    this.extras.push(kit.lfo(this.hub.gain.gain, 0.7, 0.03), kit.lfo(this.hub.filter!.frequency, 0.23, 120), kit.lfo(this.children.gain.gain, 1.7, 0.02));
  }

  get current(): VillageState | null { return this.state; }

  set(state: VillageState | null, zoom: Zoom): void {
    this.state = state;
    this.zoomScale = ZOOM_SCALE[zoom];
    const t = this.kit.now;
    const level = state ? hubbubLevel(state.population) * (state.famine ? 0.2 : 1) * this.zoomScale : 0;
    this.hub.gain.gain.setTargetAtTime(Math.max(1e-4, level * 0.16), t, 0.5);
    const kids = state && state.population >= 20 && !state.famine ? Math.min(1, (state.population - 20) / 80) * this.zoomScale : 0;
    this.children.gain.gain.setTargetAtTime(Math.max(1e-4, kids * 0.04), t, 0.5);
  }

  schedule(now: number, until: number): void {
    const s = this.state, kit = this.kit;
    if (!s || this.zoomScale === 0 || this.stopped) return;
    const scale = this.zoomScale;
    if (s.building) {
      if (this.nextHammer < now) this.nextHammer = now + 0.1;
      while (this.nextHammer < until) {
        const t = this.nextHammer;
        kit.burst({ kind: 'white', t, dur: 0.02, gain: 0.12 * scale, out: this.out, filter: { type: 'bandpass', hz: 1600 * kit.vary(0.1), q: 2 }, env: { attack: 0.002, release: 0.05 } });
        kit.tone({ wave: 'triangle', hz: 210 * kit.vary(0.05), t, dur: 0.04, gain: 0.07 * scale, out: this.out, env: { attack: 0.002, release: 0.06 }, lowpass: 900 });
        this.nextHammer += 0.55 + kit.random() * 0.25;
      }
    }
    if (s.hasInstruments && !s.famine) {
      if (this.nextNote < now) this.nextNote = now + 0.1;
      const gap: [number, number] = s.festival ? [0.35, 0.8] : [1.5, 4.5];
      while (this.nextNote < until) {
        const deg = kit.rng.int(this.spec.scale.steps.length * 2);
        kit.pluck(degreeToMidi(this.spec.root, this.spec.scale, deg) + 12, this.nextNote, (s.festival ? 0.14 : 0.09) * scale, this.out, 0.994);
        this.nextNote += gap[0] + kit.random() * (gap[1] - gap[0]);
      }
      if (s.festival) {
        if (this.nextDrum < now) this.nextDrum = now + 0.05;
        const beat = 60 / (this.spec.tempo * 1.2);
        while (this.nextDrum < until) {
          kit.drum(this.nextDrum, 75, 0.12 * scale, this.out);
          if (kit.rng.chance(500)) kit.drum(this.nextDrum + beat / 2, 190, 0.06 * scale, this.out, { noise: 0.8, decay: 0.12 });
          this.nextDrum += beat;
        }
      }
    }
  }

  dispose(): void {
    this.stopped = true;
    const t = this.kit.now;
    this.hub.stop(t); this.children.stop(t);
    for (const x of this.extras) x.stop(t);
  }
}
