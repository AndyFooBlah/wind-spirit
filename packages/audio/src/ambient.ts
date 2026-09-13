/**
 * Ambient beds: season × roll × biome × zoom → a recipe of layer levels (pure), and a mixer that
 * crossfades live layers to match. Layers are looping filtered noise or scheduled chirps.
 */
import { midiToHz, type Layer, type SynthKit } from './synth.js';
import type { Scene } from './types.js';

export type LayerId =
  | 'wind' | 'windHard' | 'windMuffled' | 'rain' | 'birds' | 'water' | 'insects' | 'leaves' | 'geese' | 'snow'
  | 'surf' | 'gulls' | 'river' | 'forest' | 'desert' | 'mountain' | 'frogs';
export const LAYER_IDS: readonly LayerId[] = [
  'wind', 'windHard', 'windMuffled', 'rain', 'birds', 'water', 'insects', 'leaves', 'geese', 'snow',
  'surf', 'gulls', 'river', 'forest', 'desert', 'mountain', 'frogs',
];

export type Recipe = Partial<Record<LayerId, number>>;

/** Layer levels 0..1 for a scene. At world zoom only the wind remains. */
export function ambientRecipe(scene: Scene): Recipe {
  const r: Record<string, number> = {};
  const add = (id: LayerId, v: number) => { r[id] = Math.max(0, Math.min(1, (r[id] ?? 0) + v)); };
  const { season, roll, biome, zoom } = scene;
  const wet = roll === 'wet' || roll === 'storm';

  // Wind: every season and every zoom; the spirit's presence rides on top of this on its own bus.
  if (season === 0) add('wind', 0.3);
  else if (season === 1) add('wind', 0.35);
  else if (season === 2) { add('wind', 0.4); add('windHard', 0.5); }
  else { add('windMuffled', 0.5); add('wind', 0.2); }
  if (roll === 'storm') { add('windHard', 0.5); add('rain', 0.5); }
  if (roll === 'hard') add('windHard', 0.3);
  if (zoom === 'world') return prune(r);

  // Season voice.
  if (season === 0) { add('birds', 0.8); add('water', 0.5); if (wet) add('rain', 0.6); if (roll === 'drought') { add('water', -0.4); add('birds', -0.2); } }
  else if (season === 1) { add('insects', 0.7); add('birds', 0.3); if (roll === 'drought') { add('insects', 0.25); add('birds', -0.15); } if (wet) add('rain', 0.4); }
  else if (season === 2) { add('leaves', 0.6); add('geese', 0.4); if (wet) add('rain', 0.4); if (roll === 'drought') add('leaves', 0.2); }
  else { add('snow', 0.3); if (wet) add('snow', 0.2); }

  // Biome voice.
  switch (biome) {
    case 'coast': add('surf', 0.7); add('gulls', season === 3 ? 0.2 : 0.45); break;
    case 'ocean': add('surf', 0.9); add('gulls', 0.3); add('birds', -0.5); add('insects', -0.4); break;
    case 'river': add('river', 0.7); break;
    case 'lake': add('water', 0.5); add('frogs', season === 1 ? 0.3 : 0.1); break;
    case 'forest': add('forest', 0.6); add('birds', 0.2); add('wind', -0.1); break;
    case 'desert': add('desert', 0.7); add('birds', -0.6); add('water', -1); add('insects', -0.3); break;
    case 'oasis': add('water', 0.4); add('insects', 0.3); add('desert', 0.25); break;
    case 'mountain': add('mountain', 0.6); add('birds', -0.5); add('insects', -0.5); add('wind', 0.1); break;
    case 'hills': add('wind', 0.1); add('birds', 0.1); break;
    case 'marsh': add('frogs', season === 3 ? 0.1 : 0.5); add('insects', 0.2); add('water', 0.2); break;
    case 'grass': add('wind', 0.05); add('birds', 0.1); break;
  }
  if (season === 3) { add('birds', -0.6); add('insects', -1); add('frogs', -1); }
  return prune(r);
}

function prune(r: Record<string, number>): Recipe {
  const out: Recipe = {};
  for (const [k, v] of Object.entries(r)) if (v > 0.001) out[k as LayerId] = v;
  return out;
}

interface Live extends Layer {
  level: number;
  /** Scheduled chirps; `level` is the current target level. */
  schedule?(now: number, until: number, level: number): void;
  extras: { stop(t: number): void }[];
}

const FADE = 2;

export class AmbientMixer {
  private live = new Map<LayerId, Live>();
  private removing: Live[] = [];

  constructor(private kit: SynthKit, private out: AudioNode) {}

  levels(): Partial<Record<LayerId, number>> {
    const o: Partial<Record<LayerId, number>> = {};
    for (const [k, v] of this.live) o[k] = v.level;
    return o;
  }

  /** Crossfade to `recipe` over `fade` seconds. */
  apply(recipe: Recipe, fade = FADE): void {
    const t = this.kit.now;
    for (const [id, layer] of this.live) {
      if (recipe[id] === undefined) {
        layer.gain.gain.setTargetAtTime(1e-4, t, fade / 3);
        layer.stop(t + fade + 0.5);
        for (const x of layer.extras) x.stop(t + fade + 0.5);
        this.live.delete(id);
        this.removing.push(layer);
      }
    }
    for (const [id, level] of Object.entries(recipe) as [LayerId, number][]) {
      let layer = this.live.get(id);
      if (!layer) { layer = this.build(id); this.live.set(id, layer); }
      layer.level = level;
      layer.gain.gain.setTargetAtTime(Math.max(1e-4, level * BASE_GAIN[id]), t, fade / 3);
    }
  }

  schedule(now: number, until: number): void {
    for (const l of this.live.values()) l.schedule?.(now, until, l.level);
  }

  dispose(): void {
    const t = this.kit.now;
    for (const l of this.live.values()) { l.stop(t); for (const x of l.extras) x.stop(t); }
    for (const l of this.removing) { l.stop(t); for (const x of l.extras) x.stop(t); }
    this.live.clear(); this.removing = [];
  }

  private build(id: LayerId): Live {
    const kit = this.kit, out = this.out;
    const extras: { stop(t: number): void }[] = [];
    const noise = (kind: 'white' | 'pink' | 'brown', type: BiquadFilterType, hz: number, q?: number) => kit.noiseLayer(kind, out, { type, hz, q });
    const mk = (l: Layer, schedule?: Live['schedule']): Live => ({ ...l, level: 0, extras, schedule });
    // Scheduled chirps keep their own "next" time so bursts stay sparse regardless of how often schedule() runs.
    let next = kit.now + 0.5 + kit.random();
    const every = (minGap: number, maxGap: number, fire: (t: number, level: number) => void): Live['schedule'] =>
      (now, until, level) => {
        if (next < now) next = now + 0.05;
        while (next < until) { fire(next, level); next += (minGap + kit.random() * (maxGap - minGap)) / Math.max(0.2, level); }
      };
    switch (id) {
      case 'wind': { const l = noise('brown', 'lowpass', 420, 0.5); extras.push(kit.lfo(l.filter!.frequency, 0.08, 180), kit.lfo(l.gain.gain, 0.11, 0.06)); return mk(l); }
      case 'windHard': { const l = noise('pink', 'bandpass', 700, 0.4); extras.push(kit.lfo(l.filter!.frequency, 0.21, 380), kit.lfo(l.gain.gain, 0.17, 0.08)); return mk(l); }
      case 'windMuffled': { const l = noise('brown', 'lowpass', 180, 0.6); extras.push(kit.lfo(l.gain.gain, 0.07, 0.08)); return mk(l); }
      case 'rain': { const l = noise('white', 'highpass', 1800, 0.5); extras.push(kit.lfo(l.gain.gain, 0.3, 0.03)); return mk(l); }
      case 'water': { const l = noise('brown', 'bandpass', 900, 0.6); extras.push(kit.lfo(l.filter!.frequency, 0.3, 250)); return mk(l); }
      // Insects used to be a continuous 4 kHz sawtooth: a whine that never stopped. Now short buzzes, a few seconds apart, lower and quieter.
      case 'insects': { const g = silent(kit, out); return mk(g, every(2.5, 7, (t, level) => { const hz = 1400 + kit.random() * 900; kit.tone({ wave: 'sawtooth', hz, glideTo: hz * 0.9, t, dur: 0.12 + kit.random() * 0.2, gain: 0.02 * level, out: g.gain, env: { attack: 0.02, release: 0.08 }, lowpass: 2600 }); })); }
      case 'leaves': { const l = noise('white', 'bandpass', 2500, 0.8); extras.push(kit.lfo(l.gain.gain, 0.5, 0.05), kit.lfo(l.filter!.frequency, 0.13, 600)); return mk(l); }
      case 'surf': { const l = noise('brown', 'lowpass', 900, 0.5); extras.push(kit.lfo(l.gain.gain, 0.09, 0.12), kit.lfo(l.filter!.frequency, 0.09, 500)); return mk(l); }
      case 'river': { const l = noise('white', 'bandpass', 1400, 0.5); extras.push(kit.lfo(l.filter!.frequency, 0.5, 300)); return mk(l); }
      case 'forest': { const l = noise('pink', 'lowpass', 500, 0.5); extras.push(kit.lfo(l.gain.gain, 0.05, 0.04)); return mk(l); }
      case 'desert': { const l = noise('pink', 'bandpass', 1800, 0.5); extras.push(kit.lfo(l.gain.gain, 0.05, 0.1), kit.lfo(l.filter!.frequency, 0.04, 700)); return mk(l); }
      case 'mountain': { const l = noise('brown', 'lowpass', 120, 0.7); extras.push(kit.lfo(l.gain.gain, 0.03, 0.06)); return mk(l); }
      case 'birds': { const g = silent(kit, out); return mk(g, every(1.5, 5, (t, level) => { const n = 1 + kit.rng.int(3); const base = 2200 + kit.random() * 1200; for (let i = 0; i < n; i++) kit.tone({ wave: 'sine', hz: base, glideTo: base * (1.2 + kit.random() * 0.4), t: t + i * 0.09, dur: 0.05, gain: 0.05 * level, out: g.gain, env: { attack: 0.01, release: 0.04 } }); })); }
      case 'geese': { const g = silent(kit, out); return mk(g, every(6, 14, (t, level) => { const n = 2 + kit.rng.int(3); for (let i = 0; i < n; i++) kit.tone({ wave: 'sawtooth', hz: 380 * kit.vary(0.1), glideTo: 300, t: t + i * 0.28, dur: 0.16, gain: 0.05 * level, out: g.gain, env: { attack: 0.02, release: 0.06 }, lowpass: 1200 }); })); }
      case 'snow': { const g = silent(kit, out); return mk(g, every(8, 20, (t, level) => { const n = 3 + kit.rng.int(4); for (let i = 0; i < n; i++) kit.burst({ kind: 'white', t: t + i * 0.55, dur: 0.07, gain: 0.08 * level, out: g.gain, filter: { type: 'bandpass', hz: 1200, q: 1 }, env: { attack: 0.005, release: 0.05 } }); })); }
      case 'gulls': { const g = silent(kit, out); return mk(g, every(4, 12, (t, level) => { const n = 1 + kit.rng.int(3); for (let i = 0; i < n; i++) kit.tone({ wave: 'sawtooth', hz: 1100 * kit.vary(0.08), glideTo: 800, t: t + i * 0.4, dur: 0.3, gain: 0.03 * level, out: g.gain, env: { attack: 0.05, release: 0.1 }, lowpass: 2500 }); })); }
      case 'frogs': { const g = silent(kit, out); return mk(g, every(1, 4, (t, level) => { const hz = midiToHz(52 + kit.rng.int(8)); kit.tone({ wave: 'square', hz, glideTo: hz * 0.85, t, dur: 0.12, gain: 0.03 * level, out: g.gain, env: { attack: 0.01, release: 0.05 }, lowpass: 700 }); })); }
    }
  }
}

/** A level gain with nothing running through it; scheduled layers play their one-shots into it. */
function silent(kit: SynthKit, out: AudioNode): Layer & { filter: null } {
  const gain = kit.ctx.createGain(); gain.gain.value = 1e-4; gain.connect(out);
  return { gain, filter: null, stop: () => { setTimeout(() => { try { gain.disconnect(); } catch { /* */ } }, 3000); } };
}

/** Per-layer trim so a level of 1 sits at a sensible loudness relative to the others. */
const BASE_GAIN: Record<LayerId, number> = {
  wind: 0.5, windHard: 0.35, windMuffled: 0.6, rain: 0.12, birds: 1, water: 0.2, insects: 0.06, leaves: 0.12, geese: 1, snow: 1,
  surf: 0.5, gulls: 1, river: 0.14, forest: 0.35, desert: 0.18, mountain: 0.6, frogs: 1,
};
