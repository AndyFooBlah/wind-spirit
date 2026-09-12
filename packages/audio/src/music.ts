/**
 * Generative music, pure logic. The seed picks a scale, root, tempo and palette; the generator
 * emits one bar of notes at a time, deterministic for a seed yet varying bar to bar. A separate
 * player (musicPlayer.ts) turns bars into sound.
 */
import { Rng } from '@wind-spirit/sim';
import type { MusicIntensity, Season } from './types.js';

export interface Scale { name: string; steps: readonly number[] }

export const SCALES: readonly Scale[] = [
  { name: 'pentatonic major', steps: [0, 2, 4, 7, 9] },
  { name: 'pentatonic minor', steps: [0, 3, 5, 7, 10] },
  { name: 'dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { name: 'hirajoshi', steps: [0, 2, 3, 7, 8] },
  { name: 'ritusen', steps: [0, 2, 5, 7, 9] },
];
/** The minor colour used under tension: a phrygian shadow of whatever the seed chose. */
export const TENSION_SCALE: Scale = { name: 'phrygian', steps: [0, 1, 3, 5, 7, 8, 10] };

export type LeadVoice = 'flute' | 'pluck';
export type DrumVoice = 'frame' | 'log';
export interface Palette { lead: LeadVoice; accompaniment: 'pluck' | 'none'; drum: DrumVoice }

export interface MusicSpec {
  seed: string;
  scale: Scale;
  tensionScale: Scale;
  /** MIDI note of the tonic in the drone octave. */
  root: number;
  /** Beats per minute at 'melody' intensity. */
  tempo: number;
  /** Beats per bar. */
  beats: number;
  palette: Palette;
  /** Scale degrees the drone alternates between (always includes 0). */
  droneDegrees: readonly number[];
  /** Seed motif as scale-degree intervals; melodies grow from it. */
  motif: readonly number[];
}

export type Voice = 'lead' | 'pluck' | 'drone' | 'drum' | 'hand';
export interface Note { voice: Voice; midi: number; beat: number; dur: number; vel: number }
export interface Bar { index: number; intensity: MusicIntensity; beats: number; tempo: number; notes: Note[] }

export const TEMPO_FACTOR: Readonly<Record<MusicIntensity, number>> = { drone: 1, melody: 1, tension: 1.15, lament: 0.7, festival: 1.2 };

/** Derive the world's music from its seed. Deterministic. */
export function deriveMusic(seed: string): MusicSpec {
  const rng = Rng.fromSeed(seed, 'music');
  const scale = rng.pick(SCALES);
  const root = 48 + rng.int(12);
  const tempo = 56 + rng.int(41);
  const palette: Palette = {
    lead: rng.chance(650) ? 'flute' : 'pluck',
    accompaniment: rng.chance(750) ? 'pluck' : 'none',
    drum: rng.chance(500) ? 'frame' : 'log',
  };
  const fifthDegree = scale.steps.findIndex((s) => s === 7);
  const droneDegrees = fifthDegree > 0 && rng.chance(700) ? [0, fifthDegree] : [0];
  const motif: number[] = [];
  const len = 3 + rng.int(3);
  for (let i = 0; i < len; i++) motif.push(rng.range(-2, 2));
  return { seed, scale, tensionScale: TENSION_SCALE, root, tempo, beats: 4, palette, droneDegrees, motif };
}

/** MIDI note for a scale degree (may exceed the scale length or be negative; octaves wrap). */
export function degreeToMidi(root: number, scale: Scale, degree: number): number {
  const n = scale.steps.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return root + oct * 12 + scale.steps[idx];
}

export function inScale(midi: number, root: number, scale: Scale): boolean {
  const pc = (((midi - root) % 12) + 12) % 12;
  return scale.steps.includes(pc);
}

const DENSITY: Readonly<Record<MusicIntensity, number>> = { drone: 0, melody: 0.35, tension: 0.4, lament: 0.28, festival: 0.55 };

export class MelodyGenerator {
  private index = 0;
  private degree = 0;
  private motifPos = 0;
  private restBar = false;

  constructor(readonly spec: MusicSpec, private rng: Rng = Rng.fromSeed(spec.seed, 'music:melody')) {}

  get barIndex(): number { return this.index; }

  /** Generate the next bar for an intensity. */
  nextBar(intensity: MusicIntensity): Bar {
    const { spec, rng } = this;
    const scale = intensity === 'tension' ? spec.tensionScale : spec.scale;
    const beats = spec.beats;
    const notes: Note[] = [];
    const bar: Bar = { index: this.index, intensity, beats, tempo: Math.round(spec.tempo * TEMPO_FACTOR[intensity]), notes };

    // Drone: a new pitch every 8 bars, or at the start. Tension holds the tonic.
    if (this.index % 8 === 0) {
      const deg = intensity === 'tension' ? 0 : rng.pick(spec.droneDegrees);
      notes.push({ voice: 'drone', midi: degreeToMidi(spec.root, spec.scale, deg), beat: 0, dur: beats * 8, vel: 0.5 });
    }

    // Lead: eighth-note slots, density by intensity, phrases every other bar rest sometimes.
    const density = DENSITY[intensity];
    if (density > 0) {
      if (this.index % 2 === 0) this.restBar = rng.chance(intensity === 'festival' ? 100 : 300);
      if (!this.restBar) {
        const slots = beats * 2;
        const register = intensity === 'lament' ? 0 : scale.steps.length;
        const top = scale.steps.length * 2 - 2;
        let slot = 0;
        while (slot < slots) {
          if (rng.chance(Math.round(density * 1000))) {
            let d = this.degree;
            const r = rng.unitK();
            if (r < 550) d += rng.pick([-2, -1, 1, 2]);
            else if (r < 850) { d += spec.motif[this.motifPos % spec.motif.length]; this.motifPos++; }
            else d = rng.pick([0, scale.steps.length]);
            if (intensity === 'lament' && rng.chance(600) && d > this.degree) d = this.degree - 1;
            d = Math.max(0, Math.min(top, d));
            this.degree = d;
            const lens = intensity === 'lament' ? [2, 3, 4, 6] : intensity === 'festival' ? [1, 1, 2] : [1, 2, 2, 3];
            const len = Math.min(rng.pick(lens), slots - slot);
            const vel = intensity === 'lament' ? 0.45 : intensity === 'festival' ? 0.75 : 0.6;
            notes.push({ voice: 'lead', midi: degreeToMidi(spec.root, scale, d + register), beat: slot / 2, dur: len / 2, vel: vel * (0.85 + rng.unitK() / 1000 * 0.3) });
            slot += len;
          } else slot++;
        }
      }
    }

    // Accompaniment.
    if (spec.palette.accompaniment === 'pluck' || intensity === 'tension' || intensity === 'festival') {
      const fifth = scale.steps.includes(7) ? scale.steps.indexOf(7) : 0;
      if (intensity === 'melody') {
        for (const b of [0, 2]) if (rng.chance(500)) notes.push({ voice: 'pluck', midi: degreeToMidi(spec.root, scale, rng.pick([0, fifth]) + scale.steps.length), beat: b, dur: 1, vel: 0.35 });
      } else if (intensity === 'tension') {
        for (let s = 0; s < beats * 2; s++) if (s % 2 === 0 || rng.chance(300)) notes.push({ voice: 'pluck', midi: degreeToMidi(spec.root, scale, s % 4 === 2 ? 1 : 0) + 12, beat: s / 2, dur: 0.5, vel: 0.4 });
      } else if (intensity === 'festival') {
        for (let s = 0; s < beats * 2; s++) if (s % 2 === 0 || rng.chance(500)) notes.push({ voice: 'pluck', midi: degreeToMidi(spec.root, scale, rng.pick([0, fifth, scale.steps.length]) + scale.steps.length), beat: s / 2, dur: 0.5, vel: 0.45 });
      } else if (intensity === 'lament') {
        if (this.index % 2 === 0 && rng.chance(600)) notes.push({ voice: 'pluck', midi: degreeToMidi(spec.root, scale, 0), beat: 0, dur: 2, vel: 0.3 });
      }
    }

    // Drums: a pulse for tension, a pattern for festival.
    const drumMidi = spec.root - 24;
    if (intensity === 'tension') {
      for (let b = 0; b < beats; b++) notes.push({ voice: 'drum', midi: drumMidi, beat: b, dur: 0.25, vel: b === 0 ? 0.6 : 0.4 });
    } else if (intensity === 'festival') {
      for (let b = 0; b < beats; b++) {
        notes.push({ voice: b % 2 === 0 ? 'drum' : 'hand', midi: drumMidi, beat: b, dur: 0.25, vel: b === 0 ? 0.7 : 0.5 });
        if (rng.chance(450)) notes.push({ voice: 'hand', midi: drumMidi, beat: b + 0.5, dur: 0.2, vel: 0.35 });
      }
    }

    this.index++;
    return bar;
  }
}

export interface Motif { notes: number[]; durs: number[] }

/** Four short season motifs in the seed's scale: spring rises, summer arches, autumn falls, winter is sparse and low. */
export function deriveMotifs(spec: MusicSpec): Record<Season, Motif> {
  const rng = Rng.fromSeed(spec.seed, 'music:motifs');
  const n = spec.scale.steps.length;
  const mk = (degrees: number[], durs: number[]): Motif => ({ notes: degrees.map((d) => degreeToMidi(spec.root, spec.scale, d)), durs });
  const start = n + rng.int(2);
  const spring = mk([start, start + 1 + rng.int(2), start + 3 + rng.int(2), start + n], [0.25, 0.25, 0.25, 0.7]);
  const peak = start + 2 + rng.int(3);
  const summer = mk([start, peak, peak + 1, peak, start + 1], [0.3, 0.3, 0.3, 0.3, 0.6]);
  const autumn = mk([start + n, start + n - 2, start + 1 + rng.int(2), start - 1], [0.35, 0.35, 0.35, 0.8]);
  const winter = mk([start - n + rng.int(2), start - n + n - (rng.chance(500) ? 0 : 1), start - n], [0.6, 0.5, 1.2]);
  return { 0: spring, 1: summer, 2: autumn, 3: winter };
}
