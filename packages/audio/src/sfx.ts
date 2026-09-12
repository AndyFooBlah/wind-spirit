/**
 * The event one-shots. Each is short, distinct and in the world's key where it has a pitch.
 * `count` above one plays a fuller version rather than repeating; unfocused villages play quieter.
 */
import { degreeToMidi, type MusicSpec } from './music.js';
import { midiToHz, type SynthKit } from './synth.js';
import type { SoundName } from './types.js';

export interface SfxCue { sound: SoundName; count: number; focused: boolean }

export function playSound(kit: SynthKit, out: AudioNode, spec: MusicSpec, cue: SfxCue): void {
  const t = kit.now + 0.01;
  const full = Math.min(1.4, 1 + 0.1 * (cue.count - 1));
  const g = (cue.focused ? 1 : 0.55) * full;
  const deg = (d: number) => degreeToMidi(spec.root, spec.scale, d);
  const n = spec.scale.steps.length;
  const o = kit.spread(out, (kit.random() - 0.5) * 0.6);
  switch (cue.sound) {
    case 'discovery': {
      // A rising chime of three bells in the key, with a shimmer on top.
      const notes = [deg(2 * n), deg(2 * n + 2), deg(3 * n)];
      notes.forEach((m, i) => kit.bell(midiToHz(m) * kit.vary(0.003), t + i * 0.11, 0.9, 0.16 * g, o));
      kit.tone({ wave: 'sine', hz: midiToHz(deg(4 * n)), t: t + 0.33, dur: 0.6, gain: 0.05 * g, out: o, env: { attack: 0.05, release: 0.5 }, vibrato: { rate: 6, cents: 8 } });
      break;
    }
    case 'birth': {
      // Two soft rising flute notes, more voices when several births merged.
      const voices = Math.min(3, cue.count);
      for (let v = 0; v < voices; v++) {
        const off = v * 0.16;
        kit.flute(deg(2 * n + v), t + off, 0.22, 0.12 * g, o);
        kit.flute(deg(2 * n + 2 + v), t + off + 0.2, 0.32, 0.14 * g, o);
      }
      break;
    }
    case 'death':
      kit.bell(midiToHz(spec.root - 12) * kit.vary(0.004), t, 1.6, 0.3 * g, o);
      break;
    case 'chiefDeath':
      kit.bell(midiToHz(spec.root - 24) * kit.vary(0.003), t, 3, 0.45 * g, o);
      kit.bell(midiToHz(spec.root - 24) * kit.vary(0.003), t + 1.1, 3, 0.4 * g, o);
      kit.burst({ kind: 'brown', t, dur: 1.5, gain: 0.25 * g, out: o, filter: { type: 'lowpass', hz: 140, q: 0.7 }, env: { attack: 0.05, release: 1.2 } });
      break;
    case 'partyLeft':
    case 'partyReturned': {
      const steps = 7, leaving = cue.sound === 'partyLeft';
      for (let i = 0; i < steps; i++) {
        const frac = i / (steps - 1);
        const lvl = leaving ? 1 - frac * 0.85 : 0.2 + frac * 0.8;
        kit.burst({ kind: 'brown', t: t + i * 0.3 * kit.vary(0.08), dur: 0.05, gain: 0.35 * lvl * g, out: o, filter: { type: 'bandpass', hz: 260 * kit.vary(0.15), q: 1 }, env: { attack: 0.004, release: 0.06 } });
      }
      break;
    }
    case 'boat': {
      for (let i = 0; i < 4; i++) {
        const at = t + i * 0.9, lvl = 1 - i * 0.18;
        kit.tone({ wave: 'sawtooth', hz: 110 * kit.vary(0.1), glideTo: 90, t: at, dur: 0.12, gain: 0.05 * lvl * g, out: o, env: { attack: 0.02, release: 0.08 }, lowpass: 500 });
        kit.burst({ kind: 'white', t: at + 0.15, dur: 0.2, gain: 0.2 * lvl * g, out: o, filter: { type: 'bandpass', hz: 1300, q: 0.8, sweepTo: 500 }, env: { attack: 0.02, release: 0.15 } });
      }
      break;
    }
    case 'harvest':
      for (let i = 0; i < 3; i++) kit.burst({ kind: 'white', t: t + i * 0.45, dur: 0.22, gain: 0.22 * g, out: o, filter: { type: 'bandpass', hz: 2300 * kit.vary(0.1), q: 1.2, sweepTo: 800 }, env: { attack: 0.06, release: 0.1 } });
      break;
    case 'raid': {
      for (let i = 0; i < 5; i++) kit.drum(t + i * 0.17, 70, 0.35 * g, o, { decay: 0.2 });
      for (let i = 0; i < 3; i++) kit.drum(t + 0.085 + i * 0.34, 190, 0.15 * g, o, { noise: 0.9, decay: 0.1 });
      for (let i = 0; i < 3; i++) {
        const at = t + 0.25 + i * 0.28;
        kit.tone({ wave: 'sawtooth', hz: 330 * kit.vary(0.12), glideTo: 200, t: at, dur: 0.16, gain: 0.05 * g, out: o, env: { attack: 0.02, release: 0.08 }, lowpass: 1500 });
        kit.burst({ kind: 'pink', t: at, dur: 0.16, gain: 0.12 * g, out: o, filter: { type: 'bandpass', hz: 900, q: 2, sweepTo: 600 }, env: { attack: 0.02, release: 0.08 } });
      }
      break;
    }
    case 'trade': {
      const fifth = spec.scale.steps.includes(7) ? spec.scale.steps.indexOf(7) : 2;
      kit.pluck(deg(n + fifth), t, 0.28 * g, o, 0.996);
      kit.pluck(deg(n), t + 0.28, 0.32 * g, o, 0.997);
      kit.tone({ wave: 'sine', hz: midiToHz(deg(n)), t: t + 0.28, dur: 0.7, gain: 0.08 * g, out: o, env: { attack: 0.1, release: 0.5 } });
      break;
    }
    case 'prayer': {
      // A chant: a low bowed tone with tremolo, a fifth entering above it, then a bell. Unlike anything else.
      const low = midiToHz(spec.root - 12);
      kit.tone({ wave: 'sawtooth', hz: low, t, dur: 2, gain: 0.16 * g, out: o, env: { attack: 0.4, release: 0.9 }, lowpass: 520, vibrato: { rate: 4.5, cents: 14 } });
      kit.tone({ wave: 'sawtooth', hz: low * 1.5, t: t + 0.5, dur: 1.5, gain: 0.1 * g, out: o, env: { attack: 0.5, release: 0.9 }, lowpass: 700, vibrato: { rate: 4.5, cents: 14 } });
      kit.tone({ wave: 'sine', hz: low * 2, t: t + 0.9, dur: 1.2, gain: 0.08 * g, out: o, env: { attack: 0.4, release: 0.8 } });
      kit.bell(midiToHz(spec.root + 24), t + 1.25, 1.8, 0.2 * g, o);
      kit.burst({ kind: 'pink', t: t + 0.3, dur: 1.6, gain: 0.12 * g, out: o, filter: { type: 'bandpass', hz: 700, q: 0.8, sweepTo: 1600 }, env: { attack: 0.8, release: 0.8 } });
      break;
    }
    case 'villageFounded': {
      const fifth = spec.scale.steps.includes(7) ? spec.scale.steps.indexOf(7) : 2;
      kit.drum(t, 65, 0.3 * g, o, { decay: 0.35 });
      kit.pluck(deg(n), t + 0.05, 0.3 * g, o, 0.997);
      kit.pluck(deg(n + fifth), t + 0.05, 0.26 * g, o, 0.997);
      kit.flute(deg(2 * n), t + 0.35, 0.3, 0.14 * g, o);
      kit.flute(deg(2 * n + fifth), t + 0.62, 0.6, 0.16 * g, o);
      break;
    }
    case 'villageDied': {
      const notes = [deg(n), deg(n - 2), deg(0)];
      notes.forEach((m, i) => kit.flute(m, t + i * 0.55, 0.5, 0.18 * g, o));
      kit.burst({ kind: 'brown', t, dur: 2, gain: 0.25 * g, out: o, filter: { type: 'lowpass', hz: 350, q: 0.5, sweepTo: 120 }, env: { attack: 0.8, release: 1.2 } });
      break;
    }
    case 'storm':
      kit.burst({ kind: 'white', t, dur: 0.05, gain: 0.35 * g, out: o, filter: { type: 'bandpass', hz: 2400, q: 0.8, sweepTo: 500 }, env: { attack: 0.003, release: 0.1 } });
      kit.burst({ kind: 'brown', t: t + 0.04, dur: 1.8, gain: 0.8 * g, out: o, filter: { type: 'lowpass', hz: 150, q: 0.8, sweepTo: 60 }, env: { attack: 0.03, decay: 0.8, sustain: 0.4, release: 1 } });
      break;
    case 'built':
      for (let i = 0; i < 2; i++) {
        kit.burst({ kind: 'white', t: t + i * 0.16, dur: 0.02, gain: 0.18 * g, out: o, filter: { type: 'bandpass', hz: 1000 * kit.vary(0.1), q: 3 }, env: { attack: 0.002, release: 0.05 } });
        kit.tone({ wave: 'triangle', hz: 180 * kit.vary(0.05), t: t + i * 0.16, dur: 0.04, gain: 0.08 * g, out: o, env: { attack: 0.002, release: 0.08 }, lowpass: 800 });
      }
      break;
    case 'famine':
      kit.tone({ wave: 'sine', hz: midiToHz(spec.root - 12) * kit.vary(0.004), t, dur: 1.4, gain: 0.14 * g, out: o, env: { attack: 0.4, release: 0.9 }, vibrato: { rate: 2.2, cents: 30 } });
      kit.burst({ kind: 'pink', t, dur: 1.4, gain: 0.05 * g, out: o, filter: { type: 'bandpass', hz: 400, q: 1.5 }, env: { attack: 0.5, release: 0.8 } });
      break;
    case 'summary':
      kit.drum(t, 60, 0.3 * g, o, { decay: 0.4 });
      kit.burst({ kind: 'pink', t, dur: 0.6, gain: 0.25 * g, out: o, filter: { type: 'bandpass', hz: 400, q: 0.7, sweepTo: 2200 }, env: { attack: 0.2, release: 0.3 } });
      kit.bell(midiToHz(deg(2 * n)), t + 0.55, 1, 0.16 * g, o);
      break;
  }
}
