/**
 * Plays the generator's bars on a context with lookahead scheduling. A drone always runs; the
 * lead, plucks and drums follow the bar. Paused speed forces 'drone'.
 */
import { MelodyGenerator, type Bar, type MusicSpec, type Note } from './music.js';
import { midiToHz, type SynthKit } from './synth.js';
import type { MusicIntensity, MusicSettings } from './types.js';

const DRONE_LEVEL: Readonly<Record<MusicIntensity, number>> = { drone: 0.11, melody: 0.09, tension: 0.1, lament: 0.13, festival: 0.07 };

export class MusicPlayer {
  private settings: MusicSettings = { enabled: true, intensity: 'melody' };
  private paused = false;
  private nextBar = 0;
  private droneA: ReturnType<SynthKit['oscLayer']>;
  private droneB: ReturnType<SynthKit['oscLayer']>;
  private sub: ReturnType<SynthKit['oscLayer']>;
  private droneFilter: BiquadFilterNode;
  private droneOut: GainNode;
  private lfo: { stop(t: number): void };
  private voices: GainNode;
  private disposed = false;
  /** Counters for demos and tests. */
  readonly stats = { bars: 0, notes: 0, lastIntensity: 'drone' as MusicIntensity };

  constructor(private kit: SynthKit, out: AudioNode, readonly spec: MusicSpec, private gen: MelodyGenerator = new MelodyGenerator(spec)) {
    const ctx = kit.ctx;
    this.droneOut = ctx.createGain(); this.droneOut.gain.value = 1e-4; this.droneOut.connect(out);
    this.droneFilter = ctx.createBiquadFilter(); this.droneFilter.type = 'lowpass'; this.droneFilter.frequency.value = 340; this.droneFilter.Q.value = 0.8;
    this.droneFilter.connect(this.droneOut);
    const hz = midiToHz(spec.root);
    this.droneA = kit.oscLayer('triangle', hz, this.droneFilter); this.droneA.osc.detune.value = 5; this.droneA.gain.gain.value = 0.5;
    this.droneB = kit.oscLayer('triangle', hz, this.droneFilter); this.droneB.osc.detune.value = -5; this.droneB.gain.gain.value = 0.5;
    this.sub = kit.oscLayer('sine', hz / 2, this.droneFilter); this.sub.gain.gain.value = 0.6;
    this.lfo = kit.lfo(this.droneFilter.frequency, 0.06, 90);
    this.voices = ctx.createGain(); this.voices.gain.value = 1; this.voices.connect(out);
    this.nextBar = kit.now + 0.1;
    this.applyLevel();
  }

  get current(): MusicSettings { return this.settings; }
  get effectiveIntensity(): MusicIntensity { return this.paused ? 'drone' : this.settings.intensity; }

  set(settings: MusicSettings): void { this.settings = { ...settings }; this.applyLevel(); }
  setPaused(paused: boolean): void { this.paused = paused; this.applyLevel(); }

  private applyLevel(): void {
    const t = this.kit.now;
    const level = this.settings.enabled ? DRONE_LEVEL[this.effectiveIntensity] : 1e-4;
    this.droneOut.gain.setTargetAtTime(Math.max(1e-4, level), t, 0.8);
    this.voices.gain.setTargetAtTime(this.settings.enabled ? 1 : 1e-4, t, 0.3);
  }

  schedule(now: number, until: number): void {
    if (this.disposed || !this.settings.enabled) { this.nextBar = Math.max(this.nextBar, now + 0.05); return; }
    if (this.nextBar < now - 0.25) this.nextBar = now + 0.05; // resumed after a gap: don't rush the missed bars
    while (this.nextBar < until) {
      const bar = this.gen.nextBar(this.effectiveIntensity);
      this.render(bar, this.nextBar);
      this.nextBar += bar.beats * 60 / bar.tempo;
    }
  }

  private render(bar: Bar, at: number): void {
    const spb = 60 / bar.tempo;
    const kit = this.kit;
    this.stats.bars++; this.stats.lastIntensity = bar.intensity;
    for (const n of bar.notes) {
      const t = at + n.beat * spb;
      this.stats.notes++;
      switch (n.voice) {
        case 'drone': this.setDrone(n, t); break;
        case 'lead':
          if (this.spec.palette.lead === 'flute') kit.flute(n.midi, t, n.dur * spb * 0.9, n.vel * 0.16, this.voices);
          else kit.pluck(n.midi, t, n.vel * 0.3, this.voices, 0.997);
          break;
        case 'pluck': kit.pluck(n.midi, t, n.vel * 0.22, this.voices, 0.994); break;
        case 'drum': kit.drum(t, this.spec.palette.drum === 'log' ? 95 : 65, n.vel * 0.45, this.voices, { decay: this.spec.palette.drum === 'log' ? 0.12 : 0.3 }); break;
        case 'hand': kit.drum(t, 190, n.vel * 0.3, this.voices, { noise: 0.9, decay: 0.1 }); break;
      }
    }
  }

  private setDrone(n: Note, t: number): void {
    const hz = midiToHz(n.midi);
    for (const v of [this.droneA, this.droneB]) v.osc.frequency.setTargetAtTime(hz, t, 0.6);
    this.sub.osc.frequency.setTargetAtTime(hz / 2, t, 0.6);
  }

  dispose(): void {
    this.disposed = true;
    const t = this.kit.now;
    this.droneA.stop(t); this.droneB.stop(t); this.sub.stop(t); this.lfo.stop(t);
    try { this.droneOut.disconnect(); this.voices.disconnect(); } catch { /* */ }
  }
}
