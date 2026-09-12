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
