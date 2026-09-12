/** Public types for the Wind Spirit audio engine. */
import type { Event as SimEvent, Season, SeasonRoll, Terrain } from '@wind-spirit/sim';

export type { Season, SeasonRoll, Terrain, SimEvent };

/**
 * Mix buses. The five layers of the concept doc (ambient, village, markers, events, spirit) plus
 * `music` (generated music) and `master`, which everything feeds.
 */
export type Bus = 'master' | 'ambient' | 'village' | 'markers' | 'events' | 'spirit' | 'music';
export const BUSES: readonly Bus[] = ['master', 'ambient', 'village', 'markers', 'events', 'spirit', 'music'];

export type Zoom = 'world' | 'local' | 'village';
export type Speed = 'pause' | 'step' | 'slow' | 'normal' | 'fast' | 'veryfast';

/** What is on screen. Drives the ambient bed, the coalescer's window and the music's pause behaviour. */
export interface Scene {
  season: Season;
  roll: SeasonRoll;
  /** Dominant terrain on screen. Ignored at world zoom. */
  biome: Terrain;
  zoom: Zoom;
  speed: Speed;
}

/** State of the focused village, or null when no village is focused. */
export interface VillageState {
  population: number;
  building: boolean;
  famine: boolean;
  hasInstruments: boolean;
  festival: boolean;
}

export type SpiritKind = 'message' | 'sail' | 'nudge' | 'override' | 'storm' | 'dream-open' | 'dream-close';

export type MusicIntensity = 'drone' | 'melody' | 'tension' | 'lament' | 'festival';
export interface MusicSettings { enabled: boolean; intensity: MusicIntensity }

/** Every distinct one-shot the engine can play. `onEvents` maps sim events onto these; `play` triggers one directly. */
export type SoundName =
  | 'discovery' | 'birth' | 'death' | 'chiefDeath' | 'partyLeft' | 'partyReturned' | 'boat' | 'harvest'
  | 'raid' | 'trade' | 'prayer' | 'villageFounded' | 'villageDied' | 'storm' | 'built' | 'famine' | 'summary';
export const SOUNDS: readonly SoundName[] = [
  'discovery', 'birth', 'death', 'chiefDeath', 'partyLeft', 'partyReturned', 'boat', 'harvest',
  'raid', 'trade', 'prayer', 'villageFounded', 'villageDied', 'storm', 'built', 'famine', 'summary',
];

/** Options for a directly triggered one-shot. */
export interface PlayOptions {
  /** How many coalesced occurrences this sound stands for; fuller mix above 1. */
  count?: number;
  /** False plays it quieter, as an event in an unfocused village. Default true. */
  focused?: boolean;
}

/** The subset of AudioContext the engine uses. A real AudioContext satisfies it; tests pass a fake. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: AudioNode;
  readonly state: 'suspended' | 'running' | 'closed' | 'interrupted';
  createGain(): GainNode;
  createOscillator(): OscillatorNode;
  createBufferSource(): AudioBufferSourceNode;
  createBiquadFilter(): BiquadFilterNode;
  createDelay(maxDelayTime?: number): DelayNode;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
  /** Optional: used for a little stereo spread on one-shots when present. */
  createStereoPanner?(): StereoPannerNode;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

export interface AudioEngineOptions {
  /** Use this context instead of creating one lazily on the first `resume()`. */
  context?: AudioContextLike;
  /** The world seed. Picks the music's mode, tempo, palette and the season motifs. */
  seed: string;
}

/** Snapshot of engine state, for debugging and the demo. */
export interface EngineSnapshot {
  started: boolean;
  contextState: AudioContextLike['state'] | 'none';
  seed: string;
  scene: Scene | null;
  village: VillageState | null;
  music: MusicSettings;
  buses: Record<Bus, { gain: number; muted: boolean; effective: number }>;
  dreaming: boolean;
  /** Number of pending (not yet emitted) coalescer groups and events suppressed at very fast speed. */
  coalescer: { pending: number; suppressed: number };
}

export interface AudioEngine {
  /** Create the context if needed and start audio. Call from a user gesture. Safe to call repeatedly. */
  resume(): Promise<void>;
  /** Pause the whole context; everything resumes where it was on the next `resume()`. */
  suspend(): Promise<void>;
  /** Set a bus fader, 0..1. Remembered across resume/suspend and applied before the graph exists. */
  setBusGain(bus: Bus, gain: number): void;
  mute(bus: Bus, muted: boolean): void;
  /** Crossfade to the ambient bed for this season/roll/biome/zoom over ~2 s; also sets the speed. */
  setScene(scene: Scene): void;
  /** State of the focused village, or null to silence the village bus. */
  setVillage(state: VillageState | null): void;
  /** Call once per sim tick (week). Plays week pulses, season motifs and the new-year tone. */
  tick(tick: number): void;
  /** Feed the events of a worker tick. Coalesced by the current speed. */
  onEvents(events: SimEvent[], focusedVillage: number | null): void;
  /** Trigger a one-shot directly, bypassing the coalescer (demo, or sounds the events lack a flag for, like `boat`). */
  play(sound: SoundName, opts?: PlayOptions): void;
  /** The wind is the player. `pool` is the breath pool 0..1; a nearly empty pool sounds thinner. */
  spirit(kind: SpiritKind, pool: number): void;
  setMusic(settings: MusicSettings): void;
  /** Read-only snapshot for debugging and demos. */
  snapshot(): EngineSnapshot;
  /** Stop everything and close the context if the engine created it. The engine is unusable afterwards. */
  dispose(): void;
}
