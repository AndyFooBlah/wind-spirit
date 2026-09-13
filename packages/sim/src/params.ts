/** Every tunable number in one place. Rates are per week unless noted. Thousandths unless noted. */
import type { Terrain, WildResource, Season, SeasonRoll } from './types.js';

export const WEEKS_PER_YEAR = 52;
export const WEEKS_PER_SEASON = 13;
export const TILE_MILES = 5;
export const PLOT_GRID = 12;


export const P = {
  ageAdultYears: 14, ageElderYears: 60,
  /** Legacy model switches, kept so earlier failure modes can be reproduced (see docs/m0-notes.md). */
  legacy: { starvation: 'rationing' as 'rationing' | 'selective', births: 'hardship' as 'hardship' | 'calmgate', hardWinter: 'partial' as 'partial' | 'all' },
  foodPerPersonWeek: 1000,
  /** Base yields per worker-week at full stock, in food units (thousandths). */
  yield: { forage: 3500, hunt: 3000, fish: 4000, wood: 5000, stone: 3000, regional: 2500 },
  /** Seasonal factors (thousandths) for plants / game / fish yields. */
  seasonPlants: [800, 1200, 1300, 150] as const,
  seasonGame: [1000, 1000, 1100, 800] as const,
  seasonFish: [1000, 1100, 1000, 600] as const,
  /** Regrowth per week (thousandths of logistic rate). Plants only in spring/summer. */
  regrow: { plants: 50, game: 20, fish: 30, timber: 5, stone: 0 } as Record<WildResource, number>,
  /** Research: weekly success chance per worker (thousandths). */
  researchFocused: 120, researchExplore: 25, researchKnown: 400, hintFocused: 120, hintExplore: 150,
  serendipity: 300,             // per week per village, in hundred-thousandths
  roadStone: 5000, roadLabor: 4,
  colonizeMinRemaining: 16,     // settlers never leave fewer than this many behind
  /** Breath: the spirit's pool (thousandths of 100). */
  breathCap: 100_000, breathRegen: 250, breathNudge: 15_000, breathOverride: 50_000, breathStorm: 80_000, breathSail: 10_000,
  /** Trust changes (thousandths). */
  trustFulfilled: 100, trustFailed: -200, trustInherit: 700,
  envoyPatience: 8,             // weeks an envoy waits for the host's answer
  carryPerPerson: 6000,         // units a person carries on foot
  /** Farming. */
  clearLabor: 4000,             // worker-weeks (thousandths) to clear one plot
  plotsPerFarmer: 3,            // plots a farmer can plant or harvest per week
  harvestPerPlot: 50_000,       // food units at fertility 1.0 and normal weather
  fertilityDropPerHarvest: 150,
  fertilityRecoverPerFallowSeason: 50,
  /** Mortality, annual in millionths per year → converted weekly in code. */
  annualDeath: { child: 30_000, adult: 12_000, elder: 60_000, elderPerYear: 15_000 },
  hungerMult: 3,                // mortality multiplier = 1 + hungerMult * (weeks-equivalent of hunger)^2; at 6 weeks ~ 109x
  /** Births: annual per adult in millionths. */
  annualBirthPerAdult: 100_000,
  hardshipRate: 40,             // per-week weight of the current shortfall in the hardship average (~25-week memory)
  birthHardshipZero: 400,       // hardship (thousandths) at which births stop
  /** Shelter. */
  winterExposureMult: 1500,     // extra mortality multiplier at zero shelter, thousandths
  tentShelter: 5, tentQuality: 600,
  /** Happiness. */
  happyCalmWeeks: 13,
  noveltyFull: 20,              // summed novelty of goods enjoyed in the last 26 weeks for a full novelty score           // weeks without hunger for full food-security happiness
  coupBelow: 300, coupWeeks: 26,
  /** Paths. */
  treadParty: 1000, treadCart: 2000, treadForage: 150, pathDecay: 20 /* per mille per week */,
  pathAt: 6000, roadAt: 20_000,
  /** Travel. */
  lostChanceK: 40,              // per week in unknown territory, thousandths
  foragingSpeed: 500, winterForagingSpeed: 250, loadSpeed: 750, winterSpeed: 600,
  /** Weather roll probabilities in thousandths: normal, wet, drought, storm, hard(winter only). */
  rollNormal: 550, rollWet: 150, rollDrought: 120, rollStorm: 80, rollHard: 100,
  /** Spoilage multiplier from a granary (thousandths). */
  famineStoresWeeks: 2,
  lowFoodWeeks: 2,              // stores below this wake the chief every four weeks (4 perturbed the forager stress test: 88% vs 92% survival)
};

export interface TerrainInfo {
  mpdWild: number; mpdPath: number;       // miles per day
  passable: boolean; water: boolean; forage: boolean;
  cap: Record<WildResource, number>;      // food units (thousandths)
}

const cap = (plants: number, game: number, fish: number, timber: number, stone: number) =>
  ({ plants: plants * 1000, game: game * 1000, fish: fish * 1000, timber: timber * 1000, stone: stone * 1000 });

export const TERRAIN: Record<Terrain, TerrainInfo> = {
  grass:    { mpdWild: 20, mpdPath: 25, passable: true,  water: false, forage: true,  cap: cap(500, 300, 0, 60, 100) },
  forest:   { mpdWild: 10, mpdPath: 20, passable: true,  water: false, forage: true,  cap: cap(300, 400, 0, 600, 50) },
  hills:    { mpdWild: 10, mpdPath: 15, passable: true,  water: false, forage: true,  cap: cap(200, 250, 0, 200, 400) },
  mountain: { mpdWild: 5,  mpdPath: 10, passable: true,  water: false, forage: false, cap: cap(20, 50, 0, 50, 800) },
  desert:   { mpdWild: 20, mpdPath: 20, passable: true,  water: false, forage: false, cap: cap(0, 0, 0, 0, 200) },
  oasis:    { mpdWild: 20, mpdPath: 20, passable: true,  water: false, forage: true,  cap: cap(200, 100, 100, 50, 50) },
  marsh:    { mpdWild: 5,  mpdPath: 12, passable: true,  water: false, forage: true,  cap: cap(300, 200, 200, 100, 0) },
  river:    { mpdWild: 15, mpdPath: 20, passable: true,  water: false, forage: true,  cap: cap(400, 300, 400, 200, 100) },
  coast:    { mpdWild: 15, mpdPath: 20, passable: true,  water: false, forage: true,  cap: cap(300, 150, 600, 100, 100) },
  lake:     { mpdWild: 0,  mpdPath: 0,  passable: false, water: true,  forage: false, cap: cap(0, 0, 500, 0, 0) },
  ocean:    { mpdWild: 0,  mpdPath: 0,  passable: false, water: true,  forage: false, cap: cap(0, 0, 550, 0, 0) },   // fished from the shore; 800 let a shore village of 50 live on wild food once every map had an ocean rim
};

/** Optional overrides from the WS_PARAMS environment variable (JSON, shallow-merged into P; nested objects merged one level). */
declare const process: { env?: Record<string, string | undefined> } | undefined;
try {
  const raw = typeof process !== 'undefined' && process?.env ? process.env.WS_PARAMS : undefined;
  if (raw) { const o = JSON.parse(raw) as Record<string, unknown>; for (const [k, v] of Object.entries(o)) { const cur = (P as Record<string, unknown>)[k]; if (cur && typeof cur === 'object' && v && typeof v === 'object' && !Array.isArray(v)) Object.assign(cur as object, v); else (P as Record<string, unknown>)[k] = v; } }
} catch { /* ignore bad overrides */ }
export const AGE_ADULT = () => P.ageAdultYears * 52;
export const AGE_ELDER = () => P.ageElderYears * 52;

export function seasonOf(tick: number): Season { return Math.floor((tick % WEEKS_PER_YEAR) / WEEKS_PER_SEASON) as Season; }
export function seasonIndex(tick: number): number { return Math.floor(tick / WEEKS_PER_SEASON); }
export function yearOf(tick: number): number { return Math.floor(tick / WEEKS_PER_YEAR); }

/** Weather effects. */
export function harvestWeatherFactor(roll: SeasonRoll): number {
  return roll === 'drought' ? 500 : roll === 'wet' ? 1100 : 1000;
}
export function regrowWeatherFactor(roll: SeasonRoll): number {
  return roll === 'drought' ? 500 : roll === 'wet' ? 1150 : 1000;
}
