/** Seeded PRNG with named streams. xoshiro128** seeded through splitmix32 from a string hash. */

export function hashString(s: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t = t ^ (t >>> 15)) >>> 0;
  };
}

export interface RngState { s: [number, number, number, number] }

export class Rng {
  private s: [number, number, number, number];
  constructor(state: [number, number, number, number]) { this.s = [...state] as [number, number, number, number]; }

  static fromSeed(seed: string, stream: string): Rng {
    const sm = splitmix32(hashString(`${seed}::${stream}`));
    return new Rng([sm(), sm(), sm(), sm()]);
  }

  state(): [number, number, number, number] { return [...this.s] as [number, number, number, number]; }

  /** Uniform uint32. */
  next(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }
  /** Integer in [0, n). */
  int(n: number): number { return n <= 0 ? 0 : this.next() % n; }
  /** Integer in [lo, hi]. */
  range(lo: number, hi: number): number { return lo + this.int(hi - lo + 1); }
  /** True with probability p/K (p in thousandths, or finer via scale). */
  chance(pK: number, scale = 1000): boolean { return this.int(scale) < pK; }
  /** Probability test against a value in millionths, for small weekly rates. */
  chanceM(pM: number): boolean { return this.int(1_000_000) < pM; }
  pick<T>(arr: readonly T[]): T { return arr[this.int(arr.length)]; }
  /** Uniform in thousandths [0, K). */
  unitK(): number { return this.int(1000); }
}

function rotl(x: number, k: number): number { return ((x << k) | (x >>> (32 - k))) >>> 0; }

export type StreamName = 'weather' | 'worldgen' | 'techgen' | 'mortality' | 'research' | 'combat' | 'travel' | 'names' | 'births' | 'work';

export class Streams {
  private map = new Map<StreamName, Rng>();
  constructor(private seed: string, saved?: Record<string, [number, number, number, number]>) {
    if (saved) for (const [k, v] of Object.entries(saved)) this.map.set(k as StreamName, new Rng(v));
  }
  get(name: StreamName): Rng {
    let r = this.map.get(name);
    if (!r) { r = Rng.fromSeed(this.seed, name); this.map.set(name, r); }
    return r;
  }
  save(): Record<string, [number, number, number, number]> {
    const out: Record<string, [number, number, number, number]> = {};
    for (const k of [...this.map.keys()].sort()) out[k] = this.map.get(k)!.state();
    return out;
  }
}
