import { describe, expect, it } from 'vitest';
import {
  ambientRecipe, deriveMotifs, deriveMusic, hubbubLevel, inScale, markerFor, MelodyGenerator, SCALES,
  type MusicIntensity, type Note,
} from '../src/index.js';

const INTENSITIES: MusicIntensity[] = ['drone', 'melody', 'tension', 'lament', 'festival'];
const pitched = (n: Note) => n.voice !== 'drum' && n.voice !== 'hand';

describe('deriveMusic', () => {
  it('is deterministic for a seed', () => {
    expect(deriveMusic('wind')).toEqual(deriveMusic('wind'));
  });
  it('picks from the known scales with a sane root and tempo', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const s = deriveMusic(seed);
      expect(SCALES.map((x) => x.name)).toContain(s.scale.name);
      expect(s.root).toBeGreaterThanOrEqual(48); expect(s.root).toBeLessThan(60);
      expect(s.tempo).toBeGreaterThanOrEqual(56); expect(s.tempo).toBeLessThanOrEqual(96);
      expect(s.droneDegrees[0]).toBe(0);
      expect(s.motif.length).toBeGreaterThanOrEqual(3);
    }
  });
  it('different seeds sound different', () => {
    const specs = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((s) => JSON.stringify({ ...deriveMusic(s), seed: '' })));
    expect(specs.size).toBeGreaterThan(3);
  });
});

describe('MelodyGenerator', () => {
  it('is deterministic for a seed', () => {
    const spec = deriveMusic('wind');
    const a = new MelodyGenerator(spec), b = new MelodyGenerator(spec);
    for (let i = 0; i < 32; i++) expect(a.nextBar(INTENSITIES[i % 5])).toEqual(b.nextBar(INTENSITIES[i % 5]));
  });
  it('keeps every pitched note in the chosen scale (the tension scale under tension)', () => {
    for (const seed of ['wind', 'spirit', 'oasis']) {
      const spec = deriveMusic(seed);
      for (const intensity of INTENSITIES) {
        const gen = new MelodyGenerator(spec);
        const scale = intensity === 'tension' ? spec.tensionScale : spec.scale;
        for (let i = 0; i < 64; i++) for (const n of gen.nextBar(intensity).notes.filter(pitched)) expect(inScale(n.midi, spec.root, scale), `${seed} ${intensity} bar ${i} midi ${n.midi}`).toBe(true);
      }
    }
  });
  it('varies over time and produces the layers each intensity promises', () => {
    const spec = deriveMusic('wind');
    const gen = new MelodyGenerator(spec);
    const drone = Array.from({ length: 8 }, () => gen.nextBar('drone'));
    expect(drone.flatMap((b) => b.notes).every((n) => n.voice === 'drone')).toBe(true);
    const melody = Array.from({ length: 32 }, () => gen.nextBar('melody'));
    expect(melody.some((b) => b.notes.some((n) => n.voice === 'lead'))).toBe(true);
    expect(new Set(melody.map((b) => JSON.stringify(b.notes))).size).toBeGreaterThan(4);
    const tension = gen.nextBar('tension');
    expect(tension.notes.filter((n) => n.voice === 'drum')).toHaveLength(spec.beats);
    expect(tension.tempo).toBeGreaterThan(spec.tempo);
    const lament = gen.nextBar('lament');
    expect(lament.tempo).toBeLessThan(spec.tempo);
    const festival = Array.from({ length: 4 }, () => gen.nextBar('festival'));
    expect(festival.some((b) => b.notes.some((n) => n.voice === 'drum'))).toBe(true);
    expect(festival.some((b) => b.notes.some((n) => n.voice === 'hand'))).toBe(true);
  });
  it('different seeds give different melodies', () => {
    const a = new MelodyGenerator(deriveMusic('one')), b = new MelodyGenerator(deriveMusic('two'));
    const sa = JSON.stringify(Array.from({ length: 16 }, () => a.nextBar('melody')));
    const sb = JSON.stringify(Array.from({ length: 16 }, () => b.nextBar('melody')));
    expect(sa).not.toEqual(sb);
  });
});

describe('season motifs and markers', () => {
  it('derives four in-scale motifs that differ by season', () => {
    const spec = deriveMusic('wind');
    const m = deriveMotifs(spec);
    expect(deriveMotifs(spec)).toEqual(m);
    const seen = new Set<string>();
    for (const s of [0, 1, 2, 3] as const) {
      expect(m[s].notes.length).toBe(m[s].durs.length);
      expect(m[s].notes.length).toBeGreaterThanOrEqual(3);
      for (const n of m[s].notes) expect(inScale(n, spec.root, spec.scale)).toBe(true);
      seen.add(m[s].notes.join(','));
    }
    expect(seen.size).toBe(4);
  });
  it('marks weeks at slow speeds, seasons every 13 ticks, the new year every 52', () => {
    expect(markerFor(5, 'slow')).toEqual({ week: true, season: null, newYear: false });
    expect(markerFor(5, 'step').week).toBe(true);
    expect(markerFor(5, 'normal').week).toBe(false);
    expect(markerFor(5, 'fast').week).toBe(false);
    expect(markerFor(13, 'fast')).toEqual({ week: false, season: 1, newYear: false });
    expect(markerFor(26, 'veryfast').season).toBe(2);
    expect(markerFor(52, 'normal')).toEqual({ week: false, season: 0, newYear: true });
    expect(markerFor(0, 'normal').newYear).toBe(false);
  });
});

describe('ambientRecipe', () => {
  it('at world zoom only the wind remains', () => {
    const r = ambientRecipe({ season: 0, roll: 'normal', biome: 'coast', zoom: 'world', speed: 'normal' });
    expect(Object.keys(r).every((k) => k.startsWith('wind'))).toBe(true);
    expect(Object.keys(r).length).toBeGreaterThan(0);
  });
  it('biome and season shape the bed', () => {
    const coast = ambientRecipe({ season: 1, roll: 'normal', biome: 'coast', zoom: 'local', speed: 'normal' });
    expect(coast.surf).toBeGreaterThan(0); expect(coast.gulls).toBeGreaterThan(0); expect(coast.insects).toBeGreaterThan(0);
    const desert = ambientRecipe({ season: 0, roll: 'normal', biome: 'desert', zoom: 'village', speed: 'normal' });
    expect(desert.water).toBeUndefined(); expect(desert.desert).toBeGreaterThan(0);
    const winter = ambientRecipe({ season: 3, roll: 'hard', biome: 'marsh', zoom: 'local', speed: 'normal' });
    expect(winter.insects).toBeUndefined(); expect(winter.frogs).toBeUndefined(); expect(winter.windMuffled).toBeGreaterThan(0);
    const storm = ambientRecipe({ season: 2, roll: 'storm', biome: 'forest', zoom: 'local', speed: 'normal' });
    expect(storm.rain).toBeGreaterThan(0); expect(storm.windHard).toBeGreaterThan(0.5);
  });
});

describe('hubbubLevel', () => {
  it('grows with population and saturates', () => {
    expect(hubbubLevel(0)).toBe(0);
    expect(hubbubLevel(5)).toBeLessThan(hubbubLevel(30));
    expect(hubbubLevel(30)).toBeLessThan(hubbubLevel(300));
    expect(hubbubLevel(100000)).toBe(1);
  });
});
