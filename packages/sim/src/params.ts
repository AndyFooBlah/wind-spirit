/** Every tunable number in one place. Rates are per week unless noted. Thousandths unless noted. */
import type { Terrain, WildResource, Season, SeasonRoll } from './types.js';

export const WEEKS_PER_YEAR = 52;
export const WEEKS_PER_SEASON = 13;
export const TILE_MILES = 5;
export const PLOT_GRID = 12;

export const AGE_ADULT = 14 * 52;
export const AGE_ELDER = 60 * 52;

export const P = {
  foodPerPersonWeek: 1000,
  /** Base yields per worker-week at full stock, in food units (thousandths). */
  yield: { forage: 3500, hunt: 3000, fish: 4000, wood: 5000, stone: 3000 },
  /** Seasonal factors (thousandths) for plants / game / fish yields. */
  seasonPlants: [800, 1200, 1300, 150] as const,
  seasonGame: [1000, 1000, 1100, 800] as const,
  seasonFish: [1000, 1100, 1000, 600] as const,
  /** Regrowth per week (thousandths of logistic rate). Plants only in spring/summer. */
  regrow: { plants: 50, game: 20, fish: 30, timber: 5, stone: 0 } as Record<WildResource, number>,
  /** Farming. */
  clearLabor: 4000,             // worker-weeks (thousandths) to clear one plot
  plotsPerFarmer: 3,            // plots a farmer can plant or harvest per week
  harvestPerPlot: 50_000,       // food units at fertility 1.0 and normal weather
  fertilityDropPerHarvest: 150,
  fertilityRecoverPerFallowSeason: 50,
  /** Mortality, annual in millionths per year → converted weekly in code. */
  annualDeath: { child: 30_000, adult: 12_000, elder: 60_000, elderPerYear: 15_000 },
  hungerCubic: true,
  /** Births: annual per adult in millionths. */
  annualBirthPerAdult: 100_000,
  hardshipRate: 40,             // per-week weight of the current shortfall in the hardship average (~25-week memory)
  birthHardshipZero: 400,       // hardship (thousandths) at which births stop
  /** Shelter. */
  winterExposureMult: 1500,     // extra mortality multiplier at zero shelter, thousandths
  tentShelter: 5, tentQuality: 600,
  /** Happiness. */
  happyCalmWeeks: 13,           // weeks without hunger for full food-security happiness
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
  ocean:    { mpdWild: 0,  mpdPath: 0,  passable: false, water: true,  forage: false, cap: cap(0, 0, 800, 0, 0) },
};

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
