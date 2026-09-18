/**
 * Messages between the UI (main thread) and the sim worker, plus the compact view models the worker posts.
 * The World never crosses this boundary; only frames, static map data, and per-village detail on request.
 */
import type { Claim, Direction, Event, Input, PartyKind, PlotKind, SeasonRoll, Terrain } from '@wind-spirit/sim';
import type { JournalEntry, Speed, VillageView } from '@wind-spirit/agents';

export type { Speed, JournalEntry };

export const SPEEDS: Speed[] = ['pause', 'step', 'slow', 'normal', 'fast', 'veryfast'];
export const SPEED_MS: Record<Speed, number> = { pause: 0, step: 0, slow: 10_000, normal: 2000, fast: 500, veryfast: 100 };
export const SPEED_LABEL: Record<Speed, string> = { pause: 'Paused', step: 'Step', slow: 'Slow', normal: 'Normal', fast: 'Fast', veryfast: 'Very fast' };

/** Events that pause the game when enabled. */
export const ATTENTION_EVENTS = ['RaidResolved', 'Famine', 'ChiefSucceeded', 'VillageFounded', 'VillageDied', 'VillageAbandoned', 'RefugeesAdmitted', 'Prayer', 'StormStruck', 'Discovered'] as const;
export type AttentionEvent = (typeof ATTENTION_EVENTS)[number];
export type AutoPause = Record<AttentionEvent, boolean>;
export const DEFAULT_AUTOPAUSE: AutoPause = { RaidResolved: true, Famine: true, ChiefSucceeded: true, VillageFounded: true, VillageDied: true, VillageAbandoned: true, RefugeesAdmitted: false, Prayer: true, StormStruck: true, Discovered: false };

export type ModelVillages = 'none' | 'focused' | 'all';
export type TierName = 'habit' | 'thrifty' | 'standard' | 'lavish';
/** `judge`: who answers the decisions that are a label rather than prose (see packages/agents/src/judge). */
export type JudgeChoice = 'jev' | 'model';
export interface Settings { modelVillages: ModelVillages; focused: number[]; autoPause: AutoPause; tier: TierName; judge: JudgeChoice; }
export const DEFAULT_SETTINGS: Settings = { modelVillages: 'focused', focused: [], autoPause: DEFAULT_AUTOPAUSE, tier: 'standard', judge: 'jev' };

/**
 * What gets persisted per tick. Sim inputs replay verbatim. `ChiefMemory` is a side effect the scheduler and the
 * dream apply directly to the World (memory notes, inbox cleared); logging it keeps replay bit-exact.
 */
export type LoggedInput = Input | { type: 'ChiefMemory'; village: number; memory: string[]; inbox: string[] };

export interface GenOpts { width?: number; height?: number; villages?: number; startPop?: number; }

export interface VillageSummary {
  id: number; name: string; tile: number; alive: boolean;
  /** the founding village this one descends from; colonies carry their parent's colour */ lineage: number; parent: number;
  pop: { children: number; adults: number; elders: number; total: number };
  happiness: number; trust: number; foodWeeks: number; hungryWeek: number; capabilities: number;
}
export interface PartySummary {
  id: number; kind: PartyKind; home: number; at: number; boat: boolean; target: number; targetVillage?: number; returning: boolean; size: number; waiting: number;
  /** the home village's lineage, for the glyph's colour */ lineage: number;
  /** tiles still to walk on the current leg */ left: number;
  /** units of goods carried */ cargo: number;
  /** envoys: what they are there to do */ errand?: 'trade' | 'threat' | 'gift';
  /** expeditions: what they are collecting */ gathering?: string;
}
export interface Frame {
  tick: number; year: number; season: number; week: number;
  villages: VillageSummary[]; parties: PartySummary[];
  paths: number[]; roads: number[];
  breath: number;              // 0..100
  rolls: SeasonRoll[]; rollSeasons: number[]; wind: Direction[];   // current season first, then four ahead
  storms: { tile: number; tick: number }[];
}
export interface StaticMap {
  seed: string; width: number; height: number;
  terrain: Terrain[]; ford: boolean[]; extra: string[][];
  names: { commodities: Record<string, string>; recipes: Record<string, string>; capabilities: Record<string, string> };
  /** the whole recipe tree of this world, fixed at generation */
  tech: TechNode[];
}
export interface TechNode { id: string; name: string; tier: number; inputs: { id: string; name: string; qty: number }[]; requires?: string; makes: string; makesId?: string; makesKind: 'commodity' | 'structure' | 'capability' | 'crop'; start: boolean; hints: number; }
export interface PlotView {
  kind: PlotKind; planted: boolean; recipe: string; crop: string; building: boolean;
  /** recipe id (stable across worlds), for the icon */ recipeId: string;
  /** construction progress 0..1 while building */ progress: number;
  /** soil strength 0..1 */ fertility: number;
  /** what a finished structure is for */ structure?: { shelter: number; storage: number; defense?: number; watch?: boolean };
}
/** One villager as the village view shows them: derived from orders each week, never stored (see activities.ts). */
export interface PersonView { id: number; name: string; age: number; stage: 'child' | 'adult' | 'elder'; doing: string; plot?: number; out: boolean; chief: boolean; }
export interface FeedGroup { when: string; tick: number; lines: string[]; }
export interface VillageDetail {
  id: number; tick: number; alive: boolean;
  view: Omit<VillageView, 'names'>;
  plots: PlotView[];
  people: PersonView[];
  /** what this village holds and has heard of, for the tech tree overlay */
  tech: { held: string[]; hints: Record<string, number>; capabilities: string[] };
  chronicle: Claim[];
  feed: FeedGroup[];
  inbox: string[];
  chiefId: number;
}

/** One yearly reading of the whole world, for the overview charts. Recorded by the sim worker at each new year and backfilled from snapshots. */
export interface SeriesVillage { id: number; name: string; alive: boolean; pop: number; food: number; caps: number; tier: number; trust: number; work: Record<WorkGroup, number>; }
export type WorkGroup = 'food' | 'land' | 'craft' | 'research' | 'ventures' | 'rest';
export const WORK_GROUPS: readonly WorkGroup[] = ['food', 'land', 'craft', 'research', 'ventures', 'rest'];
export interface SeriesPoint { tick: number; villages: SeriesVillage[]; }

export interface NarrativeRequest { id: number; village: number; fromTick: number; toTick: number; style: 'chronicle' | 'saga' | 'plain'; events: Event[]; journals: JournalEntry[]; }

export type ToWorker =
  | { type: 'init'; seed: string; opts?: GenOpts }
  | { type: 'narrate'; request: NarrativeRequest }
  | { type: 'load'; snapshot: string; inputsAfter: LoggedInput[][] }
  | { type: 'queue'; input: Input }
  | { type: 'speed'; speed: Speed }
  | { type: 'step' }
  | { type: 'snapshot'; reason?: string }
  | { type: 'requestVillage'; id: number }
  | { type: 'settings'; settings: Settings }
  | { type: 'token'; id: number; token?: string | { idToken?: string; appCheckToken?: string } }
  | { type: 'dreamStart'; village: number }
  | { type: 'dreamSend'; text: string }
  | { type: 'dreamClose' }
  | { type: 'sun'; id: number; question: string; before: { question: string; answer: string; tick: number }[] };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'map'; map: StaticMap }
  | { type: 'loaded'; tick: number; frame: Frame }
  | { type: 'tick'; tick: number; events: Event[]; frame: Frame; inputs: LoggedInput[] }
  | { type: 'snapshot'; tick: number; json: string; reason: string }
  | { type: 'attention'; tick: number; event: Event }
  | { type: 'journal'; entry: JournalEntry }
  | { type: 'village'; detail: VillageDetail }
  | { type: 'speed'; speed: Speed }
  | { type: 'waiting'; villages: number[] }   // the loop is holding for these chiefs' model decisions
  | { type: 'needToken'; id: number }
  | { type: 'dreamChunk'; text: string }
  | { type: 'dreamReply'; text: string }
  | { type: 'dreamClosed'; claims: { text: string; due: number }[]; memoryNotes: string[] }
  | { type: 'narrative'; id: number; text?: string; error?: string }
  | { type: 'series'; point: SeriesPoint }
  | { type: 'sunChunk'; id: number; text: string }
  | { type: 'sunReply'; id: number; text?: string; error?: string }
  | { type: 'error'; message: string; village?: number };

/** History worker: replay to a tick from the nearest earlier snapshot and render views from the replayed world. */
export type ToHistory =
  | { type: 'seek'; seq: number; snapshot: string; snapshotTick: number; inputs: Record<number, LoggedInput[]>; targetTick: number; village?: number; villageEvents: Event[] }
  | { type: 'series'; seq: number; snapshot: string };
export type FromHistory = { type: 'frame'; seq: number; tick: number; frame: Frame; detail?: VillageDetail } | { type: 'series'; seq: number; point: SeriesPoint } | { type: 'error'; seq: number; message: string };

export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const DIR_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const ROLL_WORDS: Record<SeasonRoll, string> = { drought: 'Drought', normal: 'Fair', wet: 'Wet', hard: 'Hard winter', storm: 'Storms' };
