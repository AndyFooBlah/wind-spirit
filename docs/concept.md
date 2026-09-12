# Wind Spirit — Concept Document

*Status: concept settled; M0–M2 built, M3–M7 in progress. See technical-design.md and build-notes.md.*
*Last updated: 2026-09-11*

## 1. One-liner

A civilization sandbox where every village is run by an AI chief and the player is a spirit who sees everything and can touch almost nothing. You win chiefs' trust by whispering truths; they build the world with their hands.

## 2. The core asymmetry

Everything in the design serves one idea:

| | Sees | Does |
|---|---|---|
| **The spirit** (player) | Everything: every village, every deposit, the weather ahead, the whole tech tree | Almost nothing: speaks to chiefs, and spends a scarce "breath" budget on wind and weather |
| **The chief** (AI agent) | Only what its village knows: local land, discovered recipes, remembered contacts, known paths | Everything: assigns every adult, orders every building, sends every party |

The chief listens to the spirit because the spirit knows things. Advice that pans out builds trust; advice that fails erodes it. **Trust is the scoreboard.** There is no other win condition.

## 3. The world

- **Map.** A tiled region, default 64 × 64 tiles of 5 × 5 miles (320 miles on a side). Larger worlds with a scrolling UI later. Seeded; a seed reproduces a world exactly.
- **Terrain.** Grassland, forest, hills, mountain, desert, marsh, river, lake, coast, ocean. Deserts and mountains are natural barriers: fast or slow to cross, but no food or water along the way. Rare oasis tiles in deserts have both.
- **Water.** Rivers, lakes, and ocean. Without boats, a river costs a day to cross unless a ford or bridge exists, and ocean is impassable. With boats, rivers are highways and coasts are neighbors. Coastal and river villages get fishing and fast trade; inland villages don't. This asymmetry is deliberate.
- **Resources.** Raw commodities live on tiles. Some are everywhere (stone, water, wood); others are regional (zoigberries, hopparabbits, copper-bearing rock, fish). Non-uniform distribution is what makes trade worth doing.
- **Depletion and regrowth.** Every raw resource on a village's tile and its neighbors has a stock that depletes with use and regrows over time. Worked-out land shows up as falling yields. Fish stocks deplete too. Depletion is the pressure behind expansion, migration, and trade.
- **Seasons.** Fifty-two weeks, four seasons of thirteen. Winter scarcity drives storage, preservation, and shelter.
- **Weather.** Each season rolls drought, normal, wet, hard winter, or storm, decided four seasons ahead so the spirit can see it coming. Weekly weather within a season is derived from the seasonal roll and is cosmetic. Storms at sea sink boats.
- **Wind.** Each season has a seeded prevailing wind direction. Sailing with it runs at full speed, against it at half. The spirit sees the wind ahead, so even a plain forecast has value to coastal chiefs.

### Depletion, regrowth, and fields

Each wild resource on a tile has a stock and a capacity and regrows logistically: fastest at half full, slow when nearly empty or nearly full. Yield per worker-week is proportional to how full the stock is, so the chief experiences depletion as falling yields.

| Resource class | Regrowth per week | Recovers from empty in | Notes |
|---|---|---|---|
| Wild plants, berries | 5% | 1–2 years | Grows only in spring and summer |
| Game animals | 2% | 3–5 years | Over-hunting is the classic trap |
| Fish | 3% | 2–3 years | Coastal and river tiles only |
| Timber | 0.5% | decades | Clearing land removes it permanently |
| Stone, ore | none | never | Large stocks, effectively finite |

Balance targets: a village of ~20 lives easily off its tile and neighbors. Around ~50, wild food alone can't sustain it, so farming must start. Around ~150, one tile's farming isn't enough without irrigation, husbandry, or trade. That ladder pushes villages outward.

Fields have their own loop. Each plot has a fertility from 0 to 1. Every harvest drops it a step; fallow seasons restore it slowly. Husbandry raises the recovery rate (manure); irrigation raises the cap. Nothing tells the chief about fallow. A curious chief notices rested plots recover, or the spirit tells it.

## 4. Travel, paths, and provisions

- **One village per tile.** A village occupies a single world tile; its buildings and fields are laid out on a local grid inside it. Villagers forage on the home tile and its neighbors as day trips. No intra-village travel is simulated.
- **Parties.** Envoys, explorers, colonists, and raiders move across world tiles. Travel speed per day, by terrain:

| Terrain | Wild | On a path |
|---|---|---|
| Grassland | 20 | 25 |
| Desert | 20 | 20 |
| Forest | 10 | 20 |
| Hills | 10 | 15 |
| Marsh | 5 | 12 |
| Mountain | 5, some tiles impassable | 10 (a pass) |
| River (crossing) | costs a day, or a ford / bridge | — |
| Ocean, lake | impassable without a boat | — |

- **Modifiers.** Carrying goods slows a party by a quarter. Winter slows by nearly half. A hand cart off a path moves at half speed and cannot enter forest or marsh. On a path a cart moves at full speed and carries several times a person's load. Wagons need roads.
- **Boats.** Paddled: about 25 miles a day on a lake or along a coast; 40 downstream, 15 upstream. Sailed: about 60 miles a day, wind-dependent. Boats carry cargo far beyond a cart. Boats cannot leave water.
- **Provisions and foraging.** A party carries rations (food and water) as cargo, consumed at one per person-week. Two travel modes:
  - *Provisioned*: full speed, eats cargo.
  - *Foraging*: half speed, eats nothing from cargo, and can continue indefinitely where forage exists.
  - Forage exists on grassland, forest, hills, marsh, river, lake, and coast tiles; winter halves it (quarter speed in foraging mode). Desert, mountain, and open ocean offer none. A boat carrying nets can live off the sea.
  - A party with no rations on a tile with no forage takes a rising weekly chance of deaths. Crossing a desert or a range means bringing food, or dying.
- **Paths emerge from use.** Every land tile has a *trodden* value. A party crossing adds 1, a cart adds 2; the value decays about 2% per week when unused. At 6 the tile shows as a path and uses path speeds. At 20 a chief can upgrade it to a *road* with a recipe using stone and labor; roads don't decay and admit wagons. With these numbers a single round trip never makes a path, a seasonal trader barely sustains one, a monthly round trip settles around 23, and an abandoned path fades in a bit over a year. Villagers foraging neighboring tiles tread them too, so paths radiate from every village. Consequences:
  - The map draws the trade network itself, and a lapsed trade route fades.
  - Carts and roads become the first infrastructure decisions a chief makes.
  - Raiders follow paths too; a well-trodden route is also an exposure.
  - Returning parties add the paths they used to the village's map.
- **Getting lost.** A party in unknown territory has a small weekly chance of losing a week. Known paths and water never lose time.

## 5. Villages and people

- A village begins as a clearing with tents, then fields, then structures. Buildings and fields are placed semi-randomly on the village's local grid.
- Each inhabitant is a record: age, health, life stage (child / adult / elder). Only adults work. Children and elders age and eat. No genders, no per-person skills.
- **Only the chief is an LLM agent.** Everyone else is a number with an age. An envoy is briefly animated when negotiating.
- Everyone eats each week. When stores run out, a rising share go hungry with a sharply rising chance of death. Mortality is an age curve modified by shelter, food security, and medicine.
- Population grows in proportion to well-fed adults.
- **Village culture** is a slow-drifting personality profile inherited across chiefs. **Chief personality** samples from culture plus noise. Axes: piety vs. skepticism, caution vs. ambition, hospitality vs. suspicion, tradition vs. curiosity.
- **Happiness** = f(food security, shelter, novelty of goods consumed recently, recent deaths, recent festivals). Novelty decays per commodity type. A village whose happiness stays below a threshold replaces its chief.
- **Succession.** A new chief is chosen at random from adults and samples a fresh personality from culture. Trust toward the spirit is inherited at a discount (see §6).
- **Starting state.** Four villages of twenty (twelve adults, six children, two elders), sixty to one hundred fifty miles apart, each beside a different regional resource, at least one on a coast or river. Stone-age tech, hunter-gatherer skills plus basic agriculture, two months of food, a clearing with tents.

## 6. The chief

- Receives village state and a menu of actions; issues **standing orders** that persist until changed.
- **Deliberates on a cadence plus events.** Baseline once a season. Events: harvest, death, discovery, returning party, arriving envoy or raiders, spirit message, food or happiness crossing a threshold.
- **Batched deliberation.** At high speed a season's events arrive as one digest and get one answer; at slow speed events are answered individually. This is the main cost control.
- **Journal.** Each deliberation produces a short in-character entry. The player reads these; they also feed narrative synthesis.
- **Trust** is a number from 0 to 1, updated on *validation of claims*, not on village outcomes:

| Event | Change |
|---|---|
| Spirit's prophecy fulfilled | +0.10 × (1 − skepticism) |
| Spirit's prophecy failed | −0.20 |
| Advice followed, good result | +0.05 |
| Advice followed, bad result | −0.10 |
| Advice ignored, then validated by consequence | +0.10 |
| Succession | new chief inherits trust × 0.7 |

  Personality sets the threshold for acting on advice: pious ≈ 0.3, neutral ≈ 0.5, skeptical ≈ 0.7. High-trust chiefs consult the spirit before big decisions.
- **Prayer** is two-way. The chief can ask the spirit questions and report outcomes.
- **Perception of breath.** Chiefs see only weather and outcomes. If the spirit announced it first, the chronicle credits the spirit. Chiefs cannot distinguish prophecy from causation; each village builds its own theology.
- The prompt is built only from the village's knowledge state. No world facts leak. Chiefs never see tier counts or the shape of the tech tree.

## 7. The spirit (player)

- **Sees**: the whole map, all villages, all stocks, weather four seasons ahead, every path, and the entire tech tree with real recipes. Full omniscience from the first week.
- **Speaks**: typed messages to any chief, received as a dream, omen, or voice on the wind. **No delivery delay.** A message is an event that triggers a deliberation in the same week. A conversation while paused is real-time chat, logged as one night's dream and prayer in that week. At speed, a chief processes at most one exchange per week; extra messages bundle.
- **Breathes**: one renewable budget spent on wind and weather. Weather actions apply only to seasons not yet begun; the sail action applies to a voyage in progress.

| | Value |
|---|---|
| Pool cap | 100 |
| Regeneration | 0.25 per week (about 13 a year) |
| Fill or becalm the sails of one voyage | 10 |
| Nudge a coming season one step | 15 |
| Override a coming season entirely | 50 |
| Targeted storm on one tile for one week | 80 |

  - *Fill* gives one boat party full sailing speed regardless of heading and no storm loss for the whole trip. *Becalm* holds it to paddle speed. Becalming a raiding fleet is the naval equivalent of the storm at a fraction of the cost.
  - Roughly one nudge a year, a full override every four years, a storm on raiders every seven years from empty.
  - The log records natural and adjusted rolls, so the player and the scrubber see every intervention. A nudge sits inside natural variance. An override is rare but plausible. A storm on one raiding party is unmistakable.
  - The best trust move in the game: announce the rain, then bring it.
- **Does not**: move people, place buildings, give goods, or reveal recipes directly. The spirit's knowledge of the tree is already its biggest lever; breath stays on wind and weather so the two powers remain distinct.

## 8. Economy

- **Commodities.** Raw (from tiles and water) and made (from recipes). Some perish unless stored properly. Storage is its own chain.
- **Tech = recipes.** Every technology is inputs, a required tool or structure, and outputs. No separate prerequisite tree; prerequisites fall out of the input graph. Knowledge belongs to the village.
- **Obfuscation hides specifics, never categories.** Generated names carry category cues, so "blue wheat" reads as a grain and "grey-vein rock" as an ore. Chiefs reason from category the way a forager would.
- **Tiers** (hand-designed skeleton, procedural leaves; each recipe two or three inputs):

| Tier | Contents | Count |
|---|---|---|
| Raw | Tile and water commodities; about half present near any one village | ~25 |
| 1 | Stone-age basics: fire, stone tools, hide tents, paddle and dugout, fishing spear, simple fiber net | ~16 |
| 2 | Settled life: storage, cooking, cloth, huts, fish drying, larger hulls, hand cart | ~19 |
| 3 | Irrigation, husbandry, bows, medicine, sail and mast, roads, ford and bridge | ~17 |
| 4 | Bronze and late: metal tools, metal hooks, wagons, instruments, seagoing boats | ~13 |

  About a fifth of research outcomes are *curiosities*: novelty goods that raise happiness but lead nowhere. Some pairings yield nothing.
- **Research.** Naming one ingredient is exploration: slow, broad, reveals hints. Naming two is a focused test: resolves in one to three months, finds the recipe if one exists.
- **Hints.** Each recipe gets one or two hint sentences at world generation ("blue wheat softens when soaked"). Failed focused research reveals a hint for a recipe sharing an input about a third of the time; exploration research reveals hints for recipes containing the ingredient. Once all a recipe's hints are known the chief effectively has it. Villages without a spirit have a slow path; the spirit is the shortcut.
- **Barter only.** No money. Seed one durable, divisible, scarce commodity and watch.

## 9. Between villages

- **Knowledge.** Each village keeps known features with relative positions, including paths and water routes. Exploration adds to it; returning parties share what they saw, including the other village's map. Fog of war per village, none for the spirit.
- **Envoys and trade (v1: mandate model).** The envoy carries a mandate: what to offer, what to want, the floor. The receiving chief decides in one call. Free-form two-agent negotiation with a round cap is phase 2.
- **Tech transfer.** A recipe travels like any good; the receiver uses it when it has the inputs.
- **Conflict is a ladder** with mostly bad expected value: demand tribute → raid stores → destroy. Raids usually take food, not lives. Attackers act on stale information; the spirit does not. Palisades and weapons are recipes. Engagements resolve semi-randomly with modifiers for weapons, armor, numbers, defenses.
- **Raids at sea.** No ship-to-ship combat in v1. Boats are transport. Sea raiders land on the target tile and fight as a land raid with a surprise bonus, because land parties are visible coming along paths and boats are not. A *coastal watch* structure (tier 2) spots boats a week out and removes the surprise. Cargo at sea is at risk only from storms. Traders can't be intercepted. Piracy and boarding are a phase-2 question.
- **Refugees, not captives.** Survivors walk to the nearest village carrying recipes and grudges.
- **Grudges and alliances.** Chiefs remember other villages.
- **Colonization** is triggered by carrying capacity. A party with food founds a new village on an empty tile, picks its own chief, inherits the parent's culture.
- **Disease via contact**: later.

## 10. Time and game speed

- **Tick = one week.** Journeys are one to three ticks by land, often one by water. Fifty-two ticks a year.
- **The sim never waits for a chief.** Standing orders run until a new decision lands.
- **Speeds.**

| Speed | Real time per week | A century takes |
|---|---|---|
| Pause | — | conversations, journals, scrubbing |
| Step | on demand | watch a raid or a starving village week by week |
| Slow | ~10 s | watching a season |
| Normal | ~2 s | ~3 hours |
| Fast | ~0.5 s | ~45 minutes |
| Very fast | ~0.1 s | ~9 minutes, throttled by chief throughput |

- **Auto-pause on attention events** (configurable): raiders arrive, famine imminent, a chief prays, a chief dies, a village founded, a discovery. Talking to a chief always pauses.
- **Deliberation scales with speed.** Slow: events answered individually with the capable model. Fast: seasonal digests, cheaper model for routine. The LLM budget is per game-year, not per tick.

## 11. History and replay

- **Event-sourced sim.** State derives from an append-only event log, seeded RNG, and logged chief decisions. Replay is free and exact.
- **Snapshots** every game-year for fast seeking.
- **Timeline scrubber.** Jump to any week in any village's past.
- **Per-village history feed** and **narrative synthesis** from events and journals.

## 12. UI

- **Three zoom levels.**
  - *World*: every tile a few pixels showing terrain, paths, water, villages as marks. Parties as dots.
  - *Local*: about 12 × 12 tiles, scrolling. Terrain tiles, path overlays, boats and parties as sprites.
  - *Village*: a single tile, showing the local grid of buildings and fields around the center, with people sprites.
- **Season and time.** Tile palette shifts by season. A year-wheel shows week and season. A weather strip shows the four seasons ahead. Speed controls always visible.
- **Village panel**: population by stage, health, happiness, stores, known recipes, work assignments, trust, history feed, chat with the chief.
- **Journal view**, **timeline scrubber**.
- **Art.** Fixed placeholder tileset for v1; per-game generated art with a coherent style is a pluggable phase-3 layer (generate a whole sprite sheet in one image).

## 13. Audio

**The wind is the player.** Every other sound belongs to the world; wind is the spirit's presence and rises whenever the player acts.

Five layers on separate buses the player can balance or mute:

- **Ambient bed.** Driven by season and by what's on screen. Spring: birdsong, running water, rain. Summer: insects, warm wind. Autumn: dry leaves, geese, harder wind. Winter: muffled, sparse, wind and crunch. At local and village zoom the biome adds its voice (surf and gulls, a river, forest hush, desert wind, mountain emptiness). At world zoom, only wind and music.
- **Village sound.** A village sounds like its state. Hubbub scales with population; hammering while a structure builds; children when there are many; animals once husbandry exists; instruments once discovered, played at festivals. Famine is quiet. Prayer is a low chant. The tech tree becomes audible.
- **Time markers.** A soft pulse each week at slow speeds, nothing at fast. A short motif on each season change, distinct per season. A deeper tone on the new year. The ambient bed crossfades at the same moment.
- **Event sounds.** Short and distinct: discovery chime, birth, a low bell for a death and a heavier one for a chief, footsteps fading as a party leaves, oars as a boat launches, scythe for harvest, drums and shouts for a raid, a settled tone for a completed trade. A chief praying to the spirit gets the most recognizable sound in the game.
- **Spirit sound.** A message is a gust. Breath actions escalate: a breeze for sails, a swell for a nudge, a long rising wind for an override, thunder for the storm. A nearly empty pool sounds thinner. Talking to a chief while paused drops into night: a fire crackling.

**Speed changes what plays.**

| Speed | What you hear |
|---|---|
| Pause | Ambient continues; music thins to a drone |
| Slow, normal | Everything, every event |
| Fast | Ambient, music, season motifs; only major events (chief deaths, raids, discoveries, prayers) |
| Very fast | Music and season motifs only, plus one summary sound when it stops |

Events at speed coalesce: six births in a season become one sound.

**Music is generated, not recorded**, for the same reason the art and names are: every world should sound like itself. The seed picks a mode, tempo, and an era-appropriate instrument palette (flutes, drums, plucked strings, voice). Adaptive layers: a drone always, melody while watching, tension in a raid, a lament on a chief's death, a festival motif. Web Audio, no licensed assets.

**Rules.** Every sound that carries information has a visual equivalent, so a muted game loses nothing. No sound repeats identically within a short window.

**Phasing.** v1: ambient beds, season motifs, core events, wind as spirit sound, simple generated drone plus melody. Phase 2: full adaptive music, village state sounds, instruments as tech, coalescing at speed. Phase 3: chief voices and village-specific musical dialects.

## 14. Names and generation

- **Names** from a phoneme mixer over a few linguistic traditions plus random syllables.
- **Seeds.** One seed generates map, water, resources, tech leaves, villages, cultures, names.

## 15. Phases

**Step zero, before v1**: a headless balance harness. The sim with scripted chiefs instead of LLM chiefs, run for a few hundred years across many seeds, charting population, stocks, and yields. It settles every rate above before a real chief deliberates and becomes the sim's permanent regression test.

**v1**: single spirit, single 64 × 64 map, week ticks with speeds and auto-pause, event-driven chiefs with journals and trust, recipe tech tree with obfuscated names and hints, depletion and seasons, water and boats, paths and roads, provisioned/foraging travel, mandate trade, conflict ladder and refugees, colonization, event-sourced history with scrubber, three zoom levels, placeholder art, breath budget, v1 audio.

**Phase 2**: two-agent negotiation, voice per chief, AI rival spirits, disease via contact, festivals and shrines, multiplayer spirits with domains (wind = weather and sails, tree = growth, water = rivers and fish), larger worlds.

**Phase 3**: per-game generated art, narrative chronicle, scenario sharing by seed.

## 16. Scrapped

Language evolution, per-individual tech knowledge, genders, continuous real time, designed currency, captives, month ticks, intra-village travel.

## 17. Resolved defaults (2026-09-11)

- **The world pauses when the game is closed.** A persistent world is a phase-2 question tied to multiplayer.
- **Chiefs speak plain, clear English with light stylization.** No modern idiom, no fantasy-speak; journals and prayers read as a person.
- **The opening:** the spirit wakes; one village prays first. No tutorial.
- **No ending.** Worlds are saves; several can be kept; new ones start from seeds. An empty world is simply empty.
- **Chief models:** a capable model for conversations and negotiations, a cheap one for routine deliberation. Provider and IDs are settled in the technical design.

## 18. Decision log

- 2026-09-11: Spirit is fully omniscient from the start.
- 2026-09-11: Tech modeled as recipes; prerequisites are the input graph.
- 2026-09-11: Chiefs deliberate on a seasonal cadence plus events; sim never blocks on LLM.
- 2026-09-11: Conflict kept, as a ladder; refugees not captives.
- 2026-09-11: v1 trade uses the mandate model.
- 2026-09-11: Full history via event sourcing with yearly snapshots and a scrubber.
- 2026-09-11: Miracles and weather unified into a single scarce breath budget; costs 15 / 50 / 80, cap 100.
- 2026-09-11: Chiefs perceive breath only by outcome; attribution via the spirit's announcements.
- 2026-09-11: Trust updates on validation of claims; thresholds by personality; inherited at 0.7.
- 2026-09-11: Obfuscation hides specifics, never categories. ~25 raw, ~65 made recipes across four tiers, with hints.
- 2026-09-11: Spirit messages have no delivery delay.
- 2026-09-11: Tick is one week (was one month). Speeds re-based on weeks.
- 2026-09-11: Terrain-based travel speeds; paths emerge from use and can be upgraded to roads.
- 2026-09-11: Water, boats, and fishing added to world and tech tree; coastal vs. inland asymmetry is intended.
- 2026-09-11: Provisioned vs. foraging travel modes; deserts and mountains have no forage.
- 2026-09-11: One village per 5 × 5 mile tile; buildings on a local grid, placed semi-randomly, no intra-village travel.
- 2026-09-11: Default map 64 × 64; larger worlds later.
- 2026-09-11: Three zoom levels: world, local (~12 × 12), village.
- 2026-09-11: Logistic depletion and regrowth with per-class rates; field fertility loop; balance targets at ~20 / ~50 / ~150.
- 2026-09-11: Seasonal prevailing wind; sail action (fill / becalm, cost 10) decided.
- 2026-09-11: Path thresholds: +1 per party, +2 per cart, 2% weekly decay, path at 6, road at 20.
- 2026-09-11: No ship-to-ship combat in v1; sea raids land with surprise; coastal watch removes it.
- 2026-09-11: Audio design: wind is the player; five buses; speed-dependent playback; generated music.
- 2026-09-11: Step zero of the build is a headless balance harness with scripted chiefs.
- 2026-09-11: World pauses when closed; chiefs speak plain stylized English; opening is a first prayer; no ending; two-tier chief models. Concept settled.
- 2026-09-12 (build): Starvation is rationing with quadratic, capped mortality; births scale with a hardship average; adulthood 14–60. (m0-notes.md)
- 2026-09-12 (build): Tech skeleton of ~45 slots in four tiers, seeded leaves; regional raw commodities in blobs; research has explore / focused / hint-driven speeds. (build-notes.md)
- 2026-09-12 (build): Envoys teach any recipe they carry on arrival; hosts answer within eight weeks or the envoy leaves; raids take stores, not people, unless overwhelming. (build-notes.md)
- 2026-09-12 (build): Expeditions collect far commodities; settlers leave one party at a time and never fewer than 16 behind.
- 2026-09-12 (build): Model ids live in the proxy: routine gemini-3.8-flash, capable gemini-3.1-pro-preview; thinking low for routine decisions.
- 2026-09-12 (build): The hunger balance check measures the expansion phase; once a 64×64 map fills (~year 150) hunger regulates and that is expected. Larger worlds are supported by the generator and harness (--size).
