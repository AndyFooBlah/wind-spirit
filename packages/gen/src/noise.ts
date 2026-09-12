/** 2D simplex noise with a seeded permutation table. Returns values in [-1, 1]. */
import type { Rng } from '@wind-spirit/sim';

const GRAD: [number, number][] = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;

export class Simplex {
  private perm = new Uint8Array(512);
  constructor(rng: Rng) {
    const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = rng.int(i + 1); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  noise(x: number, y: number): number {
    const s = (x + y) * F2; const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2; const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const g0 = GRAD[this.perm[ii + this.perm[jj]] & 7], g1 = GRAD[this.perm[ii + i1 + this.perm[jj + j1]] & 7], g2 = GRAD[this.perm[ii + 1 + this.perm[jj + 1]] & 7];
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0; if (t0 > 0) { t0 *= t0; n += t0 * t0 * (g0[0] * x0 + g0[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1; if (t1 > 0) { t1 *= t1; n += t1 * t1 * (g1[0] * x1 + g1[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2; if (t2 > 0) { t2 *= t2; n += t2 * t2 * (g2[0] * x2 + g2[1] * y2); }
    return 70 * n;
  }
  /** Fractal Brownian motion in [0, 1]. */
  fbm(x: number, y: number, octaves = 4, lac = 2, gain = 0.5): number {
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) { sum += a * this.noise(x * f, y * f); norm += a; a *= gain; f *= lac; }
    return (sum / norm + 1) / 2;
  }
}
