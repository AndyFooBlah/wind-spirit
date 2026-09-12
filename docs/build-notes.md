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
- **Proof:** one model-run village for three years: 50 model decisions, no fallbacks, 158k tokens, alive and discovering. A thirty-year run is recorded in `out/chief-*/journal.txt` when present.

## M4 and M5 groundwork in the sim and agents

- **Spirit inputs.** `SpiritSpoke` lands in the village's inbox and wakes the chief with reason `spirit`; the chief's `replyToSpirit` comes back as a `Prayer` input so it is in the log and can auto-pause the UI. `SpiritBreathed` applies nudge / override / storm / sail against the breath pool (cap 100, +0.25 a week; costs 15 / 50 / 80 / 10) and logs both the natural and the adjusted roll. Storms strike parties on the tile a week later: boats lose half their people and all cargo, land parties a quarter, and everyone loses a week; a "filled" sail is immune.
- **Claims and trust.** A dream conversation (`Conversation` in `packages/agents`) streams the chief's replies from the same village view, and on close one extraction call turns the spirit's words into claims: weather claims the sim checks itself when the season ends, "judged" claims the chief rules on at a later deliberation (the decision schema gained `verdicts`), and unverifiable ones. Fulfilled claims add up to +0.10 trust scaled by piety, failed ones cost 0.20, succession inherits 70%. The chief only ever sees trust as a sentence.
- **Replay.** `replayTo(snapshot, inputs, tick)` rebuilds any week from a snapshot and the inputs logged after it, with no model calls, and returns a world whose RNG state is synced (the bug the first test caught: a world handed off before `syncRng()` carried stale stream states).
- **Narrative.** `narrate()` renders a span of events and journals as a chronicle, saga, or plain summary with the capable model.
- **Prompt eval.** `packages/agents/src/eval-chief.ts` samples village states from a scripted run and scores live decisions: validity, workers within budget, most adults used, feeding first in winter, investing when able, journal in character, notes kept. First run: 8 of 8 samples pass every check, about 4 s per decision.
