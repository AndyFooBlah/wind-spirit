import { describe, expect, it } from 'vitest';
import { K, PLOT_GRID } from '../src/params.js';
import { clearingSite, foundingSites, plotDist, structureSite } from '../src/layout.js';
import type { Plot, Village } from '../src/types.js';

const fresh = (): Plot[] => Array.from({ length: PLOT_GRID * PLOT_GRID }, () => ({ kind: 'wild', fertility: K, planted: false, progress: 0, recipe: '', crop: '' }));
const village = (plots: Plot[]) => ({ id: 3, plots } as unknown as Village);

describe('layout', () => {
  it('founders pitch tents near the centre, deterministically', () => {
    const a = foundingSites(3, 4), b = foundingSites(3, 4);
    expect(a).toEqual(b);
    for (const i of a) expect(plotDist(i)).toBeLessThan(2.5);
  });
  it('buildings take the nearest free ground to the centre and never move', () => {
    const plots = fresh(); const v = village(plots);
    const first = structureSite(v)!; expect(plotDist(first)).toBeLessThan(2);
    plots[first].recipe = 'hut'; plots[first].progress = 500;
    expect(structureSite(v)).not.toBe(first);
    plots[first].kind = 'structure'; plots[first].progress = 0;
    const second = structureSite(v)!; expect(second).not.toBe(first); expect(plotDist(second)).toBeLessThan(2.5);
  });
  it('fields start a few squares out and grow in a patch', () => {
    const plots = fresh(); const v = village(plots);
    const seed = clearingSite(v)!; expect(plotDist(seed)).toBeGreaterThan(2.6);
    plots[seed].kind = 'clear';
    const next = clearingSite(v)!;
    const [x1, y1] = [seed % PLOT_GRID, Math.floor(seed / PLOT_GRID)], [x2, y2] = [next % PLOT_GRID, Math.floor(next / PLOT_GRID)];
    expect(Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2))).toBe(1);
  });
  it('a half-built plot is never picked for clearing', () => {
    const plots = fresh(); const v = village(plots);
    const site = structureSite(v)!; plots[site].recipe = 'hut'; plots[site].progress = 100;
    expect(clearingSite(v)).not.toBe(site);
  });
});
