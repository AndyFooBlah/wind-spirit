# Build notes: M1 and M2

*2026-09-12. Continues m0-notes.md. What changed in the design while building, and why.*

## M1: tech, research, crafting

- **The skeleton is data, the leaves are seeded.** `packages/gen/src/tech.ts` holds about 45 slots across four tiers plus curiosity slots. A slot names input categories, not commodities; the generator picks concrete inputs among the commodities present in this world, names the output with a category morpheme ("… wheat", "… clay", "… flute"), fills hint templates with the chosen input names, and validates that every capability is produced exactly once.
- **Regional raw commodities are blobs.** Ten per world (five required: herb, fiber, clay, salt, copper and tin ore), each placed as two to four blobs on matching terrain. Villages gather within two tiles. This is the trade motive and it works: the sensible policy trades hundreds of times per 300 years once villages know each other.
- **Capabilities are crafted once; goods repeatedly; structures built on plots; crops learned by discovery.** One recipe shape, four output kinds.
- **Research has three speeds.** Exploring one ingredient is slow but reveals hints; testing two (or one plus a skill) is fast when a matching recipe exists; once all of a recipe's hints are known the exact test almost always succeeds. Cooks also have accidents (tier-1 food recipes whose inputs are in store).
- **Stores needed compaction.** One stack per commodity per week of age exploded to hundreds of stacks once granaries, drying and pottery multiplied shelf life. Stack ages now bucket on add and compact quarterly. Five times faster.
- **Orders must be cloned on apply.** The sim mutates order params (craft progress), and the recorded inputs are what replay uses. Sharing the object broke replay.
- **Tier 4 needs trade.** Ore sits in hills and mountains; coastal and river villages never reach bronze alone. That is by design, and M2's trade is what should unlock it.

## M2: chiefs, diplomacy, proxy

- **Envoys, mandates, raids, refugees, grudges** live in `packages/sim/src/systems/diplomacy.ts`. An envoy arrives, shares maps, teaches any recipe it carries on arrival (a gift, whatever comes of the trade), then waits up to eight weeks for the host's answer, which arrives as a `HostDecided` input. The scripted host accepts when it can spare the goods, counters with what it can, refuses strangers with grudges.
- **Raids resolve on arrival** with weapons, palisade, and surprise (boats without a coastal watch surprise most). Raids take stores, not people, unless the defenders are overwhelmed, in which case survivors walk to the nearest village. Under the sensible policy raids are about one tenth as common as trades.
- **Feed first.** The policy reserves enough food workers for the coming weeks at current yields before spending adults on research, crafting, and trade. Without that, tech and trade pushed hunger deaths up several points.
- **The chief agent** (`packages/agents`) builds a village view from the village's own knowledge, renders fixed prompt sections, asks for a flat JSON decision, and maps names back to ids, dropping anything invalid with a reason. Trust is rendered as an attitude sentence; the number never appears.
- **The scheduler never blocks the sim.** Decisions come back as inputs; at fast speeds non-urgent reasons bundle into the seasonal digest; a per-village yearly token budget and any error fall back to the scripted policy with a journal line saying so.
- **Gemini 3 thinking tokens count against the output cap.** With a 1,200-token cap every decision truncated. Routine decisions now use a 6,000 cap and `thinkingLevel: low`; a decision costs about 3,000 tokens and 4 to 5 seconds. A village makes about 17 decisions a year at normal speed.
- **Model ids, verified live 2026-09-12:** routine `gemini-3.8-flash`, capable `gemini-3.1-pro-preview` (plain `gemini-3.1-pro` returns 404 on Vertex). They are proxy configuration, never client code.
- **The proxy** (`services/llm-proxy`) runs on Cloud Run in `wind-spirit-prod`, calls Vertex AI through its service account on the `global` endpoint (no API key exists anywhere), verifies Firebase anonymous ID tokens, and enforces a per-user daily token quota in Firestore. Health is `/health`, because Cloud Run's front end swallows `/healthz`.
- **Proof:** one model-run village for three years: 50 model decisions, no fallbacks, 158k tokens, alive and discovering. Thirty years at normal cadence: 367 model decisions, no fallbacks, 1.13M tokens (38k a year), 25 minutes wall clock, the village grew from 20 to 49. One quality gap showed up: that chief reached six skills in its first year and learned nothing new for the next twenty-nine, so the prompt now nudges chiefs to keep someone trying things. A century at fast cadence: 427 model decisions, no fallbacks, 1.4M tokens, 26 minutes. The village grew to 102 by year 60, lost most of its people to the famine described below (this run predates the softer curve), and was rebuilding at 16 by year 100. Every decision parsed; the model never once needed the fallback.

## M4 and M5 groundwork in the sim and agents

- **Spirit inputs.** `SpiritSpoke` lands in the village's inbox and wakes the chief with reason `spirit`; the chief's `replyToSpirit` comes back as a `Prayer` input so it is in the log and can auto-pause the UI. `SpiritBreathed` applies nudge / override / storm / sail against the breath pool (cap 100, +0.25 a week; costs 15 / 50 / 80 / 10) and logs both the natural and the adjusted roll. Storms strike parties on the tile a week later: boats lose half their people and all cargo, land parties a quarter, and everyone loses a week; a "filled" sail is immune.
- **Claims and trust.** A dream conversation (`Conversation` in `packages/agents`) streams the chief's replies from the same village view, and on close one extraction call turns the spirit's words into claims: weather claims the sim checks itself when the season ends, "judged" claims the chief rules on at a later deliberation (the decision schema gained `verdicts`), and unverifiable ones. Fulfilled claims add up to +0.10 trust scaled by piety, failed ones cost 0.20, succession inherits 70%. The chief only ever sees trust as a sentence.
- **Replay.** `replayTo(snapshot, inputs, tick)` rebuilds any week from a snapshot and the inputs logged after it, with no model calls, and returns a world whose RNG state is synced (the bug the first test caught: a world handed off before `syncRng()` carried stale stream states).
- **Narrative.** `narrate()` renders a span of events and journals as a chronicle, saga, or plain summary with the capable model.
- **Prompt eval.** `packages/agents/src/eval-chief.ts` samples village states from a scripted run and scores live decisions: validity, workers within budget, most adults used, feeding first in winter, investing when able, journal in character, notes kept. First run: 8 of 8 samples pass every check, about 4 s per decision.

## Saturation

With the M2 policies on a 64 × 64 map, hunger is 4 to 17% of deaths in the first 150 years and 47 to 55% after, across six seeds. The turn is the map filling: by year 150 there are 80 to 130 villages at a mean size in the mid-thirties, every one at its local ceiling, and hunger becomes the regulator. Expansion works exactly as intended while there is room, and the world is small. The balance check now measures the expansion phase (< 45%) and reports the saturated share alongside. Larger worlds, or slower growth, move the turn later; that is the first thing to revisit after playtesting.

## Expeditions and the bronze chain

Chiefs kept "sending walkers to the clay banks" with no way to bring clay home, because gathering only reached two tiles. An `expedition` order now sends a party to a known far tile to collect a commodity for a few weeks and carry it back (boats and carts raise the load). With expeditions, deeper input chasing in the scripted policy, and research that sometimes tries things the village has seen but never held, bronze appears: 12 of 408 villages reached tier 4 within 300 years across three seeds, all near hills. Tier 4 remains rare by design.

Famine mortality is now quadratic and capped: a model-run village of 102 had lost 95% of its people in one season under the cubic curve. Settlers leave one party at a time and never fewer than 16 people behind, because a model chief once colonized its village down to seven.

## First playtest of the deployed app (M3/M4, 2026-09-12)

Deployed at https://wind-spirit-prod.web.app. A new world, very fast for thirty seconds, a village opened, a whisper sent ("the winter after next will be bitter, store grain and cut wood"). The chief deliberated within the week, wrote a journal that weighed the warning without obeying it ("a wise hearth prepares regardless of spirits"), and prayed back; the prayer auto-paused the game with a toast. Chief deaths auto-pause too. Villages the player has not opened run on the scripted policy ("acted on habit"), which is the cost control working as designed.

Two things for M7: very fast ran about three game years in thirty seconds rather than the ten the speed table implies, and the map pane wants a wide window; at narrow widths the village panel pushes the map aside.

## M3 to M7: the app, the spirit, history, sound, and the playtest

- **The app** (`apps/web`, https://wind-spirit-prod.web.app) runs the sim and the chief scheduler inside a Web Worker; the UI mirrors a compact frame each tick. Only villages the player has opened (up to three) use the model; the rest act by habit, which is the cost control from the design. Saves are yearly snapshots plus every input, in IndexedDB; resume replays from the latest snapshot with no model calls.
- **History** is a second worker replaying from the nearest snapshot (at most 51 ticks), so the live world is untouched. The scrubber labels everything "history" and "Back to now" returns. **Narrative** runs `narrate()` in the worker over stored events and journals, cached per span.
- **Sound** is `@wind-spirit/audio` with a mixer popover per bus; the engine starts on the first gesture.
- **Fixes the integration forced in the packages**: a worker-safe `fetch` default; a prose-only dream prompt (the decision prompt made the capable model answer dreams in JSON); chief memory carried on `ChiefDecided` so replay is exact; provisional habit orders queued while a chief is thinking (at very fast a slow first call had left a village orderless for hundreds of weeks); journals stamped with the tick they were requested at; and no weather roll in the Sim constructor, so a restored world hashes as stored.
- **Playtest results.** The whisper → deliberation → prayer → auto-pause loop works in production. A stale served bundle once opened the database at an old version and hid every saved world; the fix was simply redeploying, and the store now closes old connections when a newer version opens. Very fast runs about a third of its nominal speed on this machine, gated by the worker's timer; acceptable for now.
- **Milestone gate.** All fourteen balance checks pass on six seeds, and with expeditions and deeper input chasing bronze is reached in 83% of worlds within 300 years.

## What comes next (not in scope of M0–M7)

Larger worlds by default (the 64 × 64 map fills by year 150), an eval corpus for dreams as well as decisions, prompt caching through the proxy, festivals and shrines, multiplayer spirits, generated art.

## Larger worlds (2026-09-12, after M7)

The new-world form offers small (64 × 64, four villages), medium (96 × 96, six) and large (128 × 128, eight); large is the default, since a 64 × 64 map fills by year 150. Snapshots are gzip-compressed at rest: a large world's yearly snapshot is about 4 MB of JSON and about 300 KB stored, so a 300-year save is under 100 MB. In the harness a large world runs 300 years in about 85 s against 20 s for small; in the browser expect very fast to be proportionally slower.

## M8: villages you can read (2026-09-12, night)

The second playtest round asked for a village that reads at a glance. Decisions, and why:

- **Buildings sit still.** A structure takes a plot near the centre when it is built and keeps it; fields are cleared
  in patches a few squares out (`packages/sim/src/layout.ts`). Placement is a pure function of the village (a hash
  stands in for randomness), so it costs no RNG draws and cannot desynchronise a replay. Building on wild ground clears
  it as part of the build with no wood yield; the balance suite was unchanged by this.
- **Villagers are derived, not stored.** What each person is doing comes from the standing orders and the people list,
  walked in a fixed order (`apps/web/src/sim/activities.ts`). The sim carries no per-person activity, so the picture
  is the same in the live view and the history scrubber, and costs nothing when no village is open. Names are seeded
  from the village and the person, in the village's naming tradition.
- **Nobody walks for show.** Field hands move between fields in the planting and harvest seasons, children roam, and
  everyone else stands where their work is. People working off the tile (foragers, hunters, gatherers, parties in
  the making) stand faded at the edge of the grid.
- **Icons are shapes for now.** One glyph per kind of building, chosen by what the recipe's structure is for (shelter,
  storage, defence, watch, workshop), so new recipes from the tech generator get a sensible shape without a table.
- **One reading a year.** The overview's charts come from a yearly `SeriesPoint` the sim worker posts at each new year
  and the app persists; older saves are backfilled from their yearly snapshots through the history worker, one at a
  time, the first time the overview opens.
- **Pause on prayer is a per-event setting** and the toast that pauses now offers to turn that event off.
- **Music**: the summer insect layer was a continuous 4 kHz sawtooth, the whine the playtest noticed. It is now brief
  buzzes a few seconds apart, and lead notes above an octave and a fifth over the root are capped at half a beat.

## The sun spirit, the trust meter and the tech tree (2026-09-12, late)

- **Two spirits, two channels.** The wind spirit (the player) can only talk to chiefs. The sun spirit can only talk to
  the player: it looks down on the whole world and answers three questions a year on the capable model. Its prompt is
  a digest of everything (`apps/web/src/sim/sun.ts`): each village as its chief sees it (the same `statePrompt` the
  chief gets), plus what the chief cannot put into words (trust, happiness, hardship, traits, relations), recent
  events, the chronicle of claims, parties abroad, the weather, the whole recipe tree with who holds what, and the
  goods. Around 20k tokens a question on a large world, so a few cents each. The answers are kept per world. Later
  players may be earth, water, wood, fire or the animals; the sun stays the one voice they can all ask.
- **Trust is the score, so it is on the bar.** The top bar shows the mean trust over living chiefs with a word for it
  and a per-chief breakdown on click; the yearly series now records trust and the overview charts it.
- **The tree of recipes** is drawn from a static list the map carries (`StaticMap.tech`): columns by tier, edges where
  one recipe's output is another's input or required skill, the open village laid over it (held, hinted, unknown).
  Layout is a plain layered one, ordered to keep edges short; it is readable at 55 recipes and will want a better
  layout if the generator grows.

## Lineages, kin, and leaving (2026-09-13)

- **Colours follow blood.** Every founding village has a colour; a colony carries its parent's (`lineageOf` walks the
  parent chain). The map disc wears it, a colony gets a dark centre, party glyphs take their home's colour, the village
  panel shows a pennant. Hunger became a red ring rather than a fill, so it no longer fights the colour.
- **Kin.** At founding, colony and parent get `relation.kin` both ways with no grudge. Kin cannot be raided (the sim
  drops the order and the parser refuses it), the scripted host takes kin refugees in and gives kin what it can spare,
  and the chief's list of other villages says "our colony, our kin".
- **Abandon is an order, not an event.** `abandon: village` empties the village into one refugee party carrying what
  it can (food first, up to the carry limit), kills the village, and walks to the named village (or the nearest known).
  Refugees now ask on arrival, whoever they are (raid survivors included): a `VisitorArrived` with `mandate.refuge` set
  to their number, decided by the host chief like any envoy. Accepted, they join with their goods; refused, they go on
  to the nearest village that has not refused them, and when everyone has, they start asking again. Kept waiting past
  the envoy patience counts as a no. They eat rations on the road and can starve there, like any party.
- The scripted chief abandons only in extremity (hardship over 0.7, no stores, fifteen people or fewer, somewhere known
  within thirty tiles). The balance suite is unchanged by any of this.

## An ocean rim, and what it did to the fish (2026-09-13)

Every map now ends in sea: the outermost two to five tiles are ocean, with a noisy shoreline, so the edge of the world
reads as a coast rather than a cliff of nothing. The balance suite caught the side effect. A village of 50 on wild
food alone had held at a median of 43.75 people after 60 years; with the rim it held at 47 on twelve seeds, because
far more villages sit beside ocean tiles and ocean carried the richest fish stock of any tile (800 against the lake's
500). Ocean fished from the shore was cut to 550, which passed on six and twelve seeds, and then failed CI, which runs
the check on three: that sample's median was 46.25. At 450 it passes on three (36.25), six (39) and twelve (39) seeds
with the village-of-20 survival still at 92%, and the other checks are unchanged. Lesson kept: a median over three
seeds is a coin toss near the bar, so a change that touches geography gets checked on the CI sample too before it
ships. Existing saves keep their old maps.

## A long watch, and the chief who would not fish (2026-09-18)

The sim gained abandonment, kinship and refuge without anyone watching a world run with them. `pnpm harness --
playtest --seeds 4 --years 300` does that: scripted chiefs, so it is free, and it looks for what an assertion
cannot — mechanics that fire but never resolve, parties that never arrive, kin that raid kin, villages that stall.

The mechanics themselves came through clean. Across four worlds and twelve centuries every abandoned village's
people were taken in somewhere, none were lost on the road, the longest walk was ten weeks, and kin never raided
kin. Raids are zero, which is the scripted policy being reluctant rather than a bug, but it does mean the whole
tribute-and-threat apparatus is barely exercised in play.

What the watch found was a village that sat with no orders and no food for **fifty-five weeks** while its people
starved from seven down to one. The cause: the work loop excludes the chief from the workforce, so a village down to
a single adult has nobody who may be given an order. The policy correctly returns nothing, the sim correctly does
nothing, and the village dies with a chief standing in it. `workforce()` now lets the chief work when there are two
adults or fewer, or when stores are under two weeks: a chief who will not fish while the children die is not a chief.

The longest idle-and-starving run went from fifty-five weeks to one, and the watch reports nothing. Village deaths
across the four worlds fell from 31/28/28/28 to 22/13/19/14, and abandonments with them, because fewer villages
reach the point of hopelessness. The whole balance suite still passes; median final population drifts from about
3,400 to 2,757, which is the same worlds losing fewer villages to a silly death and more to ordinary crowding.

One wrong guess worth recording: the first hypothesis was that abandonment was failing to find a route and dropping
the order, leaving the village orderless. That was real — `abandonIfHopeless` picked the nearest village by straight
line, not by a road anyone could walk — and it is fixed, but it was not this. The trace was: print the village week
by week with its adults, its free workers and what the policy would say. `free=0` with `adults=1` gave it away in
one line.

## Forty years with a real chief, and the quota nobody would have seen (2026-09-18)

`run-chief playtest-live 40` puts one village under the real model for forty years. The village came through well:
twenty-two people, twenty weeks of food, nine skills, twenty-three recipes, content. Six hundred and twenty-one
decisions came from the model and the journals read as a person's.

Then from year 38 every entry says "the chief acted on habit; the spirit world was silent", and stays that way. Not
a flaky call: fourteen failures in a row. The proxy's own logs give the reason in one word, `quota`. The run had
used 2,001,158 tokens against a daily cap of 2,000,000.

Two things follow. The first is arithmetic worth knowing before inviting anyone: **one village with a real chief
costs about 52,000 tokens a game-year**, so the daily cap is about forty village-years. With the default setting of
three model villages that is thirteen game-years a day, which a player will reach in an afternoon.

The second is the real defect. When the budget runs out the chiefs do not stop; they quietly fall back to habit, and
the journal's own words for that are indistinguishable from a chief who had nothing to say. A player would conclude
the game had got boring. There is now a banner that says the day's thinking is spent, that the world keeps running
on habit, and when it comes back.

Whether 2,000,000 a day is the right number is a spending decision rather than a bug: it is roughly three to eight
dollars a day per invited player at Vertex prices, and it is the backstop that makes an open invitation safe.
