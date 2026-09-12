import { K, mul, div, ceilDiv } from './fixed.js';
import { Streams } from './rng.js';
import { AGE_ADULT, AGE_ELDER, P, PLOT_GRID, TERRAIN, TILE_MILES } from './params.js';
import type { Event, Knowledge, Person, Plot, Recipe, Stack, Stage, Tile, Village, World, YearStats } from './types.js';

export interface Ctx { w: World; rng: Streams; events: Event[]; }

export const idx = (w: World, x: number, y: number): number => y * w.width + x;
export const xy = (w: World, id: number): [number, number] => [id % w.width, Math.floor(id / w.width)];
export const inBounds = (w: World, x: number, y: number): boolean => x >= 0 && y >= 0 && x < w.width && y < w.height;

/** Tile ids within Chebyshev radius r, excluding the center unless includeSelf. */
export function neighbors(w: World, id: number, r = 1, includeSelf = false): number[] {
  const [cx, cy] = xy(w, id); const out: number[] = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (!inBounds(w, x, y)) continue;
    if (!includeSelf && x === cx && y === cy) continue;
    out.push(idx(w, x, y));
  }
  return out;
}

export function tileDistance(w: World, a: number, b: number): number {
  const [ax, ay] = xy(w, a), [bx, by] = xy(w, b);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}
export const milesBetween = (w: World, a: number, b: number): number => tileDistance(w, a, b) * TILE_MILES;

export function stageOf(born: number, tick: number): Stage {
  const age = tick - born;
  return age < AGE_ADULT() ? 'child' : age < AGE_ELDER() ? 'adult' : 'elder';
}

export function popCounts(v: Village, tick: number): { children: number; adults: number; elders: number; total: number } {
  let children = 0, adults = 0, elders = 0;
  for (const p of v.people) { const s = stageOf(p.born, tick); if (s === 'child') children++; else if (s === 'adult') adults++; else elders++; }
  return { children, adults, elders, total: v.people.length };
}

export const villageById = (w: World, id: number): Village => w.villages[id];
export const recipeById = (w: World, id: string): Recipe | undefined => w.recipes.find(r => r.id === id);
export const commodityById = (w: World, id: string) => w.commodities.find(c => c.id === id);

export function structures(w: World, v: Village): Recipe[] {
  const out: Recipe[] = [];
  for (const p of v.plots) if (p.kind === 'structure') { const r = recipeById(w, p.recipe); if (r) out.push(r); }
  return out;
}

/** Shelter: capacity in people and a quality-weighted score in thousandths (1000 = everyone in good shelter). */
export function shelter(w: World, v: Village): { capacity: number; score: number } {
  let capacity = 0, weighted = 0;
  for (const r of structures(w, v)) if (r.structure && r.structure.shelter > 0) {
    capacity += r.structure.shelter; weighted += r.structure.shelter * r.structure.quality;
  }
  const pop = v.people.length || 1;
  const covered = Math.min(capacity, pop);
  const quality = capacity > 0 ? Math.trunc(weighted / capacity) : 0;
  return { capacity, score: Math.trunc((covered * quality) / pop) };
}

export function storageMult(w: World, v: Village): number {
  let best = K;
  for (const r of structures(w, v)) if (r.structure && r.structure.storage > best) best = r.structure.storage;
  return best;
}

export function isFood(w: World, c: string): boolean { const cm = commodityById(w, c); return !!cm && cm.food > 0; }

export function totalFood(w: World, v: Village): number {
  let t = 0; for (const s of v.stores) if (isFood(w, s.c)) t += s.qty; return t;
}
export const foodNeed = (v: Village): number => v.people.length * P.foodPerPersonWeek;
export const storesWeeks = (w: World, v: Village): number => (v.people.length === 0 ? 0 : Math.trunc(totalFood(w, v) / foodNeed(v)));

export function addStore(v: Village, c: string, qty: number, age = 0): void {
  if (qty <= 0) return;
  for (const s of v.stores) if (s.c === c && s.age === age) { s.qty += qty; return; }
  v.stores.push({ c, qty, age });
}
export function storeQty(v: Village, c: string): number { let t = 0; for (const s of v.stores) if (s.c === c) t += s.qty; return t; }

/** Take up to qty of commodity c, oldest first. Returns amount taken. */
export function takeStore(v: Village, c: string, qty: number): number {
  let left = qty;
  const stacks = v.stores.filter(s => s.c === c).sort((a, b) => b.age - a.age);
  for (const s of stacks) { const take = Math.min(s.qty, left); s.qty -= take; left -= take; if (left === 0) break; }
  v.stores = v.stores.filter(s => s.qty > 0);
  return qty - left;
}

/** Eat up to qty food units, soonest-to-spoil first. Returns amount eaten. */
export function takeFood(w: World, v: Village, qty: number): number {
  const mult = storageMult(w, v);
  const ranked = v.stores
    .filter(s => isFood(w, s.c))
    .map(s => ({ s, left: (() => { const cm = commodityById(w, s.c)!; return cm.perish === 0 ? 1e9 : mul(cm.perish * K, mult) / K - s.age; })() }))
    .sort((a, b) => a.left - b.left);
  let left = qty;
  for (const { s } of ranked) { const take = Math.min(s.qty, left); s.qty -= take; left -= take; if (left === 0) break; }
  v.stores = v.stores.filter(s => s.qty > 0);
  return qty - left;
}

export function emptyYear(): YearStats {
  return { births: 0, deathsAge: 0, deathsHunger: 0, deathsTravel: 0, forage: 0, hunt: 0, fish: 0, farm: 0, wood: 0, stone: 0, spoiled: 0 };
}

export function newPlots(): Plot[] {
  const plots: Plot[] = [];
  for (let i = 0; i < PLOT_GRID * PLOT_GRID; i++) plots.push({ kind: 'wild', fertility: K, planted: false, progress: 0, recipe: '' });
  return plots;
}

export function knowledgeUnion(k: Knowledge, tiles: Iterable<number>): void {
  const set = new Set(k.tiles); for (const t of tiles) set.add(t);
  k.tiles = [...set].sort((a, b) => a - b);
}

export function nextName(w: World): string {
  const names = (w as unknown as { names: string[] }).names;
  const cur = (w as unknown as { nameCursor: number }).nameCursor ?? 0;
  (w as unknown as { nameCursor: number }).nameCursor = cur + 1;
  return names && names.length ? names[cur % names.length] + (cur >= names.length ? ` ${Math.floor(cur / names.length) + 1}` : '') : `Village ${cur}`;
}

export interface FoundOpts { tile: number; people: Person[]; parent: number; culture: number[]; recipes: string[]; knownTiles: number[]; food: number; tents: number; }

/** Create a village on a tile. Used by world generation and by colonists. */
export function foundVillage(ctx: Ctx, o: FoundOpts): Village {
  const { w } = ctx;
  const id = w.villages.length;
  const rng = ctx.rng.get('names');
  const chiefTraits = o.culture.map(c => Math.max(0, Math.min(K, c + rng.range(-150, 150))));
  const adults = o.people.filter(p => stageOf(p.born, w.tick) === 'adult');
  const chief = adults.length ? rng.pick(adults).id : o.people.length ? rng.pick(o.people).id : -1;
  const plots = newPlots();
  for (let i = 0; i < o.tents; i++) { const p = plots[i]; p.kind = 'structure'; p.recipe = 'tent'; }
  const v: Village = {
    id, name: nextName(w), tile: o.tile, founded: w.tick, alive: true, parent: o.parent,
    people: o.people, chief, culture: [...o.culture], chiefTraits,
    stores: [], plots, recipes: [...o.recipes], orders: [],
    happiness: 700, lowHappyWeeks: 0, trust: 300,
    knowledge: { tiles: [], villages: [id] },
    recentDeaths: [], hungryWeek: 0, calmWeeks: 52, hardship: 0, year: emptyYear(),
  };
  knowledgeUnion(v.knowledge, [...o.knownTiles, ...neighbors(w, o.tile, 2, true)]);
  if (o.food > 0) addStore(v, 'plants', Math.trunc(o.food / 2)); // colonists' food: half durable, half fresh
  if (o.food > 0) addStore(v, 'grain', o.food - Math.trunc(o.food / 2));
  w.villages.push(v);
  w.tiles[o.tile].village = id;
  return v;
}

export function newPerson(w: World, born: number): Person { return { id: w.nextId++, born, hungry: 0 }; }

export { ceilDiv, div };
