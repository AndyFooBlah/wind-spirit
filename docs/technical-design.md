# Wind Spirit — Technical Design

*Status: M0 built. Companion to concept.md and m0-notes.md.*
*Last updated: 2026-09-12*

## 1. Goals and constraints

From the concept: a deterministic, event-sourced weekly simulation; LLM chiefs that never block the sim; full history and replay; three zoom levels; generated worlds, tech, names, and music; a scarce breath budget; a headless balance harness before any UI. Constraints that shape the architecture:

- **Determinism.** Same seed plus same event log yields the same world, bit for bit. LLM outputs and player actions are recorded as events, so replay never calls a model.
- **The sim is pure.** No I/O, no clocks, no network. It runs in a Web Worker in the browser today and can move to a server for multiplayer without change.
- **Secrets never reach the client.** All model calls go through a server-side proxy that holds the key. (See the global rule on secrets.)
- **Cost is budgeted per game-year, not per tick.** The sim must degrade gracefully when the model is slow, rate-limited, or over budget.
- **Balance is measured, not argued.** Every rate in the concept is a parameter the harness can sweep.

## 2. Architecture

A TypeScript monorepo (pnpm workspaces).

| Package | Runs in | Role |
|---|---|---|
| `packages/sim` | worker, node | Pure simulation: state, tick, events, replay. No dependencies. |
| `packages/gen` | worker, node | Generators: world, resources, tech tree, names, hints. Seeded. |
| `packages/agents` | main thread, node | Chief prompt construction, output parsing, scheduler, scripted fallback policies. |
| `packages/harness` | node | Balance harness CLI: runs sim with scripted chiefs, emits CSV and an HTML report. |
| `apps/web` | browser | React + Vite UI. Canvas map, panels, scrubber, audio. Hosts the sim in a Worker. |
| `services/llm-proxy` | Cloud Run | Holds the model key. Auth, quotas, model routing, request logging. |

Data flow in the browser:

```
UI (React) ── commands ──▶ Sim Worker ── events ──▶ UI, Audio, Store (IndexedDB)
     │                          ▲
     └── chief scheduler ── decisions (events) ─┘
              │
              └── fetch ──▶ llm-proxy (Cloud Run) ──▶ Gemini
```

The scheduler lives on the main thread because it does network I/O. It receives "deliberation requested" events from the worker, builds prompts, calls the proxy, and posts the parsed decision back as a command. The worker applies it as an event at the start of the next tick.

**Why not run the sim on a server from day one?** The concept says the world pauses when closed and v1 is single-player. A client-side sim costs nothing to host, has no latency, and keeps saves local. Because the sim is pure, the phase-2 move to an authoritative server is a hosting change, not a rewrite. This mirrors the TileShips pattern.

## 3. Determinism and event sourcing

- **PRNG.** A small seeded generator (xoshiro128\*\*) with *named streams*: `weather`, `worldgen`, `techgen`, `mortality`, `research`, `combat`, `travel`, `names`. Each stream is seeded from the world seed plus its name. Streams keep subsystems independent, so a change in one system's random draws doesn't shift every other system, and so asynchronous chief timing can never alter the RNG sequence.
- **Events.** An append-only log. Every state change is an event; state is a fold over events. Two kinds:
  - *Inputs* come from outside the sim: `ChiefDecided`, `SpiritSpoke`, `SpiritBreathed`, `SpeedChanged` (for the audio log only), `ConversationTurn`.
  - *Outcomes* are produced by the tick: `Harvested`, `Died`, `Born`, `Discovered`, `PartyArrived`, `RaidResolved`, `WeatherRolled`, and so on.
- **Replay.** `replay(seed, events[0..n])` reproduces state at any tick. Inputs are applied verbatim; outcomes are re-derived and asserted equal to the log (a mismatch is a bug, surfaced in tests).
- **Snapshots.** Full state serialized every 52 ticks. Seeking to week *t* loads the nearest earlier snapshot and replays forward, at most 51 ticks.
- **Hashing.** Each snapshot carries a content hash. The harness and tests assert hash equality across runs.

## 4. Data model

Sketches, not final code. Ids are short strings; all quantities are integers or fixed-point to keep hashes stable across platforms.

```ts
type Tick = number;                       // weeks since world start
type TileId = number;                     // y * width + x

interface World {
  seed: string; width: number; height: number; tick: Tick;
  tiles: Tile[]; villages: Map<VillageId, Village>; parties: Map<PartyId, Party>;
  weather: SeasonRoll[4]; wind: Direction[4];   // four seasons ahead
  tech: TechTree; names: NameBook;
  breath: { pool: number };                     // spirit
}

interface Tile {
  terrain: 'grass'|'forest'|'hills'|'mountain'|'desert'|'marsh'|'river'|'lake'|'coast'|'ocean'|'oasis';
  elevation: number; moisture: number;
  stocks: Record<CommodityId, { stock: number; cap: number }>;   // wild resources
  trodden: number; road: boolean; ford: boolean; bridge: boolean;
  village?: VillageId;
}

interface Village {
  id: VillageId; name: string; tile: TileId; founded: Tick;
  people: Person[]; chief: PersonId;
  culture: Traits; chiefTraits: Traits;             // 4 axes each, 0..1
  stores: Record<CommodityId, Stack[]>;             // stacks carry age for spoilage
  plots: Plot[];                                    // local grid, e.g. 12x12
  recipes: Set<RecipeId>; hints: Map<RecipeId, number>;   // hints revealed count
  knowledge: Knowledge;                              // what this village knows of the world
  orders: StandingOrder[];                           // current assignments
  happiness: number; trust: number;
  chronicle: ChronicleEntry[];                       // spirit claims and outcomes
  memory: string[];                                  // chief's own notes, bounded
  relations: Map<VillageId, Relation>;               // grudges, alliances, last contact
  history: EventRef[];                               // indices into the log
}

interface Person { id: PersonId; born: Tick; health: number; }   // stage derives from age

interface Plot { kind: 'clear'|'field'|'structure'; recipe?: RecipeId; fertility: number;
                 progress: number; crop?: CommodityId; }

interface StandingOrder { task: Task; workers: number; params: Record<string, unknown>; since: Tick; }
type Task = 'forage'|'hunt'|'fish'|'farm'|'build'|'craft'|'research'|'clear'|'explore'|
            'envoy'|'raid'|'colonize'|'rest';

interface Party {
  id: PartyId; home: VillageId; kind: 'explore'|'envoy'|'raid'|'colonize'|'refugee';
  members: PersonId[]; cargo: Record<CommodityId, number>; rations: number;
  mode: 'provisioned'|'foraging'; boat?: RecipeId; cart?: RecipeId;
  route: TileId[]; at: TileId; progressMiles: number; target?: VillageId|TileId;
  mandate?: Mandate; seen: Set<TileId>;
}

interface Knowledge {
  tiles: Map<TileId, { terrain; stocksSeen: Record<CommodityId, 'none'|'some'|'rich'>; seenAt: Tick }>;
  villages: Map<VillageId, { name; tile; lastSeen: Tick; sizeSeen: number }>;
  paths: Set<TileId>;
}
```

Commodities and recipes are data, not code. The sim consumes numeric *effects*; names exist only for the chief and the player.

```ts
interface Commodity { id; name; category: 'grain'|'fruit'|'meat'|'fish'|'fiber'|'hide'|'wood'|'stone'|'ore'|'water'|'made';
                      food: number; novelty: number; perish: number /* weeks, 0 = never */; weight: number; }
interface Recipe { id; name; tier: 1|2|3|4; inputs: {id: CommodityId, qty: number}[]; requires?: RecipeId /* tool or structure */;
                   output: { commodity?: CommodityId; structure?: StructureEffect; capability?: Capability };
                   laborWeeks: number; hints: string[]; curiosity: boolean; }
type Capability = 'fire'|'cart'|'wagon'|'paddle'|'sail'|'net'|'hook'|'bow'|'spear'|'palisade'|'watch'|'road'|'bridge'|
                  'storage'|'drying'|'irrigation'|'husbandry'|'medicine'|'instrument'|...;
```

## 5. The tick

One call, one week, fixed order. Each phase reads state and appends events; nothing outside the sim runs in between.

1. **Apply inputs** queued since the last tick: chief decisions become standing orders; spirit messages enter the chief's inbox; breath actions adjust future rolls.
2. **Weather.** Derive this week's weather from the season roll; a storm may hit boats at sea. When a season ends, roll the season four ahead.
3. **Parties move.** Advance each party by miles per day × 7 for its terrain, mode, load, and season. Consume rations in provisioned mode; check starvation on barren tiles. Tread each tile crossed. Record tiles seen. On arrival: explorers turn home; envoys enqueue a *visitor deliberation* for the host chief; raiders resolve combat; colonists found a village; refugees join.
4. **Work.** For each standing order: forage/hunt/fish draw from stocks in proportion to fullness; farm advances plots by season (plant, tend, harvest); build and craft consume inputs and add progress; research rolls against the recipe graph and may reveal a hint; clear converts a plot; explore/envoy/raid/colonize spawn parties.
5. **Consume and spoil.** Each person eats one food unit, preferring variety (novelty accounting). Stacks age; perishables past their week limit are lost, less with storage capabilities.
6. **Health.** Hunger raises mortality sharply. Age curve modified by shelter, medicine, food security. Deaths recorded. Births in proportion to well-fed adults. Chief death triggers succession.
7. **Land.** Wild stocks regrow logistically (plants only in spring and summer). Field fertility drops on harvest and recovers on fallow. Fish stocks likewise.
8. **Happiness.** Recompute; check coup threshold.
9. **Paths.** Decay trodden values; promote to path or road-eligible; foraging treads neighbors.
10. **Schedule chiefs.** Evaluate triggers per village; emit `DeliberationRequested` with the reason and a digest. Coalescing rules depend on the current speed (see §8).
11. **Summary event** for the UI and audio: counts of births, deaths, arrivals, discoveries this week.

Complexity per tick is linear in people, parties, and tiles with activity. A 64 × 64 world with 30 villages of 100 is trivial in a worker at any speed; the model, not the sim, is the throttle.

## 6. World generation

Seeded from the `worldgen` stream.

1. **Elevation** from layered simplex noise; a coastline threshold produces ocean, a high threshold produces mountains.
2. **Moisture** from a second noise field biased by distance to ocean and by prevailing wind direction. Low moisture plus warmth yields desert; oases are sparse noise peaks inside desert.
3. **Rivers** by flow accumulation downhill from mountain tiles to the coast or a lake; tiles the flow passes become river tiles, and lakes form in closed basins. Fords appear where a river tile is shallow (low accumulation).
4. **Biomes** from elevation and moisture: grassland, forest, hills, marsh near rivers in flat land.
5. **Resources.** Each tile gets wild stocks from a biome table (plants, game, timber, stone). Regional commodities are placed as a handful of blobs each, so every rarity exists somewhere but nowhere is complete. Ore only in hills and mountains. Fish on coast and river.
6. **Villages.** Four start sites chosen by a scoring pass: habitable biome, water adjacent, at least one regional rarity within two tiles, mutual distance 60 to 150 miles, at least one site on coast or river. Each site gets twenty people, a culture sampled from the `names` stream's tradition, and two months of food.
7. **Wind.** Prevailing direction per season, seeded, with a mild yearly drift.

## 7. Tech tree generation

The **skeleton** is a hand-written data file and is the balance lever. It defines tiers, categories, and *slots*. A slot says what kind of thing goes here, without saying which. Example slot in tier 2:

```yaml
- slot: preserved-food
  inputs: [{category: fish|meat, qty: 3}, {category: made, capability: fire}]
  output: {category: made, food: 3, perish: 40, novelty: 2}
  hintTemplates: ["{in0} keeps longer when {in1} is nearby", "Smoke changes {in0}"]
```

The **generator** fills each slot from the seed: picks concrete inputs among commodities of the allowed categories present in this world, rolls numbers within the slot's ranges, names the output, writes hints from the templates, and marks a share of slots as curiosities. It then verifies the whole graph is reachable from raw commodities and that every capability the sim depends on (fire, cart, sail, and the rest) is produced by exactly one recipe. If verification fails it re-rolls with the next sub-seed.

**Names.** A phoneme mixer over a few seeded syllable inventories produces stems; category morphemes are appended so category stays readable ("-wheat", "-rock", "-hide"). Village and person names use different inventories per culture so villages sound distinct.

**Effects, not names.** The sim never reads a name. Food value, novelty, perishability, capability, travel modifiers, mortality modifiers are numbers on the generated records.

## 8. The chief agent

### 8.1 Scheduler

Runs on the main thread. For each `DeliberationRequested` it decides *whether* and *how* to call the model:

| Speed | Cadence | Model class | Coalescing |
|---|---|---|---|
| Pause, step, slow | every event | capable for conversations and visitors, cheap for routine | none |
| Normal | every event | cheap; capable for visitors | none |
| Fast | seasonal digest plus urgent events | cheap; capable for visitors | non-urgent events bundle into the next digest |
| Very fast | seasonal digest only | cheap | everything bundles; urgent events still auto-pause if enabled |

Urgent events: raiders arrive, famine imminent, chief death, spirit message. A per-game-year token budget is tracked; when exceeded, the scheduler falls back to the **scripted policy** (the same one the harness uses) and logs it, so the world keeps running and the player sees a note in the journal ("the chief acted on habit this season").

Concurrency: at most N in-flight calls; requests are queued per village so a village never has two deliberations outstanding. A decision that arrives late is applied at the next tick and stamped with the tick it was requested at, so the journal reads honestly.

### 8.2 Prompt contract

Every call is stateless. Continuity comes from three things the sim maintains: the chief's bounded **memory notes**, the **trust chronicle**, and the **recent history digest**. The prompt has fixed sections in fixed order so caching works:

1. **Persona.** Name, village, culture traits, personal traits rendered as prose, the speaking rules from the concept (plain English, light stylization).
2. **World rules the chief knows.** Seasons, that things spoil, that research is trial, that the spirit sometimes speaks and sometimes is right. Nothing about tiers, budgets, or hidden mechanics.
3. **Village state.** Population by stage, health, happiness, stores by commodity with age, plots, known recipes with their inputs, hints known, current orders and how long they have run.
4. **Known world.** Tiles seen with rough direction and distance, resources noted, other villages known with last-seen size and relation, paths known.
5. **Recent events digest** since the last deliberation, and the reason for this one.
6. **Spirit.** Trust level rendered as an attitude, pending spirit messages, the chronicle's last few entries.
7. **Memory notes.** The chief's own prior notes.
8. **Action menu.** Tasks with valid parameters given current capabilities (only recipes the village knows appear; only known destinations appear).
9. **Output instructions** with the schema.

Output is structured (JSON schema enforced by the proxy):

```ts
interface ChiefDecision {
  orders: { task: Task; workers: number; params: {...} }[];   // replaces standing orders
  mandates?: Mandate[];                                       // for envoys being sent
  replyToSpirit?: string;                                     // prayer, if any
  journal: string;                                            // 2–5 sentences, in character
  memoryNotes: string[];                                      // replaces memory, max 12 lines
}
```

The parser validates against the menu; an invalid order is dropped with a logged reason, never repaired silently. If the whole response is unusable, the scheduler retries once, then falls back to the scripted policy.

### 8.3 Conversation mode

When the player opens chat, the game pauses and a multi-turn session starts with the capable model, seeded with the same fixed sections plus the transcript. Each turn is recorded as a `ConversationTurn` event. On close, one more call asks the chief to update memory notes and to state any claims the spirit made as chronicle entries ("the spirit said rain will come by midsummer"). Those entries are what the trust rule later scores.

### 8.4 Visitors

An arriving envoy enqueues a visitor deliberation for the host chief with the mandate rendered as an offer. The output adds one field: `visitor: { accept | counter: {...} | refuse, reason }`. One round in v1. The trade executes in the sim; the envoy turns home with the goods, the host's map, and knowledge of the host's size and mood.

### 8.5 Trust

Maintained by the sim, not the model. Chronicle entries are structured claims with a due tick and a check. When the tick arrives, the sim evaluates the claim against the log and applies the table in the concept. The rendered attitude in the prompt is the only way the model sees trust, so it cannot game the number.

### 8.6 Obfuscation

Names are generated; ids are opaque; the prompt never includes real-world equivalents, tier numbers, or the count of unknown recipes. Category morphemes are the only leak, and that one is deliberate.

## 9. The model proxy

A small Cloud Run service.

- **Auth.** Firebase anonymous auth for v1; the ID token is verified on every request. Accounts come with multiplayer.
- **Quotas.** Per user per day, in tokens, with a hard ceiling. The scheduler's per-game-year budget is the soft limit; the proxy's is the backstop.
- **Routing.** The client names a *class* (`routine` or `capable`), never a model id. The proxy maps classes to current Gemini models. Model ids are configuration, verified against the live model docs at deploy time per the global rule, never hard-coded in the client. As deployed 2026-09-12: routine `gemini-3.8-flash`, capable `gemini-3.1-pro-preview`, on Vertex AI via the service account and the `global` endpoint. Service: `https://llm-proxy-406179055859.us-central1.run.app`; health at `/health`.
- **Structured output.** The proxy passes the JSON schema through and rejects malformed responses before they reach the client.
- **Logging.** Request class, token counts, latency, and a hash of the prompt for cache diagnostics. Never prompt bodies in logs.

## 10. Spirit actions and breath

Player commands are inputs: `SpiritSpoke {village, text}`, `SpiritBreathed {action, target}`. The sim validates cost against the pool, applies the change to the future roll or the party, and records both natural and adjusted rolls in the event. The pool regenerates in the tick. Breath actions are visible in the log and the scrubber; chiefs see only outcomes, as the concept says.

## 11. Travel and paths

- **Routing.** A\* over tiles with edge cost = days to cross, from the terrain table modified by path status, load, season, boat, and cart constraints. Parties route on what their village *knows*; unknown tiles are assumed to be their most likely terrain from adjacent known tiles, and the party re-plans as it learns.
- **Water.** Boats route on water tiles only; river direction sets upstream and downstream cost; wind direction sets sail cost. A land party with a boat capability can portage between adjacent water tiles at a fixed penalty.
- **Provisioning** and **foraging** modes as in the concept. Mode is set by the chief in the order; a provisioned party that runs out switches to foraging automatically where possible and logs it.
- **Paths.** Trodden per tile: +1 per party crossing, +2 with a cart, decay 2% per week. Path at 6, road-eligible at 20. Roads are a structure built on a tile by a party sent to build it.
- **Getting lost.** In tiles unknown to the party's village, a small weekly chance (`travel` stream) of a week's delay.

## 12. Conflict resolution

A single resolution function, called on arrival, using the `combat` stream:

```
strength = adults × (1 + weapons + armor) × surprise × defenses
```

Each side's strength plus noise sets casualties for the other side; the side that keeps more of its strength wins. Tribute demands resolve without combat if the host accepts (a visitor deliberation with the demand). Raid outcomes take stores, not people, unless the raiders' strength exceeds the defenders' by a large margin, in which case the village is destroyed and refugees spawn toward the nearest known village. Surprise is 1.0 for parties seen approaching on paths, higher for sea arrivals without a coastal watch.

## 13. History and storage

- **Store.** IndexedDB via a thin wrapper. One database per world: `events` (append-only, keyed by index), `snapshots` (keyed by tick), `meta` (seed, name, last tick, created). Writes are batched per tick.
- **Saves.** A world is its seed plus its event log; export is a single JSON file, import replays it. Multiple worlds in the gallery.
- **History view.** The scrubber runs a second sim instance in its own worker: load nearest snapshot, replay to the target tick, render. The live sim is untouched.
- **Narrative.** A request to the capable model with the events and journals of a span, producing prose. Cached by span hash.

## 14. UI

- **Stack.** React, Vite, TypeScript. Canvas 2D for the map; React for everything else. No game framework: the rendering needs are tiles, sprites, and overlays at three fixed scales, well within Canvas 2D on a 64 × 64 world. Revisit if larger worlds need batching.
- **Map component.** One canvas, three renderers sharing a tile atlas:
  - *World*: 4 px per tile, terrain color, path lines, village marks, party dots.
  - *Local*: 12 × 12 tiles at 64 px, terrain tiles, path overlays, sprites for parties and boats, scrolling.
  - *Village*: the local plot grid (12 × 12 plots) with building and field sprites and people sprites wandering.
  - Season palette applied as a tint table per season; transitions crossfade over a few seconds at any speed.
- **Panels.** Village panel (stats, stores, recipes, orders, trust, history feed, chat), journal, weather strip, year-wheel, speed control, breath meter, event toasts, scrubber.
- **State.** The worker posts a compact view model each tick (not the whole world); panels subscribe by village. Commands go the other way. A small store (Zustand) holds UI state.
- **Auto-pause.** The scheduler and the UI share an attention-event list; the worker pauses itself on those events so nothing is missed between frames.

## 15. Audio

- **Graph.** Web Audio with five gain buses (ambient, village, markers, events, spirit) into a master. A settings panel exposes each.
- **Ambient.** Looping beds per season × biome, built from short granular layers with randomized offsets so nothing repeats identically. Crossfade on season change and on zoom or scroll to a new dominant biome.
- **Events.** A queue fed by the tick summary. A coalescer groups by type within a window that widens with speed; each type has a one-shot sample and a "many" variant.
- **Music.** A generative module: the seed picks a mode, tempo, and instrument set; layers (drone, melody, tension, lament, festival) are gain-controlled by sim state. Synthesized with Web Audio oscillators and simple samples, no licensed assets.
- **Spirit.** Wind synthesis from filtered noise; intensity follows action size and pool level.
- **Reduced-motion and mute.** Every informational sound has a visual counterpart in the toasts and panels.

## 16. Balance harness

A node CLI over `sim` and `gen`.

- **Scripted chiefs.** A family of deterministic policies: forager, farmer, explorer, trader, raider, and a mixed "sensible" policy that reacts to stores and hints. These are also the runtime fallback when the model is unavailable.
- **Runs.** `harness run --seeds 50 --years 300 --policy sensible` produces per-village weekly CSV: population by stage, food stores, yields by source, happiness, deaths by cause, recipes known, paths, trades, raids.
- **Report.** A static HTML page with charts and the balance assertions from the concept: a village of 20 survives indefinitely; a village of 50 cannot on wild food alone; 150 needs tier-3 tech or trade; median first colony within N years; raids rarer than trades under the sensible policy.
- **Regression.** Assertions run in CI; hash equality across runs proves determinism.

## 17. Testing

- **Unit** tests per sim system with fixed seeds.
- **Determinism** property: same seed and inputs yield identical snapshot hashes on every platform we ship to.
- **Replay** golden tests: recorded logs replay to identical state.
- **Prompt evals** for the chief: a corpus of village states with expected sane decisions, scored by a checker (no starvation orders, no unknown recipes, journal in character). Modeled on the weatherbot eval stack.
- **Generator** tests: every generated tree is reachable, every capability produced once, names unique.
- **UI** smoke tests in a browser: open a world, run a year, open a village, talk to the chief with the proxy mocked.

## 18. Cost model

Per village-year at normal speed: about four seasonal deliberations plus roughly eight event-driven ones. Prompt size dominates; output is small.

| Quantity | Estimate |
|---|---|
| Deliberations per village-year | ~12 |
| Prompt tokens per deliberation | ~5,000 (fixed sections cache well) |
| Output tokens per deliberation | ~500 |
| Conversations per hour of play | a handful, capable model, ~20 turns |
| A 300-year world of ~10 average villages | ~36,000 routine calls |

At fast speeds coalescing cuts routine calls by two thirds or more. The per-game-year budget and the scripted fallback bound the worst case. Model pricing is checked at build time, not written here.

## 19. Milestones

| | Deliverable | Proves |
|---|---|---|
| M0 ✅ 2026-09-12 | Repo, `sim` core, `gen` world, harness with scripted chiefs, report | Determinism, balance targets. See m0-notes.md |
| M1 ✅ 2026-09-12 | Tech generator, names, hints, research, recipes in the sim | Discovery feels like discovery under a scripted explorer. See build-notes.md |
| M2 ✅ 2026-09-12 | `agents` scheduler, prompt contract, proxy on Cloud Run, fallback, envoys and raids in the sim | A real chief runs a village (3-year and 30-year proofs; the century is an M7 playtest item) |
| M3 | Web UI: map at three zooms, panels, speeds, auto-pause, saves | Watchable |
| M4 | Spirit chat, breath, trust, chronicle | The core loop |
| M5 | History scrubber, narrative | Replay |
| M6 | Audio v1 | Hearable |
| M7 | Playtest and tune | Fun |

## 20. Technical decisions and open items

Decided in this document: TypeScript monorepo; pure sim in a worker; event sourcing with yearly snapshots; named PRNG streams; scheduler on the main thread; Cloud Run proxy with anonymous auth and class-based routing; Canvas 2D plus React; IndexedDB saves; scripted policies double as fallback and harness.

Decided 2026-09-12:

- **Proxy host: Cloud Run.** Streaming replies for conversations, control over minimum instances so a first prayer doesn't wait on a cold start, and a deploy pattern already used by weatherbot and Familiaris.
- **Numbers: integers in thousandths** for stocks, fertility, trust, happiness, and trodden values. Floats can differ across engines over thousands of ticks; integers hash identically everywhere, which replay and the harness depend on.
- **Local plot grid: 12 × 12.** 144 plots fits a village of 150 with room to spare and stays readable at a glance; a full grid is a natural nudge to colonize.
- **Tile atlas shared** between the live map and the history worker via a shared bitmap.
