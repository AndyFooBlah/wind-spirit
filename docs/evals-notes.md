# Lab notebook: where intelligence is worth spending

*Started 2026-09-12. Raw notes for a post; kept in the order things happened.*

## The question

A chief makes about 17 decisions a game-year at normal speed, each ~2,900 tokens in and ~300 out on Gemini 3.8 Flash ($0.75 / $3.75 per million through 2026): about $17 per chief per 300-year game, or $5 at fast cadence. Most of those decisions are "assign the same twelve adults to the same work as last season." A few are not: whether to pay tribute, whether to send settlers, how to answer a spirit who just predicted the weather. And a dream conversation with the player is a different thing again. The intuition to test: cheap models for the routine, a capable model for the impactful, the best model only for talking to a person.

## Price list (verified from the public pricing pages, 2026-09-12; per 1M tokens, input / output)

| Model | Input | Output | Cache read |
|---|---|---|---|
| Gemini 3.8 Flash (baseline) | $0.75 | $3.75 | $0.075 |
| Gemini 3.6 / 3.7 Flash | $0.75 | $3.75 | $0.075 |
| Gemini 3.5 Flash | $1.50 | $9.00 | $0.15 |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50 | $0.03 |
| Gemini 3.1 Flash-Lite | $0.25 | $1.50 | $0.025 |
| Gemini 2.5 Flash | $0.30 | $2.50 | $0.03 |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | $0.01 |
| Claude Haiku 4.5 | $1.00 | $5.00 | $0.10 (write $1.25) |
| Claude Sonnet 5 | $2.00 | $10.00 | $0.20 |
| Gemini 3.1 Pro (preview) | $2.00 | $12.00 | $0.20 |

Gemini prices double on 2027-01-01 for the 3.6+ Flash line. Open models on Vertex MaaS (Llama, Qwen, DeepSeek, gpt-oss) are priced per model; availability and prices are being verified with live calls and the Billing Catalog, see below.

Observation before any eval: Haiku 4.5 is not cheaper than 3.8 Flash on list price. Only the Flash-Lite line and 2.5 Flash are, by 2.5x to 9x on input and 1.5x to 9x on output. So the interesting question is whether a Flash-Lite or an open model holds up on the routine class.

## Building the reference corpus (2026-09-12)

I did not write cases by hand. The sim already produces every situation a chief faces, so the corpus builder (`packages/agents/src/evals/corpus.ts`) runs three seeds for a hundred years under the scripted chief and samples village states at fixed weeks. Each case stores the *village view*, the same structure the real prompt is built from, plus the facts the checkers need. Prompts are rendered at eval time, so prompt changes apply to old cases.

Categories, 96 cases in all:

| Category | Cases | How they are made | What a good answer must do |
|---|---|---|---|
| routine | 33 | seasonal deliberations, years 2 to 100, all seasons | valid orders within the adult budget, most adults used, food first (half of workers in winter), plant in spring and harvest in autumn, invest when a craftable skill is waiting, an in-character journal |
| crisis | 6 | the first famine per village per decade, plus autumn states with a hard winter rolled ahead | keep 60% on food, no ventures, keep planting; before a hard winter, hunt and fish and stock up |
| visitor | 15 | four constructed mandates on a sampled state: a fair trade, a greedy ask for all the grain, tribute demanded by a village a third the size, tribute demanded by one three times the size | accept or counter the fair one, refuse or counter the greedy one without giving away the eight-week reserve, refuse the weak bully, pay or bargain with the strong one |
| expansion | 12 | spring states where a colony site is known; a crowded, hungry village of 40+ versus a comfortable village under 30 | settle when crowded, stay when comfortable, never raid a village with no grudge |
| spirit | 15 | four whispers injected at trust 0.5: a true warning of a bitter winter, a false command to plant nothing, a question, a nudge to try a rumour | prepare for winter; still plant; reply to the question; research the rumour |
| dream | 15 | a spirit's line, sometimes after two earlier turns | prose, not JSON; in character; long enough to answer; mention a fact from the village when asked about stores |

The scripted policy's own answer is stored on each decision case as the habit baseline.

Scoring is deliberately mechanical: each check is a yes/no on the parsed decision, and the case score is the mean. An optional judge (the capable model) rates journals and dream replies 1 to 5 for character, grounding and coherence. For the impactful categories the report also shows agreement with a reference model on the decision class (accept / counter / refuse; settle / raid / stay).

First smoke run, Gemini 3.8 Flash on 14 cases: 0.99. The rule checks are a floor, not a ceiling; they exist to catch a cheap model failing the basics, and the judge and agreement columns are where the differences between models will show.

## The intelligence knob

Four tiers in `packages/agents/src/tiers.ts`, chosen per game: habit ($0, scripted chiefs; the model only for dreams), thrifty ($1 a century: cheap model for routine, standard for impactful, seasonal digests only), standard ($5: the current behaviour), lavish ($100: capable model for impactful decisions and the premium model for conversations). A decision is *impactful* when the reason is a visitor, a raid, a famine, a succession, a spirit message, or a seasonal decision where a settlement site is known and the village is 40 or more. Everything else is routine. The evals decide which model fills each slot.
