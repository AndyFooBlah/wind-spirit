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
