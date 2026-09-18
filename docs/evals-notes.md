# Lab notebook: where intelligence is worth spending

*Started 2026-09-12. Raw notes for a post; kept in the order things happened.*

## The question

A chief makes about 17 decisions a game-year at normal speed, each ~2,900 tokens in and ~300 out on Gemini 3.8 Flash ($0.75 / $3.75 per million through 2026): about $17 per chief per 300-year game at Gemini API prices, or $5 at fast cadence (corrected below: Vertex bills double, so $34 per chief-century at normal cadence). Most of those decisions are "assign the same twelve adults to the same work as last season." A few are not: whether to pay tribute, whether to send settlers, how to answer a spirit who just predicted the weather. And a dream conversation with the player is a different thing again. The intuition to test: cheap models for the routine, a capable model for the impactful, the best model only for talking to a person.

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
3. **Spirit is the discriminating category, and it is about credulity.** The false-advice case ("plant nothing this spring") has 10 instances in the corpus; counting `stillPlants: false` in the archived results: 3.8 Flash obeyed 2 of 10, 3.5 Flash-Lite 4, 3.1 Flash-Lite 9, 2.5 Flash 9, GPT-5 nano 10, Claude Haiku 5, and, oddly, 3.1 Pro 6. (An earlier draft of this note quoted counts out of 15; those were wrong.) A cheap chief is an obedient chief, which is exactly wrong for a game whose scoreboard is trust the player has to earn.
4. **Prose quality is the real price of going cheap.** gpt-oss-120b ties the baseline on rules and beats it on cost tenfold, but the judge puts its journals at 2.85 against 3.92 for 3.8 Flash and 4.28 for 3.5 Flash-Lite. The Flash-Lite journals read better than 3.8 Flash's to the judge, at a quarter of the cost.
5. **The Pro reference is not better at this.** Same rules score as Flash, same judge score, three times the cost and latency. For decisions of this shape, a capable model buys nothing; it may buy something in dreams, which this corpus scores leniently.
6. **Caching only pays on Gemini**, and only a few tens of percent on input, which is the smaller half of the bill. Anthropic's minimum of 4,096 tokens is above most of our prompts, and the open models either do not report or do not price cached tokens. This is not a reason to move off Gemini; combined with throttling and deprecations on the open side, it is a reason to stay.

### Decisions

- Proxy classes: **cheapest = Gemini 2.5 Flash-Lite, cheap = 3.5 Flash-Lite, routine = 3.8 Flash, capable = premium = 3.1 Pro.**
- Tiers, as shipped in the app's settings, per chief per century at normal cadence from measured per-case costs: **habit** $0 (scripted, model only for dreams); **thrifty** ~$1.16 (2.5 Flash-Lite routine, 3.5 Flash-Lite impactful); **standard** ~$5.07 (3.5 Flash-Lite routine, 3.8 Flash impactful), the default; **lavish** ~$16 (3.8 Flash routine, Pro impactful and dreams). At fast cadence divide by roughly 2.5. There is no useful way to spend $100 a century on today's models for this job; the lavish tier leaves that headroom for longer thinking or bigger prompts later.
- Claude Haiku 4.5 and Llama 4 stay untested until someone clicks Enable in the Model Garden; on list price Haiku would land between 3.8 Flash and Pro, so it is a quality question, not a cost one.

### Limitations

The judge is Gemini 3.1 Pro grading Gemini and others; the rule checks encode one opinion of a good chief and top out near 0.97 for strong models; the corpus is sampled from scripted play, so it under-represents the messy states model chiefs get themselves into; one pass per model at temperature 0.7; dreams are scored only for form. A second judge from another family and a repeat run would tighten the small gaps (3.5 Flash-Lite versus 3.8 Flash is within noise on rules and reversed on the judge).

## OpenRouter (2026-09-12, evening)

Andrew has an OpenRouter account, which sidesteps the Model Garden click-through for Claude and Llama and opens the rest of the market. Their public model list (445 models, prices per token) shows, per 1M tokens in / out:

| model | in | out | note |
|---|---|---|---|
| openai/gpt-5-nano | 0.05 | 0.40 | |
| z-ai/glm-5.3-flash | 0.15 | 0.50 | |
| xiaomi/mimo-v2.5 | 0.14 | 0.28 | |
| qwen/qwen3.8-flash | 0.15 | 0.47 | |
| meta-llama/llama-4-maverick | 0.20 | 0.70 | |
| openai/gpt-5-mini | 0.25 | 2.00 | |
| deepseek/deepseek-v3.2 | 0.27 | 0.40 | |
| minimax/minimax-m2.7 | 0.30 | 1.20 | |
| mistralai/mistral-medium-3.1 | 0.40 | 2.00 | |
| z-ai/glm-4.7 | 0.40 | 1.75 | |
| moonshotai/kimi-k2.5 | 0.45 | 2.25 | |
| google/gemini-3.8-flash | 0.75 | 3.75 | half the Vertex price |
| anthropic/claude-haiku-4.5 | 1.00 | 5.00 | |
| anthropic/claude-sonnet-5 | 2.00 | 10.00 | |

The last Gemini row is its own finding: OpenRouter resells Gemini at the Gemini API price, which is half what Vertex charges for 3.8 Flash. The trade is an API key held in Secret Manager instead of a service account, OpenRouter's margin on credits, and one more hop of latency. The proxy gains an `openrouter` provider; the key is `unset` until Andrew pastes it, and the provider reports itself disabled until then. Candidates to run: the fourteen above.

## OpenRouter pass (2026-09-12, night): 24 more models, same 96 cases, same judge

Full table in `docs/evals/report-2026-09-12-openrouter.md`. The rows that matter, sorted by rules score; cost is OpenRouter's own reported cost per case (credits, USD):

| model | all | routine | crisis | spirit | judge | agree | $/case | s/case | errors |
|---|---|---|---|---|---|---|---|---|---|
| Mistral Medium 3.1 | 0.984 | 1.00 | 1.00 | 0.99 | 4.21 | 74% | 0.0013 | 2.2 | 0 |
| GPT-5.4 nano | 0.978 | 0.97 | 1.00 | 0.99 | 3.48 | 93% | 0.0013 | 5.0 | 0 |
| Claude Sonnet 5 | 0.975 | 0.97 | 1.00 | 0.97 | 3.88 | 96% | 0.0144 | 9.4 | 0 |
| GPT-5.6 Luna | 0.975 | 0.97 | 1.00 | 0.97 | **4.46** | 93% | 0.0011 | 6.0 | 0 |
| Gemini 3.8 Flash (Vertex, baseline) | 0.974 | 0.97 | 1.00 | 0.97 | 3.92 | 93% | 0.0070 | 3.7 | 0 |
| GLM 5.3 Flash | 0.972 | 0.97 | 0.93 | 1.00 | 3.92 | 93% | **0.0005** | 5.7 | 0 |
| Nemotron 3 Ultra | 0.970 | 0.97 | 1.00 | 0.93 | 3.81 | 100% | 0.0063 | 7.7 | 0 |
| GPT-5 mini | 0.970 | 0.97 | 1.00 | 0.93 | 3.51 | 100% | 0.0022 | 10.7 | 0 |
| Llama 4 Maverick | 0.965 | 0.96 | 1.00 | 0.97 | 3.45 | **48%** | 0.0007 | 3.9 | 0 |
| Gemini 3.5 Flash-Lite (Vertex) | 0.963 | 0.95 | 1.00 | 0.95 | 4.28 | 96% | 0.0016 | 1.6 | 0 |
| Kimi K3 | 0.959 | 0.92 | 0.97 | 0.99 | 4.29 | 85% | 0.0125 | 13.8 | 2 |
| Gemini 3.8 Flash via OpenRouter | 0.952 | 0.95 | 1.00 | 0.89 | 4.36 | 89% | 0.0029 | 3.8 | 0 |
| Claude Haiku 4.5 | 0.949 | 0.95 | 0.97 | 0.93 | 3.85 | 89% | 0.0084 | 11.7 | 0 |
| GPT-5 nano | 0.949 | 0.97 | 1.00 | 0.84 | 3.10 | 93% | 0.0005 | 6.7 | 0 |
| MiniMax M2.7 | 0.948 | 0.93 | 0.97 | 0.95 | 3.80 | 89% | 0.0025 | 22.0 | 0 |
| DeepSeek V4.1 Flash | 0.924 | 0.85 | 0.80 | 0.99 | 3.85 | 93% | 0.0031 | 32.3 | 5 |
| Nemotron 3 Super | 0.912 | 0.91 | 0.93 | 0.79 | 3.36 | 92% | 0.0009 | 47.8 | 4 |
| DeepSeek V4 Pro / V4 Flash / V3.2, MiMo, GLM 4.7, Kimi K2.5, Qwen 3.8 Flash | 0.30 to 0.82 | | | | | | | 50 to 74 | 15 to 67 |

The bottom group's errors are almost all proxy timeouts at 120 s: these reasoning models think for a minute per decision at our 6,000-token cap, and a few runs also outlived the hour-long anonymous token. Their scores understate them, but a chief that takes a minute to decide is out of the running for a game regardless, so I did not rerun them with thinking off.

What changed in my reading:

1. **There are now four models that beat or tie the baseline on the rules at a fifth of its cost or less:** Mistral Medium 3.1, GPT-5.4 nano, GPT-5.6 Luna and GLM 5.3 Flash. Luna is the standout: best judge score of any model (4.46), clean rules, $0.0011 a decision, six seconds. GLM 5.3 Flash is the price floor for "on par": $0.0005, about $1 a chief-century at normal cadence.
2. **Agreement with the reference is where the cheap winners split.** Mistral passes the rules but agrees with the Pro reference on only 74% of the impactful decisions; Llama 4 Maverick only 48%. Reading the disagreements: Mistral and Llama refuse or counter where the reference accepts, and stay put where the reference settles. The rules allow both, so this is temperament rather than error, but for a game where every chief has a personality it is worth knowing that these two are systematically more cautious than Gemini or GPT.
3. **Claude Haiku 4.5 is not the answer here.** Slower than the baseline (11.7 s), dearer per decision ($0.0084), and a point below on the rules. Sonnet 5 matches the baseline exactly on rules and judge at twice the price. The Claude line earns its keep on dreams if anywhere, and the dream category here is too easy to show it.
4. **Gemini through OpenRouter is cheaper and slightly worse.** 3.8 Flash cost $0.0029 a case via OpenRouter against $0.0070 on Vertex, but scored 0.952 against 0.974 and slipped on the spirit cases. Most likely the thinking configuration differs on that route (OpenRouter maps our level to `reasoning.effort`). Worth a controlled check before ever moving the default.
5. **Latency is a first-class axis.** The Vertex Flash-Lites answer in 1.6 s; the interesting OpenRouter models take 5 to 7 s; several take 30 to 70. At normal speed a chief has two seconds a week, so anything above about 5 s falls back to habit orders while it thinks. The proxy's provisional-orders rule hides this, but slow chiefs are less present in the game.

### Decisions after the OpenRouter pass

- **Defaults stay on Vertex Gemini**: cheapest 2.5 Flash-Lite, cheap 3.5 Flash-Lite, routine 3.8 Flash, capable Pro. Reasons: first-party auth with no key to guard, the fastest responses in the study, and quality within noise of the best cheap alternatives.
- **OpenRouter models are available by env var** as alternatives for any class, with a recommendation recorded here: `openai/gpt-5.6-luna` for `cheap` when journal quality matters most (best prose in the study at $0.0011), `z-ai/glm-5.3-flash` for `cheapest` on price ($0.0005), `mistralai/mistral-medium-3.1` if a more cautious temperament is wanted. Flipping a class is one env var and a redeploy.
- Not adopted: Claude Haiku (slower and dearer for equal or lower quality), Llama 4 (temperament far from the reference), every model over 20 s a decision.

### Cost of the study

Roughly $9 of Vertex and $13 of OpenRouter credits across 34 models × 96 cases plus judging, about $22 in all, which is less than one century of a single baseline chief at normal cadence.


## Post published (2026-09-12)

https://andrewbrook.dev/writing/wind-spirit-chief-models/ with five charts, five quoted cases, and six screenshots from a live game. One live-game observation from taking those screenshots deserves a follow-up rather than a caption: in a fresh small world, the standard-tier chief's first spring decision put six adults on wood and five on stone with nobody on food, and 21 people went hungry by week ten. The eval's feeds-first check passes 95 to 98% for these models, so this is a rare miss, but a first-turn miss is the one a new player sees. Candidate fix: a provisional habit order already covers the thinking gap; the same rule could veto any model decision that leaves food work under a floor while stores are short, with a journal note. Not changed yet, to keep the evals comparable.

## The standard tier's first spring (2026-09-12, late)

Playing the deployed game, the standard tier (3.5 Flash-Lite routine, 3.8 Flash impactful) sometimes left
nobody gathering food in the very first spring. The 96-case corpus never saw it: its earliest routine case
is week 110, by which time the scripted policy had already built stores. So the first thing to fix was the
eval, not the model.

`evals/first-turn.ts` reproduces the moment: three fresh seeds, three repetitions each, raw model output
(no scheduler guard), counting first-spring decisions with nobody on food or under 30% on food.

| prompt | 3.5 Flash-Lite nobody / under 30% | 3.8 Flash nobody / under 30% |
|---|---|---|
| as shipped | 8/9 · 9/9 | 0/9 · 9/9 |
| + cadence line ("you decide once a season, thirteen weeks") | 6/9 · 9/9 | 0/9 · 7/9 |
| + food arithmetic section + menu rule | 0/9 · 1/9 | 0/9 · 0/9 |

The prompt said "food for 7 weeks" and nothing else. A chief who does not know a decision lasts thirteen
weeks, or how much a forager brings in, reads seven weeks as comfortable. Two additions fixed it: the
world-rules line now states the cadence and that stores with nobody gathering are gone in that many
weeks, and a new section does the arithmetic out loud ("the village eats N units a week; one worker
brings in about F foraging, H hunting, S fishing"). The menu also says the village will overrule an order
that starves it, and the scheduler now does exactly that (`foodFloor`): when stores are under a season, at
least a third of free hands go to the best food source, and the journal records the overrule. The prompt
did the work; the guard is the backstop. A wake-up at four weeks of stores was tried and dropped: it
perturbed the forager stress test in the balance suite (88% survival against a 90% bar, 92% with the old
two-week trigger), and the arithmetic had already fixed the cause.

## Reviewing the golden answers (2026-09-12, late)

Golden errors are the usual thing in a hand-built eval, so `evals/audit.ts` looks for them the cheap way:
take the twelve strongest clean runs, and list every (case, check) pair that at least half of them fail.
A check that most strong models fail is more likely wrong than they are. It found four kinds of error.

- **Asked for the impossible.** `harvestsInAutumn` fired on three cases where nothing was planted, and
  `plantsInSpring` on one where nothing was cleared. Nobody can harvest an empty field. Both now apply
  only when there is something to harvest or plant; `stillPlants` (the false-fallow rumour) likewise.
- **Never stated the threat.** The two `threat-weak` visitor cases expected "refuse", and every strong
  model accepted or countered. Reading their reasons ("a small ask beside our full granary; goodwill")
  showed why: the prompt rendered a threatening mandate as "they demand tribute: nothing. They ask for:
  8 grain", so the chief saw a small request from a small party, not extortion. The prompt now says what
  the envoys actually say ("their warriors will come and take it, and more, if you refuse") and the menu
  adds a line about weighing strength and what paying once teaches. Under that prompt 3.8 Flash, 3.5
  Flash-Lite and GPT-5.6 Luna refuse (Luna pays once in one of the two). The golden stands; the case had
  been unanswerable as written.
- **Too strict when rich.** `feedsFirst` demanded 30% of hands on food in every routine case, including
  villages with 120 to 218 weeks of stores. All eight of 3.8 Flash's routine misses were exactly this: a
  season of building with a year of grain in the granary. The rule now binds only under 52 weeks of stores.
- **Corpus drift.** Rebuilding the corpus after the sim change produced different villages at the same
  ticks (27 of 96 ids changed), so rescoring old outputs against the new corpus silently mis-scored them
  (the parser resolved names against views the model never saw). Every model in the tables below was
  re-run from scratch on the new 102-case corpus (the old 96 plus six first-spring cases). The archived
  corpus and results from the earlier passes stay under `docs/evals/` for the record.

Gemini 3.8 Flash's own misses after the corrections, for the record: two in 102. It stopped planting once in
ten false-fallow cases because a spirit said the field was cursed, and it skipped the research a true rumour
pointed at once. The last audit pass leaves one borderline check, `keepsReserve` on a greedy-visitor case
that six of twelve strong models fail (a village with 25 weeks of food giving away a little more than the
rule allows); it stays, flagged.

Latency bar: anything over 10 s a decision is a bad experience even for impactful calls, since the village
sits on provisional orders while the chief thinks. Models over the bar are marked ✗ in the report and are
out of the running whatever they score.

## Third pass (2026-09-13): 25 models × 102 cases under the corrected corpus, checks and prompt

Every model re-run from scratch (the rebuilt corpus changed 27 village ids, so old outputs could not be
rescored), judge on, transient 429/timeouts retried once at concurrency 1. Results in `docs/evals/results/`,
the corpus in `corpus-2026-09-13.json`, the full table in `report-2026-09-13.md`. The earlier pass is kept
under `results-2026-09-12-pass2/`.

| model | score | s / decision | judge (1–5) | cost, 102 cases |
|---|---|---|---|---|
| gemini-3.8-flash | 0.996 | 3.8 | 4.09 | $0.75 |
| moonshotai/kimi-k3 | 0.993 | 14.6 ✗ | 3.99 | $1.43 |
| mistralai/mistral-medium-3.1 | 0.988 | 2.3 | 4.04 | $0.14 |
| anthropic/claude-sonnet-5 | 0.983 | 10.8 ✗ | 4.05 | $1.64 |
| gemini-3.1-pro-preview | 0.980 | 8.6 | 4.24 | $1.87 |
| openai/gpt-5.6-luna | 0.980 | 7.0 | 4.36 | $0.12 |
| google/gemma-4-26b (MaaS) | 0.978 | 2.3 | 3.98 | $0.06 |
| z-ai/glm-5.3-flash | 0.974 | 5.8 | 3.55 | $0.06 |
| openai/gpt-5-mini | 0.973 | 10.2 ✗ | 3.53 | $0.26 |
| anthropic/claude-haiku-4.5 | 0.973 | 12.3 ✗ | 3.69 | $0.90 |
| meta-llama/llama-4-maverick | 0.970 | 2.9 | 3.13 | $0.07 |
| qwen/qwen3-235b (MaaS) | 0.968 | 4.3 | 3.88 | $0.10 |
| gemini-3.5-flash-lite | 0.964 | 1.6 | 4.05 | $0.17 |
| openai/gpt-oss-120b (MaaS) | 0.962 | 6.9 | 3.00 | $0.08 |
| nvidia/nemotron-3-ultra | 0.958 | 11.6 ✗ | 3.79 | $0.85 |
| deepseek/deepseek-v4.1-flash | 0.954 | 31.1 ✗ | 3.86 | $0.38 |
| gemini-2.5-flash | 0.950 | 2.1 | 3.95 | $0.14 |
| gemini-3.1-flash-lite | 0.948 | 4.0 | 3.32 | $0.22 |
| openai/gpt-5.4-nano | 0.946 | 5.2 | 3.55 | $0.14 |
| gemini-2.5-flash-lite | 0.943 | 1.5 | 3.33 | $0.04 |
| openai/gpt-5-nano | 0.933 | 8.1 | 3.49 | $0.06 |
| deepseek-ai/deepseek-v3.2 (MaaS) | 0.841 | 8.9 | 3.89 | $0.18, 14 throttled |

✗ = over the 10 s bar, out whatever the score. The eight slowest models from the earlier passes (DeepSeek V4
Pro and Flash, V3.2 on OpenRouter, MiMo, GLM 4.7, Kimi K2.5, Qwen 3.8 Flash, Nemotron Super) were not re-run:
they were 50 to 75 s a decision and no scoring change rescues that.

What changed against the second pass, and why it matters:

- **The corrected checks moved everyone up by roughly the same amount**, so the ranking is the same at the
  top: Gemini 3.8 Flash first, Mistral Medium 3.1 the cheapest thing within a hair of it, GPT-5.6 Luna the
  best prose (judge 4.36) at a sixth of the cost. Gemma 4 26B on Vertex MaaS jumped from 0.85 to 0.98 and
  Qwen 3 235B from 0.38 to 0.97: both had been hurt by the constrained-decoding bug fixed after their first
  pass, so their old scores were the bug's, not theirs.
- **The first-spring cases are now in the corpus (six of them) and every model over 0.95 passes them all**
  under the new prompt. The failure that started this pass no longer exists to measure.
- **Latency reshuffles more than scoring does.** Kimi K3 scores second and is out at 14.6 s; Sonnet 5 fourth
  and out at 10.8 s. The tiers stay as shipped: 3.5 Flash-Lite routine, 3.8 Flash impactful, 3.1 Pro for
  conversation.
- **Cost of this pass**: about $13 across 25 models plus judging.

## Fourth pass (2026-09-17): the judgments that are not prose — Jev against the LLMs

The credulity finding from the earlier passes suggested a decision model might be worth a look, so the three chief
judgments that are already a label or a binary — act on a spirit's whisper, verdict on a claim now due, answer to
envoys — went behind a `Judge` adapter with two implementations: TypeSafe System One (Jev) and a normal model
through the proxy. Both get the *same* compact state (a few hundred tokens of named JSON, not the ~2,900-token
decision prompt) and the same questions, so the comparison measures the judgment and not the prompt.

Credibility is deliberately two Nouls rather than one: does the whisper agree with what the village has seen
(`consistent`), and would the village be worse off for obeying (`harmful`). Code composes them as
`p = consistent × (1 − harmful)`. That keeps the believe/ignore threshold a game parameter instead of a model's
opinion, which is the whole point: a pious chief can act at p = 0.3, a skeptic hold out for 0.8.

### Correction to the earlier notes

The credulity numbers quoted in the second-pass section ("3.1 Flash-Lite obeyed 9 of 10, GPT-5 nano 10") are from
*before* the prompt and corpus corrections. Under the 2026-09-13 corpus the shipped tiers look far better:
3.8 Flash obeys the false-fallow lie 1 of 10, 2.5 Flash-Lite 1 of 10, 3.5 Flash-Lite 4 of 10. The spread across all
25 models is still 0/10 to 10/10, so credulity does vary wildly by model — but the tiers as shipped are not the
credulous end of it, and any claim built on the old numbers needs restating.

One oddity worth keeping: the same model routed two ways disagrees sharply. Vertex `gemini-3.8-flash` obeys 1 of 10;
OpenRouter `google/gemini-3.8-flash` obeys 7 of 10. Same corpus, same checks. At n = 10 and temperature 0.7 that may
be nothing but sampling, which is itself the point — a single pass of ten cases cannot settle how credulous a model is.

### The result that reframes it

**Asked the narrow question on its own, every model gets credulity right.** Not just the good ones:

Three passes over the 2026-09-13 corpus, 216 judgments each:

| judge | credibility | verdict | host | overall | ms / judgment | $ / 216 |
|---|---|---|---|---|---|---|
| jev-1.13.0 | 35/36 | **131/135** | **45/45** | **97.7%** | **152** | **0.0074** |
| gemini-2.5-flash-lite | **36/36** | 107/135 | **45/45** | 87.0% | 592 | 0.0130 |
| gemini-3.5-flash-lite | 33/36 | 113/135 | 42/45 | 87.0% | 658 | 0.0512 |
| gemini-3.8-flash | 33/36 | 111/135 | 40/45 | 85.2% | 2,248 | 0.4014 |

Note the ordering: the most expensive model is the worst overall, at 54x Jev's cost and 15x its latency. Nothing
about this job rewards a bigger model.

So the credulity defect was never a failure of judgment. It is a failure of the *combined* prompt: a model asked
for twenty orders, a journal, memory notes and a reply to the spirit in one shot sometimes obeys the lie; the same
model asked only "should the chief act on this?" does not. **The fix is decomposition, and it works whoever answers.**

That is worth saying plainly because it changes what Jev is for here. It is not better at these judgments. It is
*equal* on credibility, *much* better on verdicts (97% against 79%, and it never once called a well-stocked village
hungry), equal on host answers, about 4x faster and about 1.8x cheaper than the cheapest Gemini.

### Host answers, and a live problem in the standard tier

Visitor decisions have sat at 0.93 for all 25 models across three passes, with the same greedy-ask cases tripping
everyone. Pulled out as a standalone judgment the greedy cases stop being hard: every judge here goes 9/9 on greedy
and 30/30 on fair. That ceiling was the prompt, not the models.

What the decomposition exposes instead is the **threat-weak** case — tribute demanded by a village a third our size,
where the right answer is to refuse:

| judge | threat-weak (want refuse) | what it actually answered |
|---|---|---|
| jev-1.13.0 | **6/6** | refuse 6 |
| gemini-2.5-flash-lite | **6/6** | refuse 6 |
| gemini-3.5-flash-lite | 3/6 | accept 3, refuse 3 |
| gemini-3.8-flash | 1/6 | **accept 5**, refuse 1 |

3.8 Flash pays the bully five times in six. That is the model the standard tier uses for visitors today, so this is
not a hypothetical: a standard-tier village hands tribute to anyone who asks, however weak. The end-to-end corpus
never caught it because visitor scores average over fair cases (10 of 15) that everything gets right.

### Verdicts

There are no verdict cases in the corpus, so the runner builds a probe: three claims paired with village states
whose own facts settle them. `hunger` ("your stores will not carry you to the next harvest") and `faraway` (a claim
about country the village has never seen) have clean ground truth; Jev gets 45/45 on both. The `deaths` claim is
weaker ground truth — `deathsRecent = 0` mid-season reads as "failed" to the checker and arguably "not yet settled"
to a judge — and it is where both judges lose most of their points. Read the 97% with that caveat.

### Cost, honestly

Jev's advantage is smaller than its per-token price suggests: $42/Btok against 2.5 Flash-Lite's $0.30/Mtok in and
$0.40 out looks like a rout, but Jev bills the questions and criteria as input too, so 216 judgments cost 176k input
tokens against the LLM's 111k. Net, 1.8x cheaper than the cheapest usable Gemini and 47x cheaper than 3.8 Flash.
Either way these are cents per chief-century — nobody should choose a judge on this.

### Stability, measured rather than assumed

Jev is not more deterministic than the LLMs, which is worth recording because it is the opposite of what I expected.
Counting cases whose answer changed across the three passes: Jev 7 of 72, 2.5 Flash-Lite 1, 3.5 Flash-Lite 8,
3.8 Flash 4. Five of Jev's seven are `fair` visitor cases flipping between `accept` and `counter`, and the corpus
accepts either, so they cost nothing — that is the model being genuinely indifferent between two good answers, which
is the documented behaviour of a spread distribution, not noise. Only two flips cross a correctness boundary, and
one of those is the true-rumor case sitting on the threshold at p = 0.485.

On correctness the per-pass spread is small for everyone: Jev 97.2 / 97.2 / 98.6, the Flash-Lites 87.5 / 87.5 / 86.1,
3.8 Flash 83.3 / 86.1 / 86.1. Pick a judge on accuracy and cost, not on stability.

### Decision

Ship the adapter with **Jev as the default** for all three: it wins verdicts outright (97% against 79–84%), ties the
best LLM on credibility and host answers, and is 4x faster and 1.8x cheaper than the cheapest Gemini that keeps up.
2.5 Flash-Lite is the fallback and is genuinely close — which is the real headline. **Most of the gain here comes
from asking the question on its own, not from who answers it.**

Two things to fix regardless of judge: the standard tier's visitor model caves to weak threats, and the believe /
ignore threshold wants to sit near 0.4 rather than 0.5 on the evidence so far.

## Side experiment: can a System One model allocate labour? (2026-09-17)

The open question is whether a model that returns typed judgments can produce what a chief actually needs — a
variable list of actions, each with its own arguments. The naive framing ("should I do action x?" per action) has no
budget and no ranking, so the probe (`src/evals/probe-allocation.ts`) tries the next thing up: one comparable
**Score** per candidate task — *of this village's N free hands, what share belongs on hunting this season* — plus one
**Choice** for the season's purpose, all in a single request over the same state. Code, not the model, normalises the
score vector onto the adult budget, so the sum is right by construction and no order can exceed it.

It passes every mechanical check, and the allocation is useless:

| | tasks used | largest task's share |
|---|---|---|
| scripted policy (habit) | 4–6 | 0.27–0.43 |
| Jev scores, straight normalisation | 9.9 | 0.17 |

One hand on each of ten tasks. Independent Scores cannot see one another, so ten tasks all rated "a good share"
normalise to near-uniform. Note the checks do not catch this at all — `withinBudget`, `usesMostAdults` and
`feedsFirst` are all satisfied by an even spread. That is a hole in the checkers as much as a finding about Jev.

The useful part: the ranking information is in the score vector, and concentration is recoverable in code with no
further calls.

| gamma | purpose weight | tasks used | largest share |
|---|---|---|---|
| 1 | 1 | 9.9 | 0.17 |
| 1 | 3 | 9.1 | 0.29 |
| 3 | 1 | 7.6 | 0.35 |
| 3 | 3 | 6.5 | 0.42 |
| 6 | 1 | 5.0 | 0.59 |
| 6 | 3 | 4.2 | 0.65 |

`gamma` sharpens the vector before normalising; `purpose weight` boosts the tasks the season's purpose favours.
Around gamma 3 the shape sits where the scripted policy sits. So the flatness was an artifact of naive
normalisation, not of the model's judgment — and because it is pure post-processing, the knob can be turned without
re-running inference, which is the property that makes score vectors worth storing.

What this does **not** show: that a gamma-3 allocation *plays* better. The checkers cannot tell flat from
concentrated, so the only real test is running it in the sim against the scripted policy over a century. Arguments
(which commodity, which recipe, how many plots) are untouched here and are the harder half — though a Choice over
the view's own candidate list would make the misspelled-name failures in `parse.ts` structurally impossible.

## The tribute case was mis-specified, not the model (2026-09-18)

Issue #28 reported that the standard tier pays tribute to weak bullies: `gemini-3.8-flash` accepted five of six
`threat-weak` mandates, where Jev and 2.5 Flash-Lite refused all six. The conclusion was that 3.8 Flash is too soft
on the tier the game ships. Checking the case against the sim's own raid model says otherwise.

`threat-weak` built its war band as `max(5, pop / 3)`, a third of the *whole village*. A raid is resolved on adults.
For the corpus's two cases that is eight attackers against eleven adults, and nine against fifteen. Running the sim's
own combat formula twenty thousand times:

| attackers | adult defenders | raid succeeds |
|---|---|---|
| 3 | 11 | 0.00 |
| 6 | 11 | 0.10 |
| 8 | 11 | 0.41 |
| 9 | 11 | 0.60 |
| 12 | 11 | 0.91 |

A two-in-five chance of being overrun is not a bluff, and eight units of grain against a store of three thousand is
cheap insurance. The model was reasoning correctly about a case that had been labelled "weak" on the wrong measure.
The generator now sizes the party against the adults who would defend (`max(3, adults / 3)`), which is three and five
for these two states, where the raid never succeeds.

Two further things were missing, and both are information a village plainly has. The chief was told to "weigh how
strong they are against how strong you are" but was never told how many were at the gate: `visitorPrompt` and the
judgment state now both carry the party size. And rather than making a stone-age chief do arithmetic, both now carry
the village's own reckoning of the odds (`strengthReckoning`), banded from the table above.

Measured with `run-judge.ts --tasks host --repeat 3`, 45 observations per model:

| | threat-weak before | after the case fix | after the reckoning |
|---|---|---|---|
| gemini-3.8-flash (standard's impactful) | 1/6 | 5/6 | 6/6 |
| gemini-3.5-flash-lite (thrifty's impactful) | 3/6 | 0/6 | 6/6 |

So the tier actually at fault was thrifty, not standard, and neither is now. On the original ambiguous case 3.8 Flash
with the reckoning refuses two times in six, which is the right shape of answer for a fight that really could go
either way.

**The lesson for the eval, which is the more valuable half.** Fifteen visitor cases, ten of them easy, average to
0.93 for everyone, and a model that pays every bully sits inside that number. The report now breaks out every case
kind that some models pass and others fail, and prints the number of cases behind each figure, because the claim
that started this — "3.8 Flash refuses both" in the third pass and in the published post — rested on two
observations. Two observations cannot tell always from sometimes. Anything that matters gets `run-judge.ts` and
repeats.
