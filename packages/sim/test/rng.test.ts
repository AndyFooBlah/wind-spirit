import { describe, expect, it } from 'vitest';
import { Rng, Streams, hashString } from '../src/index.js';

describe('rng', () => {
  it('is deterministic for the same seed and stream', () => {
    const a = Rng.fromSeed('s', 'weather'), b = Rng.fromSeed('s', 'weather');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('streams are independent of one another', () => {
    const a = Rng.fromSeed('s', 'weather'), b = Rng.fromSeed('s', 'travel');
    expect(a.next()).not.toBe(b.next());
  });
  it('round-trips state', () => {
    const s = new Streams('s'); s.get('weather').next(); const saved = s.save();
    const s2 = new Streams('s', saved);
    expect(s2.get('weather').next()).toBe(s.get('weather').next());
  });
  it('hashString is stable', () => { expect(hashString('wind')).toBe(hashString('wind')); expect(hashString('wind')).not.toBe(hashString('spirit')); });
});
