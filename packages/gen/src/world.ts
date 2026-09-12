/** Seeded world generation: elevation, moisture, rivers, biomes, resources, village sites, wind. */
import {
  K, Rng, Sim, Streams, TERRAIN, WILD, foundVillage, idx, neighbors, newPerson, tileDistance, xy,
  type Terrain, type Tile, type World, type Person, type Direction,
} from '@wind-spirit/sim';
import { Simplex } from './noise.js';
import { villageNames } from './names.js';
import { COMMODITIES, RECIPES, START_RECIPES } from './tech.js';

export interface GenOptions {
  seed: string; width?: number; height?: number;
  villages?: number; startPop?: number; startFoodWeeks?: number;
}

const OCEAN = 0.30, MOUNTAIN = 0.78, HILLS = 0.62, DESERT = 0.28, FOREST = 0.55, MARSH = 0.80;

export function generateWorld(o: GenOptions): World {
  const width = o.width ?? 64, height = o.height ?? 64, n = width * height;
  const rng = Rng.fromSeed(o.seed, 'worldgen');
  const nElev = new Simplex(rng), nMoist = new Simplex(rng), nVar = new Simplex(rng), nOasis = new Simplex(rng);
  const elev = new Float64Array(n), moist = new Float64Array(n);
  const scale = 1 / (Math.min(width, height) / 3.2);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    const ex = Math.min(x, width - 1 - x, y, height - 1 - y) / Math.min(width, height);   // distance to edge 0..0.5
    const edge = Math.max(0, 0.12 - ex) / 0.12;                                            // 1 at the edge, 0 inland
    elev[i] = nElev.fbm(x * scale, y * scale, 5) - 0.30 * edge;
    moist[i] = nMoist.fbm(x * scale * 0.8 + 100, y * scale * 0.8 + 100, 4);
  }
  // rivers: flow accumulation downhill over land
  const order = [...Array(n).keys()].filter(i => elev[i] >= OCEAN).sort((a, b) => elev[b] - elev[a]);
  const down = new Int32Array(n).fill(-1); const acc = new Float64Array(n).fill(1);
  const dummy = { width, height } as World;
  for (const i of order) {
    let best = -1, be = elev[i];
    for (const nb of neighbors(dummy, i, 1)) if (elev[nb] < be) { be = elev[nb]; best = nb; }
    down[i] = best;
  }
  for (const i of order) if (down[i] >= 0) acc[down[i]] += acc[i];
  // distance to ocean for moisture
  const distOcean = new Float64Array(n).fill(99);
  for (let i = 0; i < n; i++) if (elev[i] < OCEAN) distOcean[i] = 0;
  for (let pass = 0; pass < 20; pass++) for (let i = 0; i < n; i++) if (distOcean[i] > 0) for (const nb of neighbors(dummy, i, 1)) distOcean[i] = Math.min(distOcean[i], distOcean[nb] + 1);
  for (let i = 0; i < n; i++) moist[i] = Math.min(1, moist[i] + 0.25 * Math.max(0, 1 - distOcean[i] / 20));

  const terrain: Terrain[] = new Array(n);
  const ford = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const e = elev[i], m = moist[i];
    if (e < OCEAN) { terrain[i] = 'ocean'; continue; }
    if (e >= MOUNTAIN) { terrain[i] = 'mountain'; continue; }
    const isRiver = acc[i] >= 22 && down[i] >= 0;
    const isLake = down[i] === -1 && acc[i] >= 10;
    if (isLake) { terrain[i] = 'lake'; continue; }
    if (isRiver) { terrain[i] = 'river'; if (acc[i] < 45) ford[i] = 1; continue; }
    if (m < DESERT && e < HILLS) { terrain[i] = 'desert'; continue; }
    if (e >= HILLS) { terrain[i] = 'hills'; continue; }
    if (m > MARSH && e < 0.42) { terrain[i] = 'marsh'; continue; }
    terrain[i] = m > FOREST ? 'forest' : 'grass';
  }
  for (let i = 0; i < n; i++) {
    if (terrain[i] === 'desert') { const [x, y] = xy(dummy, i); if (nOasis.fbm(x * 0.9, y * 0.9, 2) > 0.80) terrain[i] = 'oasis'; }
  }
  for (let i = 0; i < n; i++) {
    if (terrain[i] !== 'ocean' && terrain[i] !== 'lake' && terrain[i] !== 'river' && terrain[i] !== 'mountain') {
      if (neighbors(dummy, i, 1).some(nb => terrain[nb] === 'ocean')) terrain[i] = 'coast';
    }
  }

  const tiles: Tile[] = [];
  for (let i = 0; i < n; i++) {
    const t = terrain[i]; const info = TERRAIN[t]; const [x, y] = xy(dummy, i);
    const variation = 0.7 + 0.6 * nVar.fbm(x * 0.15 + 50, y * 0.15 + 50, 2);
    const cap = {} as Record<typeof WILD[number], number>, stock = {} as Record<typeof WILD[number], number>;
    for (const r of WILD) { cap[r] = Math.trunc(info.cap[r] * variation); stock[r] = cap[r]; }
    tiles.push({ terrain: t, elev: Math.trunc(elev[i] * K), moist: Math.trunc(moist[i] * K), stock, cap, trodden: 0, road: false, ford: ford[i] === 1, village: -1 });
  }

  const world: World & { names: string[]; nameCursor: number } = {
    seed: o.seed, width, height, tick: 0, tiles, villages: [], parties: [], rolls: [], wind: [],
    commodities: COMMODITIES, recipes: RECIPES, breath: 100_000, nextId: 1, rng: {},
    names: villageNames(Rng.fromSeed(o.seed, 'names'), 200), nameCursor: 0,
  };

  // village sites
  const sites = chooseSites(world, o.villages ?? 4, rng);
  const sim = new Sim(world);
  const cultureRng = Rng.fromSeed(o.seed, 'names');
  for (const site of sites) {
    const people = startingPeople(world, o.startPop ?? 20, rng);
    const culture = [0, 1, 2, 3].map(() => cultureRng.range(250, 750));
    foundVillage(sim.ctx, { tile: site, people, parent: -1, culture, recipes: START_RECIPES, knownTiles: [], food: (o.startPop ?? 20) * (o.startFoodWeeks ?? 8) * 1000, tents: Math.ceil((o.startPop ?? 20) / 5) });
  }
  world.rng = sim.ctx.rng.save();
  return world;
}

function startingPeople(w: World, n: number, rng: Rng): Person[] {
  const people: Person[] = [];
  const adults = Math.round(n * 0.6), children = Math.round(n * 0.3);
  for (let i = 0; i < n; i++) {
    const ageYears = i < adults ? rng.range(15, 50) : i < adults + children ? rng.range(0, 13) : rng.range(61, 70);
    people.push(newPerson(w, -ageYears * 52 - rng.int(52)));
  }
  return people;
}

function siteScore(w: World, i: number): number {
  const t = w.tiles[i]; const info = TERRAIN[t.terrain];
  if (!info.passable || !info.forage || t.terrain === 'mountain') return -1;
  let food = 0, water = false;
  for (const nb of neighbors(w, i, 1, true)) {
    const c = w.tiles[nb].cap; food += c.plants + c.game + c.fish;
    const tt = w.tiles[nb].terrain; if (tt === 'river' || tt === 'lake' || tt === 'coast' || tt === 'ocean' || tt === 'oasis') water = true;
  }
  if (!water) return -1;
  return food;
}

function chooseSites(w: World, count: number, rng: Rng): number[] {
  const cands = [...Array(w.tiles.length).keys()].map(i => ({ i, s: siteScore(w, i) })).filter(c => c.s > 0).sort((a, b) => b.s - a.s);
  const chosen: number[] = [];
  const minD = 12, maxD = 30;
  const top = cands.slice(0, Math.max(40, Math.trunc(cands.length / 4)));
  for (let attempt = 0; attempt < 400 && chosen.length < count; attempt++) {
    const c = top[rng.int(top.length)].i;
    if (chosen.includes(c)) continue;
    const ds = chosen.map(s => tileDistance(w, s, c));
    if (ds.some(d => d < minD)) continue;
    if (chosen.length && !ds.some(d => d <= maxD)) continue;
    chosen.push(c);
  }
  // fallback: relax constraints
  for (const c of cands) { if (chosen.length >= count) break; if (!chosen.includes(c.i) && chosen.every(s => tileDistance(w, s, c.i) >= 6)) chosen.push(c.i); }
  return chosen;
}

export { idx as tileIndex };
export type { Direction, Streams };
