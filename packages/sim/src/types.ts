/** Sim state and event types. Everything is plain JSON-serializable data; quantities are integers in thousandths. */

export type Terrain = 'grass' | 'forest' | 'hills' | 'mountain' | 'desert' | 'oasis' | 'marsh' | 'river' | 'lake' | 'coast' | 'ocean';
export type Season = 0 | 1 | 2 | 3; // spring, summer, autumn, winter
export type SeasonRoll = 'drought' | 'normal' | 'wet' | 'hard' | 'storm';
export type Direction = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; // N, NE, E, SE, S, SW, W, NW

export type WildResource = 'plants' | 'game' | 'fish' | 'timber' | 'stone';
export const WILD: readonly WildResource[] = ['plants', 'game', 'fish', 'timber', 'stone'];

export interface Tile {
  terrain: Terrain;
  elev: number;   // thousandths
  moist: number;  // thousandths
  stock: Record<WildResource, number>;
  cap: Record<WildResource, number>;
  trodden: number; // thousandths; path at >= PATH_AT
  road: boolean;
  ford: boolean;
  village: number; // village id or -1
}

export type Stage = 'child' | 'adult' | 'elder';

export interface Person { id: number; born: number; hungry: number; /* accumulated hunger, thousandths of weeks */ }

export type PlotKind = 'wild' | 'clear' | 'field' | 'structure';
export interface Plot {
  kind: PlotKind;
  fertility: number;  // thousandths
  planted: boolean;
  progress: number;   // thousandths of worker-weeks toward clearing or building
  recipe: string;     // structure recipe id when kind === 'structure' or while building
}

export interface Stack { c: string; qty: number; age: number; }

export type Task = 'forage' | 'hunt' | 'fish' | 'gather' | 'clear' | 'farm' | 'build' | 'explore' | 'colonize' | 'rest';

export interface Order {
  task: Task;
  workers: number;
  /** gather: commodity ('wood'|'stone'); build: recipe id; explore: {dx,dy,dist}; colonize: {tile, share}. */
  params: Record<string, number | string>;
  since: number;
}

export interface Knowledge {
  tiles: number[];      // sorted tile ids seen
  villages: number[];   // village ids known
}

export interface Relation { grudge: number; lastContact: number; }

export interface Village {
  id: number; name: string; tile: number; founded: number; alive: boolean; parent: number;
  people: Person[]; chief: number;
  culture: number[]; chiefTraits: number[]; // 4 axes, thousandths
  stores: Stack[]; plots: Plot[]; recipes: string[];
  orders: Order[];
  happiness: number; lowHappyWeeks: number; trust: number;
  knowledge: Knowledge;
  /** rolling counters for the harness and for happiness */
  recentDeaths: number[];   // deaths per week, last 13
  hungryWeek: number;       // people-weeks hungry this week
  calmWeeks: number;        // weeks since anyone went hungry, capped
  hardship: number;         // moving average of the weekly food shortfall fraction, thousandths
  year: YearStats;
}

export interface YearStats {
  births: number; deathsAge: number; deathsHunger: number; deathsTravel: number;
  forage: number; hunt: number; fish: number; farm: number; wood: number; stone: number;
  spoiled: number;
}

export type PartyKind = 'explore' | 'colonize' | 'refugee';
export interface Party {
  id: number; home: number; kind: PartyKind;
  members: Person[]; rations: number; cargo: Stack[];
  mode: 'provisioned' | 'foraging';
  route: number[]; at: number; dayCarry: number; target: number; returning: boolean;
  seen: number[];
  lostWeeks: number;
}

export interface Commodity { id: string; name: string; category: string; food: number; perish: number; weight: number; }
export interface Recipe {
  id: string; name: string; tier: number;
  inputs: { c: string; qty: number }[];
  labor: number;              // worker-weeks
  structure?: { shelter: number; quality: number; storage: number; }; // shelter capacity (people), quality thousandths, storage multiplier thousandths
}

export interface World {
  seed: string; width: number; height: number; tick: number;
  tiles: Tile[];
  villages: Village[];
  parties: Party[];
  rolls: SeasonRoll[];  // indexed by absolute season
  wind: Direction[];
  commodities: Commodity[];
  recipes: Recipe[];
  breath: number;
  nextId: number;
  rng: Record<string, [number, number, number, number]>;
}

// ---------- events ----------

export type Event =
  | { t: number; type: 'WeatherRolled'; season: number; roll: SeasonRoll; wind: Direction }
  | { t: number; type: 'Harvested'; village: number; qty: number; plots: number }
  | { t: number; type: 'Born'; village: number; person: number }
  | { t: number; type: 'Died'; village: number; person: number; cause: 'age' | 'hunger' | 'travel'; stage: Stage }
  | { t: number; type: 'ChiefSucceeded'; village: number; chief: number; reason: 'death' | 'coup' }
  | { t: number; type: 'Built'; village: number; recipe: string }
  | { t: number; type: 'Cleared'; village: number; plots: number }
  | { t: number; type: 'PartyLeft'; village: number; party: number; kind: PartyKind; size: number }
  | { t: number; type: 'PartyReturned'; village: number; party: number; tilesSeen: number }
  | { t: number; type: 'PartyLost'; village: number; party: number; cause: 'starved' }
  | { t: number; type: 'VillageFounded'; village: number; parent: number; tile: number; size: number }
  | { t: number; type: 'VillageDied'; village: number }
  | { t: number; type: 'Famine'; village: number; hungry: number }
  | { t: number; type: 'PathFormed'; tile: number }
  | { t: number; type: 'DeliberationRequested'; village: number; reason: string }
  | { t: number; type: 'ChiefDecided'; village: number; orders: Order[]; requestedAt: number }
  | { t: number; type: 'WeekSummary'; births: number; deaths: number; pop: number; villages: number };

export type Input = { type: 'ChiefDecided'; village: number; orders: Order[]; requestedAt: number };
