/**
 * The spirit's sound: the wind rising whenever the player acts. A message is a gust; breath actions
 * escalate (breeze, swell, long rising wind, thunder); a nearly empty pool sounds thinner; the dream
 * drops into night with a fire crackling.
 */
import type { SynthKit } from './synth.js';
import type { SpiritKind } from './types.js';

export class SpiritLayer {
  private night: { ember: ReturnType<SynthKit['noiseLayer']>; crackle: GainNode; nextCrackle: number; lfo: { stop(t: number): void } } | null = null;
  private dreamingFlag = false;

  constructor(private kit: SynthKit, private out: AudioNode, private onDream: (open: boolean) => void) {}

  get dreaming(): boolean { return this.dreamingFlag; }

  play(kind: SpiritKind, pool: number): void {
    const p = Math.max(0, Math.min(1, pool));
    if (kind === 'dream-open') return this.openDream();
    if (kind === 'dream-close') return this.closeDream();
    const kit = this.kit;
    const t = kit.now + 0.01;
    // A thin pool: less body (gain) and less low end (highpass climbs).
    const body = 0.4 + 0.6 * p;
    const hp = kit.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120 + (1 - p) * 1400; hp.Q.value = 0.7;
    hp.connect(this.out);
    switch (kind) {
      case 'message':
        kit.burst({ kind: 'pink', t, dur: 0.9, gain: 0.5 * body, out: hp, filter: { type: 'bandpass', hz: 500 * kit.vary(0.1), q: 0.6, sweepTo: 1400 }, env: { attack: 0.25, release: 0.6 } });
        break;
      case 'sail':
        kit.burst({ kind: 'pink', t, dur: 1.6, gain: 0.3 * body, out: hp, filter: { type: 'bandpass', hz: 800 * kit.vary(0.1), q: 0.5, sweepTo: 1100 }, env: { attack: 0.6, release: 0.9 } });
        break;
      case 'nudge':
        kit.burst({ kind: 'brown', t, dur: 2.2, gain: 0.7 * body, out: hp, filter: { type: 'lowpass', hz: 400, q: 0.6, sweepTo: 1500 }, env: { attack: 1.1, release: 1.2 } });
        kit.burst({ kind: 'pink', t: t + 0.4, dur: 1.6, gain: 0.3 * body, out: hp, filter: { type: 'bandpass', hz: 900, q: 0.5, sweepTo: 1800 }, env: { attack: 0.9, release: 1 } });
        break;
      case 'override':
        kit.burst({ kind: 'pink', t, dur: 4, gain: 0.8 * body, out: hp, filter: { type: 'bandpass', hz: 250, q: 0.5, sweepTo: 2600 }, env: { attack: 2.8, release: 1.6 } });
        kit.burst({ kind: 'brown', t, dur: 3.5, gain: 0.6 * body, out: hp, filter: { type: 'lowpass', hz: 300, q: 0.5, sweepTo: 1200 }, env: { attack: 2, release: 1.4 } });
        kit.tone({ wave: 'sine', hz: 55, glideTo: 110, t, dur: 4, gain: 0.18 * body, out: hp, env: { attack: 2.5, release: 1.5 } });
        break;
      case 'storm':
        kit.burst({ kind: 'white', t, dur: 0.06, gain: 0.5 * body, out: hp, filter: { type: 'bandpass', hz: 2600, q: 0.8, sweepTo: 600 }, env: { attack: 0.003, release: 0.12 } });
        kit.burst({ kind: 'brown', t: t + 0.05, dur: 2.6, gain: 1.2 * body, out: hp, filter: { type: 'lowpass', hz: 160, q: 0.8, sweepTo: 60 }, env: { attack: 0.03, decay: 1.2, sustain: 0.4, release: 1.4 } });
        kit.tone({ wave: 'sine', hz: 42 * kit.vary(0.05), t: t + 0.05, dur: 2.2, gain: 0.35 * body, out: hp, env: { attack: 0.05, decay: 0.8, sustain: 0.4, release: 1.2 } });
        break;
    }
  }

  private openDream(): void {
    if (this.night) return;
    const kit = this.kit, t = kit.now;
    const ember = kit.noiseLayer('brown', this.out, { type: 'lowpass', hz: 220, q: 0.6 });
    const lfo = kit.lfo(ember.gain.gain, 0.4, 0.03);
    ember.gain.gain.setTargetAtTime(0.18, t, 0.6);
    const crackle = kit.ctx.createGain(); crackle.gain.value = 1e-4; crackle.connect(this.out);
    crackle.gain.setTargetAtTime(1, t, 0.6);
    this.night = { ember, crackle, nextCrackle: t + 0.2, lfo };
    this.dreamingFlag = true;
    this.onDream(true);
  }

  private closeDream(): void {
    const n = this.night;
    if (!n) return;
    const t = this.kit.now;
    n.ember.gain.gain.setTargetAtTime(1e-4, t, 0.7);
    n.crackle.gain.setTargetAtTime(1e-4, t, 0.7);
    n.ember.stop(t + 2.5); n.lfo.stop(t + 2.5);
    setTimeout(() => { try { n.crackle.disconnect(); } catch { /* */ } }, 2600);
    this.night = null;
    this.dreamingFlag = false;
    this.onDream(false);
  }

  /** Fire crackles while dreaming. */
  schedule(now: number, until: number): void {
    const n = this.night;
    if (!n) return;
    const kit = this.kit;
    if (n.nextCrackle < now) n.nextCrackle = now + 0.02;
    while (n.nextCrackle < until) {
      const t = n.nextCrackle;
      kit.burst({ kind: 'white', t, dur: 0.008 + kit.random() * 0.02, gain: 0.05 + kit.random() * 0.12, out: n.crackle, filter: { type: 'bandpass', hz: 1800 + kit.random() * 2500, q: 2 }, env: { attack: 0.001, release: 0.02 } });
      n.nextCrackle += 0.04 + kit.random() * 0.35;
    }
  }

  dispose(): void { if (this.night) this.closeDream(); }
}
