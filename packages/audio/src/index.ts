/**
 * @wind-spirit/audio — synthesized audio for Wind Spirit on the Web Audio API.
 *
 * Nothing here touches `window` or `AudioContext` at import time; create an engine with
 * `createAudioEngine` and call `resume()` from a user gesture.
 */
export { createAudioEngine } from './engine.js';
export type {
  AudioEngine, AudioEngineOptions, AudioContextLike, Bus, EngineSnapshot, MusicIntensity, MusicSettings,
  PlayOptions, Scene, SoundName, Speed, SpiritKind, VillageState, Zoom,
} from './types.js';
export { BUSES, SOUNDS } from './types.js';

// Pure logic, exported for tests, tooling and the demo.
export { Coalescer, cueFor, MAJOR, DEFAULT_WINDOWS, type Cue } from './events.js';
export {
  deriveMusic, deriveMotifs, degreeToMidi, inScale, MelodyGenerator, SCALES, TENSION_SCALE, TEMPO_FACTOR,
  type Bar, type Motif, type MusicSpec, type Note, type Palette, type Scale, type Voice,
} from './music.js';
export { markerFor, PULSE_SPEEDS, type Marker } from './markers.js';
export { ambientRecipe, LAYER_IDS, type LayerId, type Recipe } from './ambient.js';
export { hubbubLevel, ZOOM_SCALE } from './village.js';
