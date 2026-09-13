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
  extra: Record<string, { stock: number; cap: number }>;   // regional raw commodities on this tile
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
  crop: string;       // commodity planted, '' if none
}

export interface Stack { c: string; qty: number; age: number; }

export type Task = 'forage' | 'hunt' | 'fish' | 'gather' | 'clear' | 'farm' | 'build' | 'craft' | 'research' | 'road' | 'explore' | 'colonize' | 'envoy' | 'raid' | 'expedition' | 'rest' | 'abandon';

export interface Order {
  task: Task;
  workers: number;
  /** gather: {c}; build: {recipe}; craft: {recipe, qty}; research: {ingredients: 'a,b' commodity ids and/or capability names}; farm: {plots, crop}; road: {tile}; explore: {dx,dy,dist}; colonize: {tile, share}. */
  params: Record<string, number | string>;
  since: number;
}

export interface Knowledge {
  tiles: number[];      // sorted tile ids seen
  villages: number[];   // village ids known
}

/** A claim the spirit made. Weather claims are checked by the sim; others the chief judges when due. */
export interface Claim {
  id: number; tick: number; text: string; due: number;
  check: { kind: 'weather'; season: number; roll: SeasonRoll } | { kind: 'judged' } | { kind: 'none' };
  outcome: 'pending' | 'fulfilled' | 'failed' | 'unverifiable';
}
export type BreathAction =
  | { kind: 'nudge'; season: number; direction: 'wetter' | 'drier' | 'milder' | 'harsher' }
  | { kind: 'override'; season: number; roll: SeasonRoll }
  | { kind: 'storm'; tile: number }
  | { kind: 'sail'; party: number; mode: 'fill' | 'becalm' };
export interface Relation { grudge: number; lastContact: number; trades: number; raids: number; sizeSeen: number; /** parent and colony: welcomed, never raided */ kin?: boolean; }

export interface Village {
  id: number; name: string; tile: number; founded: number; alive: boolean; parent: number;
  people: Person[]; chief: number;
  culture: number[]; chiefTraits: number[]; // 4 axes, thousandths
  stores: Stack[]; plots: Plot[]; recipes: string[];
  capabilities: Capability[];
  known: string[];                  // commodity ids this village has seen
  tasted: Record<string, number>;   // commodity id -> last tick consumed or enjoyed
  craft: Record<string, number>;    // recipe id -> accumulated worker-weeks (thousandths)
  hints: Record<string, number>;    // recipe id -> hints revealed so far
  relations: Record<number, Relation>;   // other village id -> memory of them
  memory: string[];                 // the chief's own notes, bounded
  inbox: string[];                  // spirit messages not yet considered
  chronicle: Claim[];               // what the spirit said, and what came of it
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
  births: number; deathsAge: number; deathsHunger: number; deathsTravel: number; deathsRaid: number;
  forage: number; hunt: number; fish: number; farm: number; wood: number; stone: number; gathered: number; crafted: number;
  spoiled: number;
}

export type PartyKind = 'explore' | 'colonize' | 'refugee' | 'envoy' | 'raid' | 'expedition';

/** What an envoy carries besides goods: what to offer, what to ask for, the floor it will accept, an optional recipe to share, an optional threat. */
export interface Mandate { offer: Record<string, number>; want: Record<string, number>; floor: number; transfer?: string; threat?: boolean; message?: string; /** refugees asking to be taken in: how many they are */ refuge?: number; }
/** The host chief's answer to a visiting envoy. */
export type HostAnswer = { kind: 'accept' } | { kind: 'refuse'; reason?: string } | { kind: 'counter'; give: Record<string, number>; take: Record<string, number> };
export interface Party {
  id: number; home: number; kind: PartyKind;
  members: Person[]; rations: number; cargo: Stack[];
  mode: 'provisioned' | 'foraging';
  boat: boolean; cart: boolean; sail: boolean;
  route: number[]; at: number; dayCarry: number; target: number; returning: boolean;
  seen: number[];
  lostWeeks: number;
  mandate?: Mandate; waiting: number; result?: string; targetVillage?: number;
  sailBoost?: 'fill' | 'becalm';
  gather?: { c: string; weeks: number };   // expedition: what to collect and for how long
  /** refugees: villages that turned them away */
  refused?: number[];
}

export type Category = 'grain' | 'fruit' | 'root' | 'meat' | 'fish' | 'hide' | 'wood' | 'stone' | 'fiber' | 'herb' | 'clay' | 'salt' | 'ore' | 'food' | 'drink' | 'cloth' | 'instrument' | 'metal' | 'fuel' | 'curio';
export type Capability = 'fire' | 'stonetools' | 'spear' | 'net' | 'paddle' | 'drying' | 'pottery' | 'weaving' | 'cart' | 'hull' | 'bow' | 'medicine' | 'irrigation' | 'husbandry' | 'sail' | 'roadbuilding' | 'kiln' | 'metaltools' | 'hook' | 'wagon' | 'seagoing' | 'bronzeweapons' | 'plough';
export const CAPABILITIES: readonly Capability[] = ['fire', 'stonetools', 'spear', 'net', 'paddle', 'drying', 'pottery', 'weaving', 'cart', 'hull', 'bow', 'medicine', 'irrigation', 'husbandry', 'sail', 'roadbuilding', 'kiln', 'metaltools', 'hook', 'wagon', 'seagoing', 'bronzeweapons', 'plough'];

export interface Commodity {
  id: string; name: string; category: Category;
  food: number;        // food value per unit, thousandths of a person-week
  novelty: number;     // 0..10, how much variety it adds
  perish: number;      // weeks before it spoils, 0 = never
  weight: number;
  source?: WildResource;                              // ubiquitous raw, drawn from tile stocks
  regional?: { terrains: Terrain[]; cap: number };    // regional raw, placed in blobs
  crop?: { yield: number };                           // plantable; harvest per plot at full fertility
}

export interface RecipeOutput { commodity?: { c: string; qty: number }; structure?: { shelter: number; quality: number; storage: number; defense?: number; watch?: boolean }; capability?: Capability; crop?: string; }
export interface Recipe {
  id: string; name: string; tier: number;
  inputs: { c: string; qty: number }[];
  requires?: Capability;
  labor: number;              // worker-weeks
  output: RecipeOutput;
  hints: string[];
  curiosity: boolean;
  start?: boolean;            // known by every village at the start
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
  breath: number;               // the spirit's pool, thousandths
  storms: { tile: number; tick: number }[];
  nextId: number;
  rng: Record<string, [number, number, number, number]>;
}

// ---------- events ----------

export type Event =
  | { t: number; type: 'WeatherRolled'; season: number; roll: SeasonRoll; wind: Direction }
  | { t: number; type: 'Harvested'; village: number; qty: number; plots: number }
  | { t: number; type: 'Born'; village: number; person: number }
  | { t: number; type: 'Died'; village: number; person: number; cause: 'age' | 'hunger' | 'travel' | 'raid'; stage: Stage }
  | { t: number; type: 'ChiefSucceeded'; village: number; chief: number; reason: 'death' | 'coup' }
  | { t: number; type: 'Built'; village: number; recipe: string }
  | { t: number; type: 'Discovered'; village: number; recipe: string; how: 'research' | 'accident' | 'transfer' }
  | { t: number; type: 'HintRevealed'; village: number; recipe: string; hint: string }
  | { t: number; type: 'Crafted'; village: number; recipe: string; qty: number }
  | { t: number; type: 'CapabilityGained'; village: number; capability: Capability }
  | { t: number; type: 'RoadBuilt'; village: number; tile: number }
  | { t: number; type: 'VisitorArrived'; village: number; party: number; from: number; mandate: Mandate }
  | { t: number; type: 'TradeCompleted'; village: number; guest: number; gave: Record<string, number>; got: Record<string, number> }
  | { t: number; type: 'TradeRefused'; village: number; guest: number; reason: string }
  | { t: number; type: 'TechTransferred'; village: number; from: number; recipe: string }
  | { t: number; type: 'TributePaid'; village: number; to: number; goods: Record<string, number> }
  | { t: number; type: 'RaidResolved'; attacker: number; defender: number; success: boolean; attackersLost: number; defendersLost: number; taken: Record<string, number>; destroyed: boolean }
  | { t: number; type: 'HostDecided'; village: number; party: number; answer: HostAnswer; requestedAt: number }
  | { t: number; type: 'SpiritSpoke'; village: number; text: string }
  | { t: number; type: 'SpiritBreathed'; action: BreathAction; cost: number; natural?: SeasonRoll; adjusted?: SeasonRoll }
  | { t: number; type: 'StormStruck'; tile: number; parties: number; drowned: number }
  | { t: number; type: 'ClaimRecorded'; village: number; claim: Claim }
  | { t: number; type: 'ClaimResolved'; village: number; claim: number; outcome: 'fulfilled' | 'failed' | 'unverifiable'; trustBefore: number; trustAfter: number }
  | { t: number; type: 'Prayer'; village: number; text: string }
  | { t: number; type: 'Cleared'; village: number; plots: number }
  | { t: number; type: 'PartyLeft'; village: number; party: number; kind: PartyKind; size: number }
  | { t: number; type: 'PartyReturned'; village: number; party: number; tilesSeen: number }
  | { t: number; type: 'PartyLost'; village: number; party: number; cause: 'starved' }
  | { t: number; type: 'VillageFounded'; village: number; parent: number; tile: number; size: number }
  | { t: number; type: 'VillageDied'; village: number }
  | { t: number; type: 'VillageAbandoned'; village: number; to: number; size: number }
  | { t: number; type: 'RefugeesAdmitted'; village: number; from: number; size: number }
  | { t: number; type: 'RefugeesTurnedAway'; village: number; from: number; size: number }
  | { t: number; type: 'Famine'; village: number; hungry: number }
  | { t: number; type: 'PathFormed'; tile: number }
  | { t: number; type: 'DeliberationRequested'; village: number; reason: string }
  | { t: number; type: 'ChiefDecided'; village: number; orders: Order[]; requestedAt: number; memoryNotes?: string[] }
  | { t: number; type: 'WeekSummary'; births: number; deaths: number; pop: number; villages: number };

export type Input =
  | { type: 'ChiefDecided'; village: number; orders: Order[]; requestedAt: number; memoryNotes?: string[]; clearInbox?: boolean }
  | { type: 'HostDecided'; village: number; party: number; answer: HostAnswer; requestedAt: number }
  | { type: 'SpiritSpoke'; village: number; text: string }
  | { type: 'SpiritBreathed'; action: BreathAction }
  | { type: 'ClaimsMade'; village: number; claims: { text: string; due: number; check: Claim['check'] }[] }
  | { type: 'ChiefJudged'; village: number; verdicts: { claim: number; verdict: 'fulfilled' | 'failed' | 'unverifiable' }[] }
  | { type: 'Prayer'; village: number; text: string };
