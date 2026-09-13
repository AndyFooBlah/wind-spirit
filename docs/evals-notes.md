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

## Correction: Vertex prices are not Gemini API prices (2026-09-12)

The proxy bills through Vertex AI, and the Cloud Billing Catalog says Gemini 3.8 Flash on Vertex is **$1.50 in / $7.50 out** per million, double the Gemini API list I used above (which was the 2026 promotional price on the API side). So the baseline chief is about $34 per century at normal cadence and $10 at fast, not $17 and $5. Flash-Lite and 2.5 Flash are the same on both ($0.30 / $2.50), and 2.5 Flash-Lite is $0.10 / $0.40. Every price in the model table now comes from the catalog SKUs or, where a model is billed through Marketplace, the pricing page, and is served by the proxy on `/v1/models` so the eval runner computes cost from the same numbers it is billed at.

## What is actually available without a click-through

Working through the service account today: the Gemini line (3.8, 3.6, 3.5 Flash; 3.5 and 3.1 Flash-Lite; 2.5 Flash and Flash-Lite; 3.1 Pro), and the open models offered as managed APIs that need no enablement: gpt-oss-120b ($0.09 / $0.36) and gpt-oss-20b, DeepSeek V3.2 ($0.56 / $1.68) and R1, Qwen3-235B ($0.22 / $0.88) and Qwen3-Next-80B, and Gemma 4 26B ($0.15 / $0.60). Three of those (DeepSeek V3.2, both Qwens) are already deprecated and retire on 2026-10-21, so they can inform the study but not the product.

Blocked behind a Model Garden "Enable" click that accepts partner terms, which no API call can do: every Claude model (Haiku 4.5 at $1.00 / $5.00, Sonnet 5), Llama 4 Maverick, Llama 3.3, and Mistral. The Anthropic adapter is written and untested until someone clicks.

Observation: on list price alone, nothing in the Claude line is cheaper than 3.8 Flash on Vertex except Haiku's input side, and the cheap tier is really a contest between Flash-Lite, 2.5 Flash, gpt-oss-120b and Gemma 4.

## Caching, as observed

Gemini caches implicitly: repeating a 7.5k-token prompt reported 4k cached tokens on the second 3.8 Flash call and most of the prompt cached on Flash-Lite from the first. Explicit caches need 4,096 tokens on the Gemini 3 family; our fixed prefix (persona plus world rules) is about 1,200 tokens, and the whole prompt is 3k to 8k, so explicit caching only pays for the biggest villages, and the proxy falls back below the minimum. Qwen reported the whole prompt cached on both calls; gpt-oss and DeepSeek never report cached tokens and have no cache-hit price, so caching does nothing for them. Anthropic caching needs 4,096 tokens on Haiku, which our prompts rarely reach. Conclusion: caching is a Gemini-side saving, mostly automatic, worth a few tens of percent on input, and input is the smaller part of the bill.

## First full pass (2026-09-12, 96 cases × 10 models, judge on)

Rule scores by category, judge (1 to 5, Gemini 3.1 Pro grading journals and dream replies), agreement with the Pro reference on visitor and expansion decisions, and measured cost per case at Vertex prices:

| model | all | routine | crisis | visitor | expansion | spirit | dream | judge | agree | $/case |
|---|---|---|---|---|---|---|---|---|---|---|
| Gemini 3.8 Flash (baseline) | 0.974 | 0.97 | 1.00 | 0.93 | 1.00 | 0.97 | 1.00 | 3.92 | 96% | 0.0070 |
| Gemini 3.5 Flash-Lite | 0.963 | 0.95 | 1.00 | 0.93 | 1.00 | 0.95 | 1.00 | 4.28 | 92% | 0.0016 |
| Gemini 3.1 Flash-Lite | 0.950 | 0.95 | 0.97 | 0.93 | 1.00 | 0.87 | 1.00 | 3.68 | 92% | 0.0019 |
| Gemini 2.5 Flash-Lite | 0.949 | 0.93 | – | 0.93 | 0.94 | 0.96 | – | – | – | 0.0004 |
| Gemini 3.1 Pro (reference) | 0.923 | 0.87 | 1.00 | 0.93 | 0.92 | 0.93 | 1.00 | 3.99 | – | 0.0168 |
| DeepSeek V3.2 | 0.774 | 0.73 | 0.67 | 0.93 | 0.75 | 0.57 | 0.98 | 4.30 | 88% | 0.0016 |
| gpt-oss-120b | 0.772 | 0.67 | 0.53 | 0.90 | 0.82 | 0.71 | 1.00 | 3.15 | 92% | 0.0008 |
| Gemma 4 26B | 0.764 | 0.72 | 0.67 | 0.93 | 0.76 | 0.49 | 1.00 | 4.19 | 92% | 0.0005 |

(2.5 Flash-Lite's row is from a rerun after fixing the thinking parameter; some columns were not yet aggregated when this was written. Qwen and Gemini 2.5 Flash were still rerunning.)

What jumped out:

1. **The Flash-Lite line is on par for this job.** 3.5 Flash-Lite loses one point on the rules and *gains* on the judge, at a quarter of the baseline's cost; 2.5 Flash-Lite is within 2.5 points at roughly a twentieth. On the impactful categories (crisis, visitor, expansion) the Lites are indistinguishable from 3.8 Flash. The one place the cheaper Geminis slip is the spirit category, and specifically the false-advice case: 3.1 Flash-Lite obeyed "plant nothing this spring" in 9 of 15 whispers where 3.8 Flash obeyed in 2. Cheap models are more credulous.
2. **The Pro reference scored *lower* on the rules than Flash**, mostly on routine cases (0.87), where it assigned fewer adults than the "most adults working" check wants, and it hit rate limits five times. The rule set rewards a busy village; Pro sometimes chose rest. A reminder that the checks encode my idea of a good chief, not a ground truth.
3. **The open models' scores were a format problem before they were a judgment problem.** Gemma, gpt-oss and DeepSeek dropped 180 to 220 orders each because the proxy asked their backends for strict JSON-schema decoding, and strict mode strips every optional field: every research order came back as `{task, workers}` with no ingredients, every gather with no commodity. Turning strict off and making the parser accept ingredients as a string and fuzzy-match misspelled names (both legitimate hardening) is the fix; those three are being rerun. Even so, their visitor and dream scores were already at the baseline, which says something: the *conversational* part of the job is easy for everyone; the *operational* part, keeping a hundred fiddly names straight, is where small models fall down.
4. **Gemini 2.5 rejects `thinking_level`.** It takes a token budget instead. Worth remembering for any mixed-model setup.
5. Cost per chief-century at normal cadence from the measured per-case costs: 3.8 Flash $13.64, 3.5 Flash-Lite $2.85, 3.1 Flash-Lite $3.53, Gemma 4 $0.93, gpt-oss $1.67; at fast cadence divide by about 2.5. The design's $5 standard tier is a 3.5 Flash-Lite village at normal cadence, or a 3.8 Flash village at fast.

## Final pass (2026-09-12): after fixing the format problems

Two fixes changed the open models' numbers completely. Constrained JSON decoding on the Vertex managed-API backends (gpt-oss, DeepSeek, Gemma, Qwen) returns every order as `{task, workers}` with the optional fields silently dropped, whether or not `strict` is set; asking those models for JSON in the instructions and validating instead gives complete orders. And Gemini 2.5 takes a thinking budget, not a level. The parser also now accepts ingredients as a string, `command` as an alias for `task`, and fuzzy-matches misspelled generated names, which is hardening the game needs anyway. Full table in `docs/evals/report-2026-09-12.md`; the corpus is beside it.

| model | all | routine | crisis | visitor | expansion | spirit | dream | judge | agree | $/case | s/case | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Gemini 3.8 Flash (baseline) | 0.974 | 0.97 | 1.00 | 0.93 | 1.00 | 0.97 | 1.00 | 3.92 | 93% | 0.0070 | 3.7 | 0 |
| Gemini 3.1 Pro (reference) | 0.968 | 0.97 | 1.00 | 0.93 | 1.00 | 0.92 | 1.00 | 3.92 | – | 0.0177 | 9.7 | 0 |
| gpt-oss-120b | 0.967 | 0.98 | 0.87 | 0.90 | 1.00 | 0.99 | 1.00 | 2.85 | 93% | 0.0007 | 6.0 | 0 |
| Gemini 3.5 Flash-Lite | 0.963 | 0.95 | 1.00 | 0.93 | 1.00 | 0.95 | 1.00 | 4.28 | 96% | 0.0016 | 1.6 | 0 |
| Gemini 2.5 Flash | 0.954 | 0.98 | 1.00 | 0.93 | 1.00 | 0.84 | 0.98 | 4.19 | 96% | 0.0013 | 2.5 | 0 |
| Gemini 3.1 Flash-Lite | 0.950 | 0.95 | 0.97 | 0.93 | 1.00 | 0.87 | 1.00 | 3.68 | 96% | 0.0019 | 3.7 | 0 |
| Gemini 2.5 Flash-Lite | 0.949 | 0.93 | 1.00 | 0.93 | 0.94 | 0.96 | 0.98 | 3.36 | 81% | 0.0004 | 1.7 | 0 |
| Gemma 4 26B | 0.852 | 0.95 | 0.83 | 0.93 | 0.83 | 0.69 | 0.73 | 4.04 | 96% | 0.0005 | 5.9 | 11 |
| DeepSeek V3.2 | 0.630 | 0.56 | 0.47 | 0.70 | 0.58 | 0.71 | 0.73 | 4.16 | 94% | 0.0012 | 10.0 | 33 |
| Qwen3-235B | 0.376 | 0.46 | 0.37 | 0.33 | 0.28 | 0.23 | 0.47 | 4.79 | 80% | 0.0005 | 8.5 | 51 |

Errors on the open models are all throttling ("request queue is full", "too many concurrent requests") at three concurrent calls, and the errored cases score zero, so DeepSeek's and Qwen's rows understate them. That throttling is itself a finding: the managed open models have far less headroom than Gemini, and three of the five are already scheduled for retirement next month.

### What the numbers say

1. **The routine work needs almost no intelligence.** Every model that could produce valid orders scored 0.93 to 0.98 on routine seasons, including a 2.5 Flash-Lite that costs a twentieth of the baseline. The scripted policy does this job too. Where the money goes in a routine decision is the journal, the only part a player reads.
2. **The impactful categories separate models less than expected.** Visitor decisions were 0.93 for nearly everyone (the same two cases trip every model: a greedy ask that most models counter rather than refuse). Expansion was perfect for every Gemini and gpt-oss. Crisis is where the small open models slip (0.47 to 0.87): keeping enough hands on food during a famine and preparing for a hard winter.
3. **Spirit is the discriminating category, and it is about credulity.** The false-advice case ("plant nothing this spring") was obeyed by 2.5 Flash in 7 of 15 whispers and by 3.1 Flash-Lite in 9, against 2 for 3.8 Flash. A cheap chief is an obedient chief, which is exactly wrong for a game whose scoreboard is trust the player has to earn.
4. **Prose quality is the real price of going cheap.** gpt-oss-120b ties the baseline on rules and beats it on cost tenfold, but the judge puts its journals at 2.85 against 3.92 for 3.8 Flash and 4.28 for 3.5 Flash-Lite. The Flash-Lite journals read better than 3.8 Flash's to the judge, at a quarter of the cost.
5. **The Pro reference is not better at this.** Same rules score as Flash, same judge score, three times the cost and latency. For decisions of this shape, a capable model buys nothing; it may buy something in dreams, which this corpus scores leniently.
6. **Caching only pays on Gemini**, and only a few tens of percent on input, which is the smaller half of the bill. Anthropic's minimum of 4,096 tokens is above most of our prompts, and the open models either do not report or do not price cached tokens. This is not a reason to move off Gemini; combined with throttling and deprecations on the open side, it is a reason to stay.

### Decisions

- Proxy classes: **cheapest = Gemini 2.5 Flash-Lite, cheap = 3.5 Flash-Lite, routine = 3.8 Flash, capable = premium = 3.1 Pro.**
- Tiers, as shipped in the app's settings, per chief per century at normal cadence from measured per-case costs: **habit** $0 (scripted, model only for dreams); **thrifty** ~$1.16 (2.5 Flash-Lite routine, 3.5 Flash-Lite impactful); **standard** ~$5.07 (3.5 Flash-Lite routine, 3.8 Flash impactful), the default; **lavish** ~$16 (3.8 Flash routine, Pro impactful and dreams). At fast cadence divide by roughly 2.5. There is no useful way to spend $100 a century on today's models for this job; the lavish tier leaves that headroom for longer thinking or bigger prompts later.
- Claude Haiku 4.5 and Llama 4 stay untested until someone clicks Enable in the Model Garden; on list price Haiku would land between 3.8 Flash and Pro, so it is a quality question, not a cost one.

### Limitations, for honesty

The judge is Gemini 3.1 Pro grading Gemini and others; the rule checks encode one opinion of a good chief and top out near 0.97 for strong models; the corpus is sampled from scripted play, so it under-represents the messy states model chiefs get themselves into; one pass per model at temperature 0.7; dreams are scored only for form. A second judge from another family and a repeat run would tighten the small gaps (3.5 Flash-Lite versus 3.8 Flash is within noise on rules and reversed on the judge).
