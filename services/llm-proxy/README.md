# @wind-spirit/llm-proxy

The model proxy from `docs/technical-design.md` §9. A small Node 24 HTTP service on Cloud Run that
verifies Firebase ID tokens, enforces a per-user daily token quota (Firestore), maps a model *class*
(or, for evals, an allowlisted explicit model id) to a provider adapter, calls Vertex AI with
Application Default Credentials, and logs one JSON line per request with tokens, cached tokens and an
estimated cost. It also fronts TypeSafe System One on `/v1/systemone` for the chief's label-shaped
judgements. Gemini, Claude-on-Vertex and the open MaaS models are all reached with the runtime service
account's access token; the two API keys are OpenRouter's and TypeSafe's, which live in Secret Manager
and are injected as env vars (see [Secrets](#secrets)).

- Service URL (prod): `https://llm-proxy-406179055859.us-central1.run.app`
- GCP project: `wind-spirit-prod`, region `us-central1`, runtime SA `llm-proxy-sa@wind-spirit-prod.iam.gserviceaccount.com`
- Firebase web app config for the browser client: `firebase-web-config.json` (public client config, not a secret)
- Candidate-model study (verified ids, prices, sources, caching observations): `MODELS.md`

## Providers

| Provider (`src/providers/`) | Models | Transport | JSON schema | Caching |
|---|---|---|---|---|
| `gemini.ts` | `gemini-*` | `@google/genai` (Vertex, ADC, `VERTEX_LOCATION`, default `global`) | native (`responseJsonSchema`) + validated | implicit (reported) and explicit `cachedContents` on `cache: {key, ttlSeconds}` |
| `anthropic.ts` | `claude-*` | `@anthropic-ai/vertex-sdk` (`rawPredict` under the hood; ADC; `ANTHROPIC_LOCATION`, default `global`) | instruct + validate (Vertex gates native structured outputs behind an org policy) | `cache_control: {type: 'ephemeral'}` on the system block and the last `stable` message |
| `openai-compat.ts` | `<publisher>/<model>-maas` | Vertex OpenAI-compatible chat completions (`.../endpoints/openapi/chat/completions`, bearer = ADC token; `MAAS_LOCATION` default `global`, per-model override in the catalog) | `response_format: json_schema` where the model supports it, else instruct + validate | none to request; `prompt_tokens_details.cached_tokens` reported when present |
| `openrouter.ts` | `<vendor>/<model>` (e.g. `openai/gpt-5-nano`, `google/gemini-3.8-flash`; the `google/` prefix distinguishes these from the Vertex `gemini-*` ids) | `https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer $OPENROUTER_API_KEY`, `HTTP-Referer` + `X-OpenRouter-Title`/`X-Title` app attribution | instruct + validate by default; native `response_format: json_schema` only when `OPENROUTER_NATIVE_JSON=true` **and** the model's `supported_parameters` includes `structured_outputs` | provider-side automatic caching only; `prompt_tokens_details.{cached_tokens,cache_write_tokens}` reported |

All four implement one `Provider` interface (`src/providers/types.ts`): `generate(req, signal) → {text, usage, model, finishReason, cacheNote, cost?, costSource?}` and `stream(req, signal)` yielding `{text}` chunks then one `{done, usage, cost?, costSource?}`. The two OpenAI-style adapters share their body shaping, SSE parsing and usage mapping in `src/providers/chat-completions.ts`. The server validates JSON output against the schema with Ajv for every provider, retries once on a miss, then answers `502 bad_model_output`.

OpenRouter always returns `usage.cost` (credits, USD) — no request option is needed; `usage: {include: true}` and
`stream_options.include_usage` are documented as deprecated no-ops — and the proxy uses that figure as
`cost` with `costSource: "openrouter"` instead of the pricing table (`costSource: "table"` everywhere
else). OpenRouter prices are pulled from the public `GET https://openrouter.ai/api/v1/models` at
startup and hourly (`OPENROUTER_PRICING_REFRESH_MS`) and overwrite the static values in `src/models.ts`;
`GET /v1/models` reports whether the live pull succeeded under `openrouter.pricing`.

When `OPENROUTER_API_KEY` is missing or is the placeholder `unset`, the OpenRouter provider is
**disabled**: `/health` shows `"openrouter": "disabled"`, `/v1/models` lists its models with
`available: false` and `note: "OPENROUTER_API_KEY not set"`, and a request naming one of them
answers `503 {"error":"provider_disabled"}` before touching the quota.

The catalog in `src/models.ts` maps each model id to its provider, endpoint location, list prices and cache minimum. Ids that are not in the catalog are assumed to be Gemini and cost `0` (with a warning in the log), so a class can be pointed at a brand-new Gemini model before the catalog catches up.

## API

All `/v1/*` routes require `Authorization: Bearer <Firebase ID token>` (anonymous auth is fine)
unless the service runs with `REQUIRE_AUTH=false`, in which case quotas are keyed by client IP.
CORS allows any origin with the `Authorization` and `Content-Type` headers.

### `POST /v1/systemone`

TypeSafe System One (Jev): typed judgements rather than text. Same auth, invitation and daily quota as
`/v1/generate`; billed on input tokens only, because System One output is free.

```jsonc
{
  "state": { "whisper": "Plant nothing this spring.", "land": { "cleared_plots": 9 } },  // text, object or array
  "questions": { "consistent": { "type": "noul", "instructions": "..." } },              // at least one
  "model": "jev-latest"                                                                  // optional
}
```

The proxy does not interpret the questions; it holds the key and forwards the body. Question
definitions live in `packages/agents/src/judge/`, where they are tested, and the browser reaches this
route through `ProxySystemOne` so no key ever ships to a client. Answers come back as
`{model, answers, usage: {input_tokens, output_tokens}, cost, costSource, ms}`.

### `POST /v1/generate`

Request body:

```jsonc
{
  "class": "cheap" | "routine" | "capable" | "premium",   // model class (the game never names a model id)
  "model": "google/gemma-4-26b-a4b-it-maas",              // OR an explicit id; honored only if it is in EVAL_MODELS
  "system": "optional system prompt",
  "messages": [{ "role": "user" | "model", "text": "...", "stable": true }],   // last message must be role user
  "schema": { /* JSON schema */ },      // optional: structured output, validated with Ajv
  "maxOutputTokens": 1024,              // optional, 1..65536
  "temperature": 0.7,                   // optional, 0..2
  "cache": { "key": "village:abc", "ttlSeconds": 3600 },   // optional explicit context cache (see Caching)
  "cacheKey": "village:abc",            // optional label; logged for diagnostics only
  "thinkingLevel": "low"                // optional; Gemini thinkingConfig.thinkingLevel (Claude: anything but low/minimal turns thinking on)
}
```

`class` or `model` is required. `messages[].stable` marks a leading run of messages that belongs to the
cacheable prefix (system prompt + stable messages); the first non-stable message ends the prefix.

Response `200`:

```jsonc
{
  "text": "...",
  "json": { },                          // present when schema was given; parsed + validated model output
  "usage": { "input": 7549, "output": 45, "thoughts": 30, "cached": 7543, "cacheWrite": 0 },
  "cost": 0.00023059,                   // USD, from the pricing table (cached tokens at the cache-read price)
  "costSource": "table",                // "openrouter" when the provider reported the charge itself
  "model": "gemini-3.5-flash-lite",
  "provider": "gemini",
  "ms": 812,
  "finishReason": "STOP",
  "cacheNote": "explicit cache reused"  // only when a cache was requested
}
```

Usage semantics are the same for every provider: `input` is the whole prompt including cached and
cache-write tokens, `output` includes hidden thinking (`thoughts` is the part of `output` that was
thinking, when the provider reports it), `cached` was served from a cache, `cacheWrite` was written to
one this call (Anthropic only; 0 elsewhere). `cost = (input − cached − cacheWrite)·in + cached·cacheRead + cacheWrite·cacheWrite + output·out`.
Gemini explicit-cache **storage** ($1/1M tokens/hour on Flash models) is not included.

When `schema` is given the model output is extracted as JSON (fences and prose tolerated), validated
against the schema, retried once on failure, then `502 {"error":"bad_model_output"}`.

### `POST /v1/stream`

Same body. Responds with Server-Sent Events:

```
data: {"text":"chunk"}
data: {"text":"chunk"}
data: {"done":true,"usage":{...},"cost":0.0000426,"costSource":"table","model":"openai/gpt-oss-120b-maas","provider":"openai-compat","ms":889,"finishReason":"stop"}
```

A mid-stream failure ends the stream with `data: {"error":"...","message":"..."}`. Reasoning models
on the OpenAI-compatible endpoint (gpt-oss, DeepSeek-R1) stream their reasoning as a separate field
that is not forwarded, so a small `maxOutputTokens` can end with `finishReason: "length"` and no text.

### `GET /v1/models`

Returns the class mapping, the eval allowlist and the pricing table so the eval runner can recompute
costs: `{ classes: {cheap, routine, capable, premium}, evalModels: [...], pricingUnit: "USD per 1M tokens",
openrouter: { enabled, nativeJson, pricing: {source: "static"|"openrouter-live", fetchedAt?, updated?, missing?, error?} },
pricing: { "<id>": { provider, location, available, input, output, cacheRead, cacheWrite, nativeJsonSchema, minCacheTokens, supportedParameters?, note? } } }`.
`available` is `false` (with `note: "OPENROUTER_API_KEY not set"`) for OpenRouter models while the key is unset.

### `GET /health`

`{ ok: true, models: {cheap, routine, capable, premium}, requireAuth, location, openrouter: "enabled"|"disabled" }`. Add `?deep=1` to run a tiny
generation on each class and get `{ deep: { cheap: {ok, ms, model, usage, cost, ...}, routine: ..., capable: ..., premium: ... } }`
(503 if any fails). No auth required. `/healthz` is accepted as an alias, but on Cloud Run the Google
Frontend intercepts exactly `/healthz` on `*.run.app` and returns its own HTML 404, so use `/health` there.

### Errors

| Status | `error` | Meaning |
|---|---|---|
| 400 | `bad_request` | body failed validation (`message` says why), including a `model` outside `EVAL_MODELS` |
| 401 | `unauthorized` | missing/invalid Firebase ID token (only when `REQUIRE_AUTH=true`) |
| 413 | `too_large` | body over `MAX_BODY_BYTES` |
| 429 | `quota` | daily token quota used; `resetAt` is the next UTC midnight |
| 502 | `upstream` / `bad_model_output` | the provider rejected the call, or JSON output never validated |
| 503 | `quota_unavailable` | Firestore unreachable (fails closed: the quota is the cost backstop) |
| 503 | `provider_disabled` | the model's provider has no credential on this deployment (OpenRouter with `OPENROUTER_API_KEY` unset) |
| 504 | `timeout` | model call exceeded `REQUEST_TIMEOUT_MS` |

## Caching

- **Gemini implicit**: always on; the proxy just reports `cachedContentTokenCount` as `usage.cached`.
  Repeated prefixes of ≥ 4,096 tokens (Gemini 3.x; 2,048 on 2.5) start hitting from the second call.
- **Gemini explicit**: send `cache: {key, ttlSeconds}`. The proxy counts the prefix (system prompt +
  leading `stable` messages) with the free `countTokens`; if it is under the model minimum it silently
  runs uncached (`cacheNote` says so, remembered for an hour per key+content). Otherwise it creates a
  `cachedContents` resource once per key, records `{name, model, contentHash, expiresAt, tokens}` in
  memory and in Firestore `caches/{key}`, and reuses it while it is fresh. A different system prompt or
  model under the same key transparently creates a new cache; a cache Vertex no longer has is dropped
  and the call retried uncached. Only the non-stable messages are sent with the cache reference.
- **Anthropic**: `cache` puts `cache_control: {type:'ephemeral'}` on the system block and on the last
  stable message. Below the model minimum (Haiku 4.5: 4,096 tokens, Sonnet 5: 1,024) nothing is cached
  and `cacheWrite`/`cached` stay 0. `key` and `ttlSeconds` are not used (Anthropic caches by content, 5 min TTL).
- **OpenAI-compatible MaaS**: nothing to request; `cached_tokens` is reported when the backend
  provides it (Qwen and Gemma do; gpt-oss-120b and DeepSeek-V3.2 do not).
- **OpenRouter**: the proxy sends no `cache_control` breakpoints; vendors with automatic caching
  (OpenAI, DeepSeek, Moonshot, Z.AI, Gemini implicit) report `cached_tokens`/`cache_write_tokens` on their
  own and OpenRouter's `usage.cost` already reflects the discount. `cacheNote` says so when `cache` is sent.

## Environment

| Var | Default | Notes |
|---|---|---|
| `MODEL_CHEAP` | `gemini-3.5-flash-lite` | model id for `class: cheap` |
| `MODEL_ROUTINE` | `gemini-3.8-flash` | model id for `class: routine`; verify against the live Vertex model list before changing |
| `MODEL_CAPABLE` | `gemini-3.1-pro-preview` | model id for `class: capable`; `gemini-3.1-pro` (no suffix) does not exist on Vertex as of 2026-09-12 |
| `MODEL_PREMIUM` | `gemini-3.1-pro-preview` | model id for `class: premium` |
| `EVAL_MODELS` | every catalog model that verified live (see `src/config.ts`; Claude excluded until enabled) | comma-separated ids a request may name explicitly |
| `GOOGLE_CLOUD_PROJECT` | `wind-spirit-prod` | Vertex + Firebase project |
| `VERTEX_LOCATION` | `global` | Gemini 3.x on Vertex requires the global endpoint; regional 404s |
| `ANTHROPIC_LOCATION` | `global` | Claude on Vertex; Haiku 4.5 and Sonnet 5 both support `global` |
| `MAAS_LOCATION` | `global` | OpenAI-compatible MaaS endpoint; per-model overrides (e.g. `us-central1`-only models) live in the catalog |
| `REQUIRE_AUTH` | `true` | `false` keys quotas by client IP instead of requiring a token |
| `DAILY_TOKEN_QUOTA` | `2000000` | input+output tokens per principal per UTC day |
| `REQUEST_TIMEOUT_MS` | `120000` | per-request model timeout |
| `QUOTA_COLLECTION` | `quotas` | Firestore collection; doc id `YYYY-MM-DD_<kind>_<id>` |
| `CACHE_COLLECTION` | `caches` | Firestore collection for explicit Gemini cache records, doc id = `cache.key` |
| `MAX_BODY_BYTES` | `2000000` | request body cap |
| `OPENROUTER_API_KEY` | *(unset)* | **secret**, injected by Cloud Run from Secret Manager `openrouter-api-key` (`--set-secrets`). Missing or the literal `unset` disables the OpenRouter provider. Never logged, never in `/v1/models`, never sent to a client |
| `OPENROUTER_NATIVE_JSON` | `false` | `true` sends `response_format: json_schema` to OpenRouter models whose `supported_parameters` include `structured_outputs`; default is instruct + validate (constrained decoding on Vertex MaaS stripped optional fields) |
| `OPENROUTER_REFERER` | `https://wind-spirit-prod.web.app` | `HTTP-Referer` app-attribution header |
| `OPENROUTER_TITLE` | `Wind Spirit` | `X-OpenRouter-Title` / `X-Title` app-attribution header |
| `OPENROUTER_PRICING_REFRESH_MS` | `3600000` | how often to re-pull OpenRouter prices (0 = only at startup) |
| `PORT` | `8080` | set by Cloud Run |

Model ids live only in the env vars and `src/models.ts`. Clients send a class (or an allowlisted id).
When Google ships new models, change the env var on the service (`gcloud run services update llm-proxy
--update-env-vars MODEL_ROUTINE=...`), add the price to `src/models.ts`, and check `/health?deep=1`.

## Secrets

There are two: the OpenRouter API key and the TypeSafe API key. Both follow the same rules — Secret
Manager, `--set-secrets` on deploy, read from the environment at call time only, never logged, never
returned to a client, and a placeholder literal `unset` that disables the feature rather than failing.

TypeSafe's is `typesafe-api-key` (`src/typesafe.ts`; `/health` shows `typesafe: enabled|disabled`, and
`POST /v1/systemone` answers `503 provider_disabled` without it):

```sh
printf '%s' "$KEY" | gcloud secrets versions add typesafe-api-key --data-file=- --project wind-spirit-prod
gcloud run services update llm-proxy --project wind-spirit-prod --region us-central1 \
  --update-secrets TYPESAFE_API_KEY=typesafe-api-key:latest
curl -s "$URL/health" | jq .typesafe      # "enabled"
```

OpenRouter's is stored in Secret Manager as `openrouter-api-key`
(project `wind-spirit-prod`; `llm-proxy-sa` has `roles/secretmanager.secretAccessor` on it) and reaches
the container only as the env var `OPENROUTER_API_KEY` via `--set-secrets` on deploy. Version 1 is the
placeholder literal `unset`, which the service treats as "no key" (provider disabled). Rules:

- never put the key in an env var on the command line, in `firebase-web-config.json`, in git, or in a log line;
- the service reads it at call time only (`src/providers/openrouter.ts`), the startup log prints
  `openrouter: enabled|disabled`, nothing else;
- clients still only ever send a class or an allowlisted model id; the key never leaves the server.

Rotate (or set for the first time):

```sh
printf '%s' "$KEY" | gcloud secrets versions add openrouter-api-key --data-file=- --project wind-spirit-prod
# pick up `latest` without a rebuild:
gcloud run services update llm-proxy --project wind-spirit-prod --region us-central1 \
  --update-secrets OPENROUTER_API_KEY=openrouter-api-key:latest
# (or simply redeploy with the command in Deploy; it references :latest too)
curl -s "$URL/health" | jq .openrouter      # "enabled"
```

To disable again, add a new version whose value is `unset` and run the same `services update`. Old
versions can be destroyed with `gcloud secrets versions destroy N --secret openrouter-api-key`.

## Invitations

Every model call costs money, so `/v1/generate` and `/v1/stream` refuse callers who have not redeemed an
invitation code (`403 not_invited`). The gate is enforced here, never only in the web app.

- `invites/{code}`: `{ label, maxUses, uses, disabled, expiresAt? }`. Codes look like `amber-heron-42`;
  case, spaces and underscores are forgiven on entry.
- `players/{uid}`: written when a Firebase user redeems a code: `{ code, label, redeemedAt, revoked }`.
  A player is checked once per five minutes per instance, so a season of chief calls is one read.
- `POST /v1/invite/redeem { code }` with a Bearer token: `200 { ok, label, alreadyPlayer }`, or `404 invalid_code`,
  `410 code_disabled | code_expired | code_exhausted`. A user who already holds a seat consumes nothing.
- `GET /v1/invite/status`: `{ invited, required }`.
- `REQUIRE_INVITE=false` turns the gate off (local development only).

Minting and managing codes runs on a laptop with ADC, never from the browser:

```sh
cd services/llm-proxy
pnpm invite create --label friends --uses 10 --days 90   # prints the code once
pnpm invite list
pnpm invite disable amber-heron-42                        # stops new redemptions; seats already taken stay
pnpm invite players                                       # uid, code, label, when
pnpm invite revoke <uid>                                  # takes a seat back (effective within five minutes)
```

Scripts that call the proxy (the eval runner, `run-chief`, `first-turn`) redeem `WS_INVITE_CODE` from the
environment for their throwaway anonymous user. Seats belong to a Firebase user, which for the web app is
the anonymous user of one browser: clearing site data means entering the code again, which is why codes
carry a handful of uses rather than one.

## Logging

One JSON line per request: `route, class, model, provider, principal (uid, or hashed ip), cacheKey,
promptSha256, inputTokens, outputTokens, thoughtTokens, cachedTokens, cacheWriteTokens, costUsd, costSource,
cacheNote, status, ms`. Prompt bodies and the OpenRouter key are never logged. Cloud Logging picks up `severity`.

## Deploy

Prerequisites (done once, 2026-09-12): Firebase added to the project, Anonymous sign-in enabled,
Firestore native database in `nam5`, service account `llm-proxy-sa` with `roles/aiplatform.user` and
`roles/datastore.user` (this is enough for Gemini and the open MaaS models; Claude additionally needs
the Model Garden **Enable** click-through per model in the console, see `MODELS.md` §2), Secret Manager
secret `openrouter-api-key` with `roles/secretmanager.secretAccessor` for `llm-proxy-sa` (see Secrets).

```sh
cd /path/to/wind-spirit
gcloud run deploy llm-proxy \
  --source services/llm-proxy \
  --project wind-spirit-prod --region us-central1 \
  --service-account llm-proxy-sa@wind-spirit-prod.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=wind-spirit-prod,VERTEX_LOCATION=global,ANTHROPIC_LOCATION=global,MAAS_LOCATION=global,MODEL_CHEAP=gemini-3.5-flash-lite,MODEL_ROUTINE=gemini-3.8-flash,MODEL_CAPABLE=gemini-3.1-pro-preview,MODEL_PREMIUM=gemini-3.1-pro-preview,REQUIRE_AUTH=true,REQUIRE_INVITE=true,DAILY_TOKEN_QUOTA=2000000 \
  --set-secrets OPENROUTER_API_KEY=openrouter-api-key:latest,TYPESAFE_API_KEY=typesafe-api-key:latest \
  --timeout 300 --concurrency 40 --memory 512Mi --cpu 1 \
  --min-instances 0 --max-instances 5
```

`--source` uses the `Dockerfile` here (build context is this directory only, so the image installs
with npm from this `package.json`; `tsconfig.docker.json` is a self-contained copy of the base config).
`--allow-unauthenticated` is at the Cloud Run layer; the app itself enforces Firebase tokens.

Cold starts: `--min-instances 1` keeps one instance warm so a first prayer doesn't wait; it is 0 for
now to keep the idle cost at zero.

Verify after every deploy:

```sh
URL=$(gcloud run services describe llm-proxy --project wind-spirit-prod --region us-central1 --format 'value(status.url)')
curl -s "$URL/health?deep=1" | jq          # .openrouter is "disabled" until a real key version exists
```

## Local development

```sh
gcloud auth application-default login          # ADC for Vertex + Firestore + Firebase Admin
export GOOGLE_CLOUD_QUOTA_PROJECT=wind-spirit-prod
pnpm --filter @wind-spirit/llm-proxy dev        # tsx watch on :8080
# optional while iterating without a Firebase token:
REQUIRE_AUTH=false pnpm --filter @wind-spirit/llm-proxy dev
curl -s "localhost:8080/health?deep=1" | jq
```

Unit tests: `pnpm --filter @wind-spirit/llm-proxy test` (request validation, quota keys, pricing/cost,
provider selection, usage normalisation, Anthropic/OpenAI/OpenRouter request shaping, SSE parsing, JSON
extraction/validation, the OpenRouter disabled path and pricing-refresh parser with a mocked fetch).
Locally, export a real `OPENROUTER_API_KEY` (from your own OpenRouter account; never the prod secret
value) to exercise the OpenRouter models. The live model calls are exercised by `/health?deep=1` and the post-deploy curls.

Getting an ID token for manual testing: with the web config in `firebase-web-config.json`, call
`signInAnonymously` from the Firebase JS SDK and use `getIdToken()`. From a shell:

```sh
KEY=$(jq -r .apiKey services/llm-proxy/firebase-web-config.json)
TOKEN=$(curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$KEY" \
  -H 'Content-Type: application/json' -d '{"returnSecureToken":true}' | jq -r .idToken)
curl -s "$URL/v1/models" -H "Authorization: Bearer $TOKEN" | jq .classes
```


See MODELS.md §6 for the recommended class configuration and OpenRouter alternates from the evals.
