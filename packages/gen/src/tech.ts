/** Static M0 commodity and recipe set. The generator (M1) will replace this with seeded leaves on a skeleton. */
import type { Commodity, Recipe } from '@wind-spirit/sim';

export const COMMODITIES: Commodity[] = [
  { id: 'plants', name: 'wild plants', category: 'fruit', food: 1000, perish: 4, weight: 1000 },
  { id: 'meat', name: 'meat', category: 'meat', food: 1000, perish: 2, weight: 1000 },
  { id: 'fish', name: 'fish', category: 'fish', food: 1000, perish: 2, weight: 1000 },
  { id: 'grain', name: 'grain', category: 'grain', food: 1000, perish: 52, weight: 1000 },
  { id: 'wood', name: 'wood', category: 'wood', food: 0, perish: 0, weight: 3000 },
  { id: 'stone', name: 'stone', category: 'stone', food: 0, perish: 0, weight: 5000 },
];

export const RECIPES: Recipe[] = [
  { id: 'tent', name: 'hide tent', tier: 1, inputs: [], labor: 1, structure: { shelter: 5, quality: 600, storage: 1000 } },
  { id: 'hut', name: 'wood hut', tier: 2, inputs: [{ c: 'wood', qty: 8000 }], labor: 6, structure: { shelter: 8, quality: 1000, storage: 1000 } },
  { id: 'granary', name: 'granary', tier: 2, inputs: [{ c: 'wood', qty: 12_000 }, { c: 'stone', qty: 4000 }], labor: 10, structure: { shelter: 0, quality: 0, storage: 3000 } },
];

export const START_RECIPES = ['tent', 'hut', 'granary'];
