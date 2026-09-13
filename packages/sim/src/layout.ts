/**
 * Where things go on a village's 12 × 12 plot grid. Buildings gather near the centre; fields grow in clusters a few
 * squares out. Everything here is a pure function of the village (a hash stands in for randomness), so placement is
 * deterministic and a building, once sited, never moves.
 */
import { PLOT_GRID } from './params.js';
import { hashString } from './rng.js';
import type { Plot, Village } from './types.js';

const MID = (PLOT_GRID - 1) / 2;
/** Farm clusters grow until this many plots are joined, then a new cluster seeds elsewhere. */
const CLUSTER_MAX = 14;
/** Fields are sited at least this far from the centre, so the middle stays free for buildings. */
const FIELD_MIN_DIST = 2.6;
/** A new farm cluster seeds about this far out. */
const FIELD_SEED_DIST = 4.5;

export function plotXY(i: number): [number, number] { return [i % PLOT_GRID, Math.floor(i / PLOT_GRID)]; }
/** Distance of a plot's centre from the centre of the village grid. */
export function plotDist(i: number): number { const [x, y] = plotXY(i); return Math.hypot(x - MID, y - MID); }
/** Stable pseudo-random in [0, 1) for a (village, plot) pair. */
export function plotJitter(villageId: number, i: number, salt = ''): number { return (hashString(`${villageId}:${i}:${salt}`) >>> 0) / 4_294_967_296; }

const bare = (p: Plot) => p.recipe === '' && !p.planted && p.progress === 0;
const farmland = (p: Plot) => (p.kind === 'clear' || p.kind === 'field') && p.recipe === '';

function neighbours8(i: number): number[] {
  const [x, y] = plotXY(i); const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue; const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < PLOT_GRID && ny < PLOT_GRID) out.push(ny * PLOT_GRID + nx);
  }
  return out;
}

/** Size of the connected patch of farmland containing plot i (8-connected). */
function patchSize(v: Village, i: number): number {
  const seen = new Set<number>([i]); const stack = [i];
  while (stack.length) { const c = stack.pop()!; for (const n of neighbours8(c)) if (!seen.has(n) && farmland(v.plots[n])) { seen.add(n); stack.push(n); } }
  return seen.size;
}

/** The plots the founders pitch their tents on: nearest the centre, lightly shuffled. */
export function foundingSites(villageId: number, n: number): number[] {
  const all = Array.from({ length: PLOT_GRID * PLOT_GRID }, (_, i) => i);
  return all.sort((a, b) => (plotDist(a) + plotJitter(villageId, a, 'found') * 1.5) - (plotDist(b) + plotJitter(villageId, b, 'found') * 1.5)).slice(0, n);
}

/**
 * Where the next building goes: the free plot nearest the centre, cleared ground preferred over wild, with a little
 * jitter so the village does not grow as a perfect spiral. Wild ground is cleared as part of the build (no wood yield).
 */
export function structureSite(v: Village): number | undefined {
  let best: number | undefined; let bestScore = Infinity;
  for (let i = 0; i < v.plots.length; i++) {
    const p = v.plots[i]; if (!(p.kind === 'wild' || p.kind === 'clear') || !bare(p)) continue;
    const score = plotDist(i) + plotJitter(v.id, i, 'build') * 1.2 + (p.kind === 'wild' ? 0.75 : 0);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/**
 * Where the next field is cleared: next to an existing patch of farmland while that patch is small, otherwise a fresh
 * patch a few squares out from the centre. Never on the plots the buildings need.
 */
export function clearingSite(v: Village): number | undefined {
  let best: number | undefined; let bestScore = Infinity; let fallback: number | undefined; let fallbackScore = Infinity;
  for (let i = 0; i < v.plots.length; i++) {
    const p = v.plots[i]; if (p.kind !== 'wild' || !bare(p)) continue;
    const d = plotDist(i); const j = plotJitter(v.id, i, 'clear');
    if (d < FIELD_MIN_DIST) { const s = 100 + d + j; if (s < fallbackScore) { fallbackScore = s; fallback = i; } continue; }
    const adjacent = neighbours8(i).filter(n => farmland(v.plots[n]));
    let score: number;
    if (adjacent.length && patchSize(v, adjacent[0]) < CLUSTER_MAX) score = j * 3 - Math.min(adjacent.length, 3) * 0.4;   // grow the patch, favouring snug corners
    else score = 4 + Math.abs(d - FIELD_SEED_DIST) * 1.5 + j * 2;                                                          // seed a new patch
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best ?? fallback;
}
