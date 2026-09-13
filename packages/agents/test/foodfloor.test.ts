import { describe, expect, it } from 'vitest';
import { foodFloor } from '../src/scheduler.js';
import type { VillageView } from '../src/view.js';
const view = (foodWeeks: number, free: number) => ({ foodWeeks, people: { workersFree: free }, yields: { forage: 3, hunt: 2.5, fish: 0, need: 20 } } as unknown as VillageView);
describe('food floor', () => {
  it('moves hands from building to food when stores are short and nobody gathers', () => {
    const orders = [{ task: 'gather' as const, workers: 6, params: { c: 'wood' }, since: 0 }, { task: 'clear' as const, workers: 5, params: {}, since: 0 }];
    const note = foodFloor(orders, view(7, 11));
    expect(note).toContain('overruled');
    expect(orders.filter(o => o.task === 'forage').reduce((a, o) => a + o.workers, 0)).toBe(4);
    expect(orders.reduce((a, o) => a + o.workers, 0)).toBe(11);
  });
  it('leaves a well-stocked village alone', () => {
    const orders = [{ task: 'gather' as const, workers: 11, params: { c: 'wood' }, since: 0 }];
    expect(foodFloor(orders, view(20, 11))).toBeUndefined();
  });
  it('does nothing when food work already meets the floor', () => {
    const orders = [{ task: 'hunt' as const, workers: 5, params: {}, since: 0 }, { task: 'clear' as const, workers: 6, params: {}, since: 0 }];
    expect(foodFloor(orders, view(3, 11))).toBeUndefined();
  });
});
