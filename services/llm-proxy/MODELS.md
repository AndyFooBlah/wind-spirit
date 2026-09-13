# Candidate models for the cost study

Verified live on **2026-09-12** from project `wind-spirit-prod` (user ADC for the probes in §1, the
`llm-proxy-sa` service account through the deployed proxy in §4). Prices are USD per 1M tokens,
pay-as-you-go, standard (not Flex/Priority/Batch), ≤200K context. The same numbers live in
`src/models.ts` and are served on `GET /v1/models`.

Price sources:

- **Catalog** = Cloud Billing Catalog API, service `C7E2-9256-1C43` (Vertex AI),
  `GET https://cloudbilling.googleapis.com/v1/services/C7E2-9256-1C43/skus` (needs
  `cloudbilling.googleapis.com` enabled; it was enabled on the project for this). SKU unit prices are
  nanos per token with `displayQuantity: 1000000`, so price/1M = nanos ÷ 1000.
- **Pricing page** = https://cloud.google.com/vertex-ai/generative-ai/pricing (used where the model is
  billed through Marketplace and has no SKU in the Vertex AI catalog: Claude, and the Gemma 4 cache-hit
  price which the catalog does not list).

## 1. Verified model ids and prices

| Model id (exact) | Provider / endpoint | Works? | Input | Output | Cache read | Cache write | Source (SKU ids) | Notes |
|---|---|---|---|---|---|---|---|---|
| `gemini-3.8-flash` | Gemini, `global` | yes | 1.50 | 7.50 | 0.15 | — | Catalog `2A35-AC68-14D6` / `90FD-DC5F-DC55` / `8658-6939-8BEC` | **baseline**; thinking on by default (57 thought tokens for "OK") |
| `gemini-3.6-flash` | Gemini, `global` | yes | 1.50 | 7.50 | 0.15 | — | Catalog `A2B1-E970-000C` / `1885-00D9-47BC` / `F263-CD8B-EE4C` | same price as 3.8 Flash |
| `gemini-3.5-flash` | Gemini, `global` | yes | 1.50 | 9.00 | 0.15 | — | Catalog `9733-FF95-45E3` / `4E73-15BD-0D78` / `36F0-C9BF-CBB8` | dearer output than 3.8; listed for completeness |
| `gemini-3.5-flash-lite` | Gemini, `global` | yes | 0.30 | 2.50 | 0.03 | — | Catalog `255D-4FF7-8DB3` / `EF3E-6ED9-3CD1` / `D1E7-04AD-E5B2` | no thinking tokens by default; **`cheap` class default** |
| `gemini-3.1-flash-lite` | Gemini, `global` | yes | 0.25 | 1.50 | 0.025 | — | Catalog `7DDF-162F-B3F3` / `DA75-5E07-40DC` / `A0D7-CE97-949A` | |
| `gemini-3.1-pro-preview` | Gemini, `global` | yes | 2.00 | 12.00 | 0.20 | — | Catalog "Gemini 3.0 / 3.1 Pro" `2737-2D33-D986` (out) + pricing page | `capable`/`premium` default |
| `gemini-2.5-flash` | Gemini, `global` | yes | 0.30 | 2.50 | 0.03 | — | Catalog `FDAB-647C-5A22` / `AF56-1BF9-492A` / `A1C1-77CC-6FAE` | thinking on (18 thought tokens for "OK") |
| `gemini-2.5-flash-lite` | Gemini, `global` | yes | 0.10 | 0.40 | 0.01 | — | Catalog `F91E-007E-3BA1` / `2D6E-6AC5-B1FD` / `95C5-4D3B-D378` | cheapest Gemini |
| `gemini-3.6-flash-lite` | Gemini | **no** (404) | | | | | | does not exist |
| `claude-haiku-4-5` | Anthropic on Vertex, `global` (also `us-east5`, `europe-west1`) | **blocked: needs console Enable** | 1.00 | 5.00 | 0.10 | 1.25 (5 min) / 2.00 (1 h) | Pricing page (no Vertex AI catalog SKU; billed via Marketplace `anthropic-896.cloudpartnerservices.goog`) | id is `claude-haiku-4-5` (docs) — the dated form `claude-haiku-4-5@20251001` is the version id; cache minimum 4,096 tokens |
| `claude-sonnet-5` | Anthropic on Vertex, `global` (+ `us`/`eu` multi-region, `asia-southeast1`) | **blocked: needs console Enable** | 2.00 | 10.00 | 0.20 | 2.50 (5 min) / 4.00 (1 h) | Pricing page | cache minimum 1,024 tokens |
| `openai/gpt-oss-120b-maas` | MaaS (OpenAI-compatible), `global` or `us-central1` | yes | 0.09 | 0.36 | — (no cache SKU) | — | Catalog `8DFC-88DE-E809` / `D74B-8F9A-24C9` | reasoning tokens counted in `completion_tokens`; `cached_tokens` never reported |
| `openai/gpt-oss-20b-maas` | MaaS, **`us-central1` only** | yes | 0.07 | 0.25 | 0.007 | — | Catalog `FA93-0B68-D30D` / `B167-9B3F-4AB9` / `3EA8-731E-48A5` | |
| `deepseek-ai/deepseek-v3.2-maas` | MaaS, `global` only | yes | 0.56 | 1.68 | 0.056 | — | Catalog `B46E-2D76-785B` / `2140-8998-5160` / `FAB4-E21C-4647` | **deprecated 2026-07-21, retires 2026-10-21**; `cached_tokens` never reported |
| `deepseek-ai/deepseek-v3.1-maas` | MaaS, `us-west2` | **no** (503 "Model server is not available" on every try) | 0.60 | 1.70 | 0.06 | — | Catalog `97BD-9FC6-42F2` / `9666-42A1-2BDB` / `A40E-4C0C-1639` | not in the allowlist |
| `deepseek-ai/deepseek-r1-0528-maas` | MaaS, `us-central1` only | yes | 1.35 | 5.40 | — | — | Catalog `7EDC-EBFF-5C50` / `C7EC-D5C7-B3DF` | emits `<think>` reasoning in `content` (proxy strips it); dearer than the baseline on input |
| `qwen/qwen3-235b-a22b-instruct-2507-maas` | MaaS, `global` (also `us-south1`) | yes | 0.22 | 0.88 | — (no cache SKU) | — | Catalog `80D2-1B6C-FB8A` / `DD77-5F89-F0BE` | **deprecated 2026-07-21, retires 2026-10-21**; reports `cached_tokens` |
| `qwen/qwen3-next-80b-a3b-instruct-maas` | MaaS, `global` only | yes | 0.15 | 1.20 | — | — | Catalog `AC77-CBA1-C179` / `232E-8761-E20E` | **deprecated 2026-07-21, retires 2026-10-21** |
| `google/gemma-4-26b-a4b-it-maas` | MaaS, `global` only | yes | 0.15 | 0.60 | 0.015 | — | Catalog `00D4-D165-4935` / `0CF6-3EA3-AC4F`; cache hit from pricing page | cheapest non-Gemini; reports `cached_tokens` |
| `meta/llama-4-maverick-17b-128e-instruct-maas` | MaaS, `us-east5` | **blocked: needs console Enable** (404 "not found or no access" in every region; publisher listing shows `requestAccess`) | 0.35 | 1.15 | — | — | Catalog `AD03-50E7-3706` / `7516-25FC-9009` | |
| Llama 4 Scout MaaS | — | **not offered as MaaS** (only self-deploy `publishers/meta/models/llama4` versions) | 0.25 | 0.70 | | | Catalog `3243-D407-B462` / `FAF9-F39A-C679` (fine-tuning/self-deploy SKUs exist) | |
| `meta/llama-3.3-70b-instruct-maas` | MaaS, `us-central1` | **blocked: needs console Enable** | 0.72 | 0.72 | | | Pricing page | not a candidate (price ≈ baseline input, weaker model) |
| `mistral-small-2503`, `mistral-medium-3` | Mistral (partner, `rawPredict` on `publishers/mistralai`, `us-central1`/`europe-west4`) | **blocked: needs console Enable** (404 everywhere; `requestAccess` in listing) | | | | | pricing page | not wired into the proxy |

Gemini "cache write" is a dash because Vertex bills explicit-cache creation at the normal input price
(plus storage: $1.00 per 1M tokens per hour for every Flash/Flash-Lite model, `*-Caching Storage` SKUs;
$4.50 for 3.1 Pro). Storage is **not** included in the proxy's per-request `cost`.

## 2. Enablement status

| Needs a Model Garden click-through | How | Could I do it via API? |
|---|---|---|
| Claude Haiku 4.5, Claude Sonnet 5 (all Claude) | Console → Model Garden → model card → **Enable** (a Marketplace questionnaire: `https://console.cloud.google.com/vertex-ai/model-garden/questionnaire?model=publishers/anthropic/models/claude-haiku-4-5&mp=anthropic/anthropic-896.cloudpartnerservices.goog…`), accepting Anthropic's terms | No. The publisher-model listing exposes only `supportedActions.requestAccess` with that console URL; there is no gcloud/REST call that accepts the terms. (`claude-fable-5-1` answered differently: "requires data sharing to be enabled for publisher anthropic … `setPublisherModelConfig`", i.e. an extra data-sharing consent on top; it is not a candidate.) |
| Llama 4 Maverick MaaS, Llama 3.3 70B MaaS | Model card → Enable (`requestAccess`) | No |
| Mistral Small 3.1 / Medium 3 | Model card → Enable (`requestAccess`) | No |
| gpt-oss, DeepSeek, Qwen, Gemma 4 MaaS | none needed — worked immediately with `roles/aiplatform.user` | — |

Once a Claude model is enabled in the console, add it with `EVAL_MODELS=…,claude-haiku-4-5` on the
service; the adapter is already in place (`src/providers/anthropic.ts`), but it has **not** been
exercised live for lack of access.

## 3. Caching behaviour observed

| Provider | Mechanism | Observed |
|---|---|---|
| Gemini | Implicit (automatic) | Repeating a 7,545-token prompt: `cachedContentTokenCount` appeared from the 2nd call on 3.8 Flash (4,075 of 7,545) and from the **1st** call on 3.5 Flash-Lite (6,113) and 2.5 Flash-Lite (7,154) — the prefix had just been counted/created, so the implicit cache was already warm. Nothing to configure; the proxy just reports it. |
| Gemini | Explicit (`cache: {key, ttlSeconds}`) | `cachedContents` create succeeds on 3.8 Flash, 3.5 Flash-Lite and 2.5 Flash-Lite at 7,543 tokens; the API rejects < 4,096 with "The minimum token count to start explicit caching is 4096" (docs say 4,096 for the Gemini 3 family, 2,048 for 2.x, and mark 3.1 Pro Preview / 3.8 Flash as implicit-only at 6,144 — in practice explicit creation on 3.8 Flash worked at 7.5k). With `cachedContent` set, every call reports `cachedContentTokenCount` = full cached prefix (7,543). The proxy counts tokens first (free) and falls back silently to no cache below the minimum, remembering the verdict for an hour per key+content hash. |
| Anthropic | `cache_control: {type: 'ephemeral'}` on the system block (+ last stable message) | Not observable yet (models not enabled). Per docs: 5-minute TTL, write 1.25× input, read 0.1× input; minimum 4,096 tokens on Haiku 4.5 and 1,024 on Sonnet 5 — below that `cache_creation_input_tokens` is simply 0. Usage maps `cache_read_input_tokens → cached`, `cache_creation_input_tokens → cacheWrite`. |
| MaaS (OpenAI-compatible) | Nothing to request; backend reports `prompt_tokens_details.cached_tokens` when it hits | Same 7.5k prompt twice: Qwen3-235B reported `cached_tokens: 7555` on **both** calls (even the first); Gemma 4 reported 4–7 (essentially no reuse); gpt-oss-120b and DeepSeek-V3.2 returned `prompt_tokens_details: null` every time. There is no cache-hit SKU for gpt-oss-120b or Qwen, so cached tokens on those are priced at the input rate (`cacheRead = input` in the table); Gemma 4 and gpt-oss-20b have a published cache-hit price which the proxy applies. |

## 4. Results through the deployed proxy (service account, anonymous Firebase token)

Deployed revision `llm-proxy-00004-fwt` (2026-09-12), caller = anonymous Firebase user minted with
Identity Toolkit `accounts:signUp`, `REQUIRE_AUTH=true` (an unauthenticated `GET /v1/models` → 401).
`GET /health?deep=1`: cheap 614 ms, routine 844 ms, capable 2,151 ms, premium 2,563 ms, all ok.

Each model was called twice with the same request: a 5,252-token stable system prompt (3,151 tokens in
the first pass), one user turn, the schema `{decision: enum[hunt|gather|rest|move], reason: string}`,
`maxOutputTokens: 1200`, `temperature: 0.2`, `cache: {key, ttlSeconds: 600}`. `ms` is the proxy's own
timing; `cost` is the proxy's estimate in USD for that call.

| Model | Works | Call 1 ms | Call 2 ms | Usage call 2 (in / out / thoughts / cached) | Cost call 1 → 2 | Cached on 2nd call? |
|---|---|---|---|---|---|---|
| `gemini-3.8-flash` (baseline) | yes | 5,954 | 2,934 | 5357 / 193 / 141 / **5252** | $0.00368 → $0.00239 | yes — explicit cache created on call 1, reused on call 2 |
| `gemini-3.6-flash` | yes | 2,753 | 2,232 | 3266 / 295 / 241 / 0 (3.1k prefix, under minimum) | $0.00792 → $0.00711 | n/a at 3.1k; same behaviour as 3.8 Flash expected at ≥4,096 |
| `gemini-3.5-flash` | yes | 4,401 | 3,570 | 3266 / 603 / 527 / 0 | $0.01075 → $0.01033 | n/a at 3.1k |
| `gemini-3.5-flash-lite` | yes | 1,832 | 737 | 5357 / 36 / 0 / **5252** | $0.00030 → $0.00028 | yes — explicit cache |
| `gemini-3.1-flash-lite` | yes | 2,239 | 1,094 | 5357 / 54 / 0 / **5252** | $0.00023 → $0.00024 | yes — explicit cache |
| `gemini-3.1-pro-preview` | yes | 6,626 | 15,860 | 6532 / 1825 / 1719 / 0 (call 2 = one schema retry, so double input) | $0.01494 → $0.03496 | n/a at 3.1k |
| `gemini-2.5-flash` | yes (call 1 → 502 `bad_model_output`: `reason` exceeded the `maxLength: 300` in the first-pass schema twice) | 8,464 (2 tries) | 2,708 | 3167 / 407 / 326 / **3152** | — → $0.00112 | yes — 2.5 minimum is 2,048, cache created on the failed call and reused |
| `gemini-2.5-flash-lite` | yes | 1,809 | 743 | 3167 / 65 / 0 / **3152** | $0.000056 → $0.000059 | yes — explicit cache |
| `openai/gpt-oss-120b-maas` | yes | 3,531 | 2,329 | 3241 / 86 / 0 / 0 | $0.00032 → $0.00032 | no (`prompt_tokens_details` null) |
| `openai/gpt-oss-20b-maas` | yes, but flaky (call 2: `finishReason: length`, reasoning ate all 1,200 output tokens twice → 502) | 2,277 | — | 3241 / 107 / 0 / 0 | $0.00025 | no |
| `deepseek-ai/deepseek-v3.2-maas` | yes | 4,736 | 5,546 | 3171 / 85 / 0 / 0 | $0.00192 → $0.00192 | no (`prompt_tokens_details` null) |
| `deepseek-ai/deepseek-r1-0528-maas` | yes (first pass: 429 "Resource exhausted" twice in a row; 3/3 ok 20 min later) | 4,955 | 9,355 | 104 / 507 / 0 / 0 | $0.0023 → $0.0029 | no |
| `qwen/qwen3-235b-a22b-instruct-2507-maas` | yes (same transient 429 as R1; 3/3 ok on retry) | 1,223 | 1,434 | 36 / 92 / 0 / 34 | $0.000065 → $0.000089 | partial (`cached_tokens` 5 → 34 → 4 on a 36-token prompt: noise, not prefix reuse) |
| `qwen/qwen3-next-80b-a3b-instruct-maas` | yes | 2,113 | 2,033 | 5280 / 235 / 0 / 0 | $0.00107 → $0.00107 | no |
| `google/gemma-4-26b-a4b-it-maas` | yes | 2,010 | 1,152 | 5284 / 123 / 0 / 7 | $0.00085 → $0.00087 | no meaningful reuse (`cached_tokens: 7` on both calls) |
| `claude-haiku-4-5`, `claude-sonnet-5` | not callable until enabled in the console (§2) | | | | | |

Streaming (`POST /v1/stream`, class `routine`): text chunks then `{"done":true,"usage":{"input":8,"output":328,"thoughts":302,"cached":0,"cacheWrite":0},"cost":0.002472,...}`.

Take-aways for the eval runner:

- The cost story at this prompt size is dominated by thinking: 3.8 Flash spends 140–320 thought tokens
  per decision at $7.50/1M output, so a 5k-token cached prefix + decision costs ≈ $0.0024 on 3.8 Flash
  versus ≈ $0.0003 on 3.5 Flash-Lite, ≈ $0.0002 on 3.1 Flash-Lite, ≈ $0.0011 on Qwen3-Next, ≈ $0.0009 on
  Gemma 4 and ≈ $0.0003 on gpt-oss-120b (which buries its reasoning in `completion_tokens`).
- Keep the stable prefix ≥ 4,096 tokens or Gemini 3.x will not cache at all (the proxy falls back
  silently and says so in `cacheNote`); MaaS models never cache the way Gemini does, so their cost is
  flat per call regardless of `cache`.
- Give reasoning MaaS models (gpt-oss, DeepSeek-R1) ≥ 2,000 output tokens; otherwise the answer is
  cut off inside the hidden reasoning and the proxy answers 502 after its one retry.
- Avoid `maxLength` in schemas: Gemini's native JSON mode does not enforce it and the validator will
  reject otherwise fine answers.
- Expect occasional 429 "Resource exhausted" from the deprecated MaaS endpoints (DeepSeek-R1, Qwen3-235B);
  retry with backoff in the runner.

## 5. OpenRouter candidates

Added 2026-09-12 as provider `openrouter` in `src/models.ts`. **Untested until a real key is set**: the
Secret Manager secret `openrouter-api-key` currently holds the placeholder `unset`, so the deployed
service lists these with `available: false` and answers `503 provider_disabled` for them (see README
§Secrets for rotation). Prices are USD per 1M tokens from the public
`GET https://openrouter.ai/api/v1/models` on 2026-09-12 (per-token `pricing.prompt` / `completion` /
`input_cache_read` / `input_cache_write` × 1e6); the service re-pulls the same endpoint at startup and
hourly and serves the live numbers on `/v1/models`. "Cache write" is the total price of a written token:
OpenRouter lists the full price for Anthropic and Qwen, and only the storage add-on for Gemini
("input price + 5 minutes of storage"), which the proxy adds to the input price. Every one of these
advertised `structured_outputs` in `supported_parameters` on that date, but the proxy still instructs +
validates unless `OPENROUTER_NATIVE_JSON=true`.

Requests carry no `usage`/`stream_options` flags (OpenRouter documents them as deprecated no-ops and
always returns `usage.cost`), so the eval runner should prefer the `cost` field
(`costSource: "openrouter"`) over recomputing from this table — it reflects the actual credits charged,
including cache discounts.

| Model id (exact) | Input | Output | Cache read | Cache write (total) | Context | Notes |
|---|---|---|---|---|---|---|
| `anthropic/claude-haiku-4.5` | 1.00 | 5.00 | 0.10 | 1.25 | 200K | same list price as Vertex; no Model Garden click-through needed |
| `anthropic/claude-sonnet-5` | 2.00 | 10.00 | 0.20 | 2.50 | 1M | |
| `openai/gpt-5-mini` | 0.25 | 2.00 | 0.025 | — | 400K | reasoning tokens billed as output |
| `openai/gpt-5-nano` | 0.05 | 0.40 | 0.005 | — | 400K | cheapest OpenAI |
| `openai/gpt-5.4-nano` | 0.20 | 1.25 | 0.02 | — | 400K | |
| `openai/gpt-5.6-luna` | 0.20 | 1.20 | 0.02 | 0.25 | 1M | GPT-5.6 family bills cache writes at 1.25x input even with automatic caching |
| `openai/gpt-5.6-luna-pro` | 0.20 | 1.20 | 0.02 | 0.25 | 1M | same list price as `gpt-5.6-luna` |
| `meta-llama/llama-4-maverick` | 0.20 | 0.696 | — (no cache price) | — | 1M | cheaper than the Vertex MaaS listing (0.35/1.15) and no enablement |
| `moonshotai/kimi-k2.5` | 0.45 | 2.25 | 0.07 | — | 262K | |
| `moonshotai/kimi-k3` | 2.648 | 13.283 | 0.303 | — | 1M | dearer than the 3.8 Flash baseline: a quality candidate for the upper classes, not a cost one |
| `z-ai/glm-5.3-flash` | 0.15 | 0.50 | 0.03 | — | 1.3M | |
| `z-ai/glm-4.7` | 0.40 | 1.75 | 0.08 | — | 205K | |
| `minimax/minimax-m2.7` | 0.30 | 1.20 | 0.06 | — | 205K | |
| `deepseek/deepseek-v3.2` | 0.269 | 0.40 | 0.1345 | — | 164K | vs Vertex MaaS 0.56/1.68 (deprecated there) |
| `deepseek/deepseek-v4.1-flash` | 0.15 | 0.60 | 0.003 | — | 1M | |
| `deepseek/deepseek-v4-flash` | 0.0657 | 0.1313 | 0.0131 | — | 1M | cheapest candidate overall |
| `deepseek/deepseek-v4-pro` | 1.60 | 3.20 | 0.135 | — | 1M | |
| `mistralai/mistral-medium-3.1` | 0.40 | 2.00 | 0.04 | — | 131K | Vertex needs a click-through; OpenRouter does not |
| `xiaomi/mimo-v2.5` | 0.14 | 0.28 | 0.0028 | — | 1M | |
| `qwen/qwen3.8-flash` | 0.15 | 0.47 | 0.016 | 0.20 | 1M | |
| `nvidia/nemotron-3-ultra-550b-a55b` | 0.625 | 3.125 | 0.1875 | — | 262K | paid id; the `:free` variant is rate-limited and unpriced |
| `nvidia/nemotron-3-super-120b-a12b` | 0.085 | 0.40 | — (no cache price) | — | 262K | paid id, same family, cheap |
| `google/gemini-3.8-flash` | 0.75 | 3.75 | 0.075 | 0.75 + 0.0417 storage | 1M | **half the Vertex list price** (1.50/7.50) on 2026-09-12; worth verifying with a live call |
| `google/gemini-3.5-flash-lite` | 0.30 | 2.50 | 0.03 | 0.30 + 0.0833 storage | 1M | same as Vertex |
| `google/gemini-2.5-flash-lite` | 0.10 | 0.40 | 0.01 | 0.10 + 0.0833 storage | 1M | same as Vertex |

"—" under cache write means OpenRouter lists no write price (writes cost the plain input rate or are
free depending on the vendor); the proxy stores `cacheWrite = input` for those. The `google/` ids go
through OpenRouter's key, not the project's Vertex quota, and are listed so the eval can compare the same
model on both paths; the Vertex ids (no prefix) remain the class defaults.


## 6. Recommended configurations (from the 2026-09-12 evals, see docs/evals-notes.md)

Defaults, all Vertex Gemini through the service account (fastest, no key, quality within noise of the best cheap models):

```
MODEL_CHEAPEST=gemini-2.5-flash-lite   # thrifty tier's routine seasons, ~$0.0004 a decision
MODEL_CHEAP=gemini-3.5-flash-lite      # standard tier's routine seasons, ~$0.0016, best Gemini journals
MODEL_ROUTINE=gemini-3.8-flash         # standard tier's impactful decisions, ~$0.0070
MODEL_CAPABLE=gemini-3.1-pro-preview   # lavish tier's impactful decisions and dreams
MODEL_PREMIUM=gemini-3.1-pro-preview
```

Alternates via OpenRouter (needs the `openrouter-api-key` secret), each one env var and a redeploy:

| want | set | why |
|---|---|---|
| the best journals at low cost | `MODEL_CHEAP=openai/gpt-5.6-luna` | judge 4.46 (best in study), rules 0.975, $0.0011, ~6 s |
| the cheapest on-par chief | `MODEL_CHEAPEST=z-ai/glm-5.3-flash` | rules 0.972, $0.0005, ~6 s |
| a more cautious temperament | `MODEL_ROUTINE=mistralai/mistral-medium-3.1` | rules 0.984, refuses and stays home more than Gemini (74% agreement with the reference) |

Not recommended from the study: Claude Haiku 4.5 (slower and dearer than the baseline for equal or lower quality), Llama 4 Maverick (48% agreement with the reference), and any model over ~20 s a decision (DeepSeek V4 family, MiMo, GLM 4.7, Kimi K2.5, Qwen 3.8 Flash at our token caps).
