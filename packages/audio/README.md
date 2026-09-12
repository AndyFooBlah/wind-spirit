# @wind-spirit/audio

Synthesized audio for Wind Spirit on the Web Audio API. No recorded assets, no audio libraries:
every sound is built from oscillators, filtered noise and envelopes, and the music is generated from
the world seed so every world sounds like itself. Spec: `docs/concept.md` §13.

- Seven buses the player can balance or mute: `master`, `ambient`, `village`, `markers`, `events`, `spirit`, `music`.
- Ambient beds by season × roll × biome × zoom, crossfaded over ~2 s. At world zoom only wind and music remain.
- Village sound from the focused village's state: hubbub by population, hammering while building, quiet in famine, instruments once discovered, busier at festivals.
- Time markers: a soft pulse each week at step/slow speed, a distinct motif per season change (four, in the seed's scale), a deeper tone at the new year.
- Event one-shots with speed-dependent coalescing (see below).
- The spirit's wind: a gust for a message; breeze, swell, long rising wind and thunder for the breath actions; thinner when the pool is nearly empty; the dream drops into a night ambience with a fire crackling.
- Generative music: the seed picks a scale, root, tempo and palette; a drone always, a sparse melody, a pulse with minor colour under tension, slow and low for a lament, drum-led for a festival. Deterministic per seed, varying over time.

Nothing touches `window` or `AudioContext` at import time. The package is pure ESM TypeScript with `sideEffects: false`.

## API

```ts
import { createAudioEngine } from '@wind-spirit/audio';

const engine = createAudioEngine({ seed: world.seed });   // or { seed, context } to supply an AudioContext
```

| Method | What it does |
|---|---|
| `resume(): Promise<void>` | Creates the `AudioContext` on first call (browsers require a user gesture) and starts audio. Safe to call repeatedly. |
| `suspend(): Promise<void>` | Pauses the context; everything resumes where it was. |
| `setBusGain(bus, gain0to1)` / `mute(bus, boolean)` | Faders and mutes. Remembered before `resume()`. |
| `setScene({ season, roll, biome, zoom, speed })` | Crossfades the ambient bed (~2 s), sets the coalescer's speed, and drops music to a drone while paused. `biome` is the dominant terrain on screen. |
| `setVillage(state \| null)` | `{ population, building, famine, hasInstruments, festival }` for the focused village; `null` silences the village bus. |
| `tick(tick)` | Call once per sim tick. Plays the week pulse (step/slow only), season motifs (every 13 ticks, at every speed) and the new-year tone (every 52). Also releases coalesced event groups whose window has elapsed. |
| `onEvents(events, focusedVillage)` | Feed a worker tick's `Event[]`. Sounds are chosen and coalesced by the current speed. Events from other villages play quieter; major sounds always play at full level. |
| `play(sound, { count?, focused? })` | Trigger a one-shot directly, bypassing the coalescer. Use it for `boat` (the `PartyLeft` event has no boat flag) and for demos. |
| `spirit(kind, pool0to1)` | `'message' \| 'sail' \| 'nudge' \| 'override' \| 'storm' \| 'dream-open' \| 'dream-close'`. |
| `setMusic({ enabled, intensity })` | `intensity: 'drone' \| 'melody' \| 'tension' \| 'lament' \| 'festival'`. |
| `snapshot()` | Read-only state for debugging: started, context state, buses, scene, village, music, dreaming, coalescer counts. |
| `dispose()` | Stops everything and closes the context if the engine created it. |
| `spec` | The derived `MusicSpec` (scale, root, tempo, palette), available before `resume()`. |

### Sounds and events

| Sound | From event | Major |
|---|---|---|
| `discovery` | `Discovered` | yes |
| `birth` | `Born` | |
| `death` | `Died` | |
| `chiefDeath` | `ChiefSucceeded` with `reason: 'death'` | yes |
| `partyLeft` / `partyReturned` | `PartyLeft` / `PartyReturned` | |
| `boat` | none, use `play('boat')` when the leaving party has a boat | |
| `harvest` | `Harvested` | |
| `raid` | `RaidResolved` | yes |
| `trade` | `TradeCompleted` | |
| `prayer` | `Prayer` | yes |
| `villageFounded` / `villageDied` | `VillageFounded` / `VillageDied` | yes |
| `storm` | `StormStruck` | yes |
| `built` | `Built` | |
| `famine` | `Famine` | |
| `summary` | emitted by the coalescer when speed drops from very fast | |

`SpiritSpoke` / `SpiritBreathed` events are ignored by `onEvents`: they are the player's own actions, sounded through `spirit()`.
Every other event type is silent; its information is visual.

### Speed and coalescing

| Speed | Events | Week pulse | Season motifs |
|---|---|---|---|
| pause, step, slow, normal | every event; identical sounds in the same tick merge into one cue with a count | step, slow only | yes |
| fast | major sounds only, coalesced over a 6-tick window | no | yes |
| veryfast | nothing; events are counted and released as one `summary` sound when the speed drops | no | yes |

Pause also thins the music to its drone. The coalescer (`Coalescer` in `src/events.ts`) is pure and exported for tests.
Identical one-shots closer than 120 ms are merged rather than stacked, and every one-shot carries a small deterministic variation, so no sound repeats identically within a short window.

## Integration recipe for apps/web

```ts
import { createAudioEngine, type AudioEngine } from '@wind-spirit/audio';

const audio: AudioEngine = createAudioEngine({ seed: world.seed });

// 1. Start on the first user gesture (click/keydown). Browsers refuse to start audio otherwise.
window.addEventListener('pointerdown', () => { void audio.resume(); }, { once: true });

// 2. Whenever the camera, season or speed changes (cheap to call often; only speed changes have side effects):
audio.setScene({
  season: seasonOf(world.tick),
  roll: currentRoll(world),
  biome: dominantTerrainOnScreen(),      // your map's most common visible tile terrain
  zoom: cameraZoomBand(),                // 'world' | 'local' | 'village'
  speed: uiSpeed,                        // 'pause' | 'step' | 'slow' | 'normal' | 'fast' | 'veryfast'
});

// 3. Per worker tick, in this order:
audio.tick(world.tick);
audio.onEvents(events, focusedVillageId);   // the tick's Event[]
audio.setVillage(focused ? {
  population: focused.people.length,
  building: focused.orders.some((o) => o.task === 'build'),
  famine: focused.hungryWeek > 0,
  hasInstruments: focused.stores.some((s) => commodityById(s.c).category === 'instrument'),
  festival: false,                          // when the sim gains festivals
} : null);

// 4. The spirit's actions:
onWhisper(() => audio.spirit('message', world.breath / 1000));
onBreath((a) => audio.spirit(a.kind, world.breath / 1000));   // 'sail' | 'nudge' | 'override' | 'storm'
onDreamOpen(() => audio.spirit('dream-open', 1));
onDreamClose(() => audio.spirit('dream-close', 1));

// 5. Music follows the story:
audio.setMusic({ enabled: settings.music, intensity: raidUnderway ? 'tension' : chiefJustDied ? 'lament' : 'melody' });

// 6. Settings UI: audio.setBusGain('ambient', 0.6); audio.mute('music', true); ...
// 7. On unmount: audio.dispose();
```

Mute and fader state can be set before `resume()`; the engine applies it when the graph is built.

## Development

```sh
pnpm --filter @wind-spirit/audio test        # vitest: coalescer, music generator, engine smoke test with a fake AudioContext
pnpm --filter @wind-spirit/audio typecheck   # tsc over src, test and demo
pnpm --filter @wind-spirit/audio demo        # Vite audition page on http://localhost:5183
```

The demo has buttons for every one-shot, every spirit action, each season/roll/biome/zoom/speed, the music intensities,
village state and per-bus faders. It exposes `window.__engine` and `window.__ctx` for inspection.

Layout: `src/engine.ts` (buses, lifecycle, scene), `src/synth.ts` (noise, plucks, voices, envelopes), `src/ambient.ts`
(season × biome recipes and the crossfading mixer), `src/village.ts`, `src/events.ts` (the coalescer, pure),
`src/music.ts` (seed → scale/tempo/palette and the bar generator, pure), `src/musicPlayer.ts` (scheduling),
`src/markers.ts` (week/season/year), `src/spirit.ts`, `src/sfx.ts` (the one-shots).
