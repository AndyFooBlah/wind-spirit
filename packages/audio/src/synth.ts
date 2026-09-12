/**
 * Synthesis primitives bound to one AudioContext: cached noise buffers, Karplus-Strong plucks,
 * oscillator voices with envelopes, noise bursts, LFOs and a small feedback-delay "room".
 * Nothing here touches globals; every node is created from the context handed in.
 */
import { Rng } from '@wind-spirit/sim';
import type { AudioContextLike } from './types.js';

export type NoiseKind = 'white' | 'pink' | 'brown';
export type Wave = OscillatorType;

const MIN = 1e-4;

export function midiToHz(midi: number): number { return 440 * Math.pow(2, (midi - 69) / 12); }

/** Smoothly move a param toward `value` starting at `t` over roughly `seconds`. */
export function glide(param: AudioParam, value: number, t: number, seconds: number): void {
  param.setTargetAtTime(value, t, Math.max(0.005, seconds / 3));
}

export interface Envelope { attack: number; decay?: number; sustain?: number; release: number }

/** Attack/decay/sustain/release on a gain param. Returns the time the envelope is fully released. */
export function envelope(param: AudioParam, t: number, dur: number, peak: number, env: Envelope): number {
  const a = Math.max(0.002, env.attack), r = Math.max(0.01, env.release);
  const sus = env.sustain ?? 1, d = env.decay ?? 0;
  param.cancelScheduledValues(t);
  param.setValueAtTime(MIN, t);
  param.linearRampToValueAtTime(Math.max(MIN, peak), t + a);
  if (d > 0 && sus < 1) param.exponentialRampToValueAtTime(Math.max(MIN, peak * sus), t + a + d);
  const end = t + Math.max(dur, a + d);
  param.setValueAtTime(Math.max(MIN, peak * (d > 0 ? sus : 1)), end);
  param.exponentialRampToValueAtTime(MIN, end + r);
  return end + r;
}

function renderNoise(kind: NoiseKind, len: number, rng: Rng): Float32Array {
  const out = new Float32Array(len);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0;
  for (let i = 0; i < len; i++) {
    const w = rng.next() / 2147483648 - 1; // -1..1
    if (kind === 'white') out[i] = w;
    else if (kind === 'pink') {
      // Paul Kellet's refined pink filter
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      brown = (brown + 0.02 * w) / 1.02;
      out[i] = brown * 3.5;
    }
  }
  return out;
}

function renderPluck(sampleRate: number, hz: number, seconds: number, rng: Rng, damping: number): Float32Array {
  const n = Math.max(2, Math.round(sampleRate / hz));
  const len = Math.floor(sampleRate * seconds);
  const out = new Float32Array(len);
  const ring = new Float32Array(n);
  for (let i = 0; i < n; i++) ring[i] = rng.next() / 2147483648 - 1;
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = ring[idx], next = ring[(idx + 1) % n];
    out[i] = cur;
    ring[idx] = damping * 0.5 * (cur + next);
    idx = (idx + 1) % n;
  }
  // short fade-in to avoid a click
  const fade = Math.min(64, len);
  for (let i = 0; i < fade; i++) out[i] *= i / fade;
  return out;
}

export interface ToneOpts {
  wave?: Wave; hz: number; t: number; dur: number; gain: number; out: AudioNode;
  env?: Partial<Envelope>;
  /** Glide the pitch to this frequency over the note. */
  glideTo?: number;
  detune?: number;
  vibrato?: { rate: number; cents: number };
  lowpass?: number;
}

export interface BurstOpts {
  kind?: NoiseKind; t: number; dur: number; gain: number; out: AudioNode;
  filter?: { type: BiquadFilterType; hz: number; q?: number; sweepTo?: number };
  env?: Partial<Envelope>;
}

/** A continuously running voice the caller can level and stop. */
export interface Layer {
  gain: GainNode;
  /** Stop and disconnect at time `t`. */
  stop(t: number): void;
}

export class SynthKit {
  private noise = new Map<NoiseKind, AudioBuffer>();
  private plucks = new Map<string, AudioBuffer>();
  readonly rng: Rng;

  constructor(readonly ctx: AudioContextLike, seed: string) {
    this.rng = Rng.fromSeed(seed, 'audio:synth');
  }

  get now(): number { return this.ctx.currentTime; }

  /** Small deterministic variation so no sound repeats identically. */
  vary(spread: number): number { return 1 + (this.rng.unitK() / 1000 - 0.5) * 2 * spread; }
  random(): number { return this.rng.unitK() / 1000; }

  noiseBuffer(kind: NoiseKind): AudioBuffer {
    let b = this.noise.get(kind);
    if (!b) {
      const seconds = 2;
      b = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * seconds), this.ctx.sampleRate);
      b.getChannelData(0).set(renderNoise(kind, b.length, Rng.fromSeed('noise', kind)));
      this.noise.set(kind, b);
    }
    return b;
  }

  pluckBuffer(midi: number, damping = 0.996): AudioBuffer {
    const key = `${midi}:${damping}`;
    let b = this.plucks.get(key);
    if (!b) {
      const seconds = 1.6;
      b = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * seconds), this.ctx.sampleRate);
      b.getChannelData(0).set(renderPluck(this.ctx.sampleRate, midiToHz(midi), seconds, Rng.fromSeed('pluck', key), damping));
      this.plucks.set(key, b);
    }
    return b;
  }

  /** A looping filtered-noise layer, started immediately at zero gain. */
  noiseLayer(kind: NoiseKind, out: AudioNode, filter?: { type: BiquadFilterType; hz: number; q?: number }): Layer & { filter: BiquadFilterNode | null; source: AudioBufferSourceNode } {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(kind);
    src.loop = true;
    src.playbackRate.value = this.vary(0.03);
    const gain = ctx.createGain();
    gain.gain.value = MIN;
    let flt: BiquadFilterNode | null = null;
    if (filter) {
      flt = ctx.createBiquadFilter();
      flt.type = filter.type; flt.frequency.value = filter.hz; flt.Q.value = filter.q ?? 0.7;
      src.connect(flt); flt.connect(gain);
    } else src.connect(gain);
    gain.connect(out);
    src.start(ctx.currentTime);
    return {
      gain, filter: flt, source: src,
      stop: (t) => { try { src.stop(t); } catch { /* already stopped */ } setTimeout(() => { try { gain.disconnect(); } catch { /* */ } }, Math.max(0, (t - ctx.currentTime) * 1000 + 50)); },
    };
  }

  /** A continuously running oscillator layer at zero gain. */
  oscLayer(wave: Wave, hz: number, out: AudioNode, lowpass?: number): Layer & { osc: OscillatorNode; filter: BiquadFilterNode | null } {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = wave; osc.frequency.value = hz;
    const gain = ctx.createGain(); gain.gain.value = MIN;
    let flt: BiquadFilterNode | null = null;
    if (lowpass) { flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = lowpass; osc.connect(flt); flt.connect(gain); }
    else osc.connect(gain);
    gain.connect(out);
    osc.start(ctx.currentTime);
    return { gain, osc, filter: flt, stop: (t) => { try { osc.stop(t); } catch { /* */ } } };
  }

  /** Low-frequency modulation of a param: oscillator → gain(depth) → param. */
  lfo(target: AudioParam, rate: number, depth: number, wave: Wave = 'sine'): { stop(t: number): void } {
    const osc = this.ctx.createOscillator(); osc.type = wave; osc.frequency.value = rate;
    const g = this.ctx.createGain(); g.gain.value = depth;
    osc.connect(g); g.connect(target);
    osc.start(this.ctx.currentTime);
    return { stop: (t) => { try { osc.stop(t); } catch { /* */ } } };
  }

  /** One oscillator note with an envelope; the nodes free themselves. */
  tone(o: ToneOpts): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.wave ?? 'sine';
    osc.frequency.setValueAtTime(o.hz, o.t);
    if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.glideTo), o.t + o.dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const end = envelope(g.gain, o.t, o.dur, o.gain, { attack: 0.01, release: 0.1, ...o.env });
    let head: AudioNode = osc;
    if (o.lowpass) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lowpass; head.connect(f); head = f; }
    head.connect(g); g.connect(o.out);
    if (o.vibrato) {
      const v = this.lfo(osc.detune, o.vibrato.rate, o.vibrato.cents);
      v.stop(end + 0.05);
    }
    osc.start(o.t); osc.stop(end + 0.05);
  }

  /** A burst of filtered noise with an envelope. */
  burst(o: BurstOpts): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(o.kind ?? 'white');
    src.loop = true;
    src.playbackRate.value = this.vary(0.05);
    const g = ctx.createGain();
    const end = envelope(g.gain, o.t, o.dur, o.gain, { attack: 0.005, release: 0.08, ...o.env });
    let head: AudioNode = src;
    if (o.filter) {
      const f = ctx.createBiquadFilter(); f.type = o.filter.type; f.Q.value = o.filter.q ?? 1;
      f.frequency.setValueAtTime(o.filter.hz, o.t);
      if (o.filter.sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.filter.sweepTo), o.t + o.dur);
      head.connect(f); head = f;
    }
    head.connect(g); g.connect(o.out);
    src.start(o.t); src.stop(end + 0.05);
  }

  /** Karplus-Strong plucked string. */
  pluck(midi: number, t: number, gain: number, out: AudioNode, damping = 0.996): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.pluckBuffer(midi, damping);
    src.playbackRate.value = this.vary(0.004);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.setTargetAtTime(MIN, t + 1.2, 0.15);
    src.connect(g); g.connect(out);
    src.start(t); src.stop(t + 1.7);
  }

  /** Soft drum: a pitched thump plus a noise transient. `hz` sets the body; low ≈ 60, hand drum ≈ 180. */
  drum(t: number, hz: number, gain: number, out: AudioNode, opts: { noise?: number; decay?: number } = {}): void {
    const decay = opts.decay ?? 0.25;
    this.tone({ wave: 'sine', hz: hz * 2.2, glideTo: hz, t, dur: decay, gain, out, env: { attack: 0.003, release: 0.08 } });
    this.burst({ kind: 'white', t, dur: 0.02, gain: gain * (opts.noise ?? 0.35), out, filter: { type: 'bandpass', hz: hz * 12, q: 0.8 }, env: { attack: 0.002, release: 0.04 } });
  }

  /** Flute-like voice: sine + quiet triangle with vibrato and a breath of noise. */
  flute(midi: number, t: number, dur: number, gain: number, out: AudioNode): void {
    const hz = midiToHz(midi) * this.vary(0.004);
    this.tone({ wave: 'sine', hz, t, dur, gain, out, env: { attack: 0.06, release: 0.18 }, vibrato: { rate: 5 + this.random(), cents: 6 } });
    this.tone({ wave: 'triangle', hz, t, dur, gain: gain * 0.25, out, env: { attack: 0.08, release: 0.15 }, lowpass: hz * 3 });
    this.burst({ kind: 'pink', t, dur, gain: gain * 0.06, out, filter: { type: 'bandpass', hz: hz * 2, q: 3 }, env: { attack: 0.05, release: 0.1 } });
  }

  /** A soft bell: two inharmonic partials with a long decay. */
  bell(hz: number, t: number, dur: number, gain: number, out: AudioNode): void {
    this.tone({ wave: 'sine', hz, t, dur, gain, out, env: { attack: 0.005, decay: dur * 0.6, sustain: 0.3, release: 0.4 } });
    this.tone({ wave: 'sine', hz: hz * 2.76, t, dur: dur * 0.5, gain: gain * 0.25, out, env: { attack: 0.005, decay: dur * 0.3, sustain: 0.2, release: 0.2 } });
    this.tone({ wave: 'sine', hz: hz * 1.5, t, dur: dur * 0.7, gain: gain * 0.15, out, env: { attack: 0.005, decay: dur * 0.4, sustain: 0.2, release: 0.3 } });
  }

  /** A small feedback-delay room. Send into `input`; it mixes wet signal into `out`. */
  room(out: AudioNode, opts: { time: number; feedback: number; tone: number; wet: number }): { input: GainNode } {
    const ctx = this.ctx;
    const input = ctx.createGain(); input.gain.value = 1;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = opts.time;
    const fb = ctx.createGain(); fb.gain.value = opts.feedback;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = opts.tone;
    const wet = ctx.createGain(); wet.gain.value = opts.wet;
    input.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(wet); wet.connect(out);
    return { input };
  }

  /** A gain node that pans slightly when the context supports it; otherwise a plain gain. */
  spread(out: AudioNode, pan: number): GainNode {
    const g = this.ctx.createGain();
    if (typeof this.ctx.createStereoPanner === 'function') {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); p.connect(out);
    } else g.connect(out);
    return g;
  }
}
