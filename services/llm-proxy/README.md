# @wind-spirit/llm-proxy

The model proxy from `docs/technical-design.md` §9. A small Node 24 HTTP service on Cloud Run that
verifies Firebase ID tokens, enforces a per-user daily token quota (Firestore), maps a model *class*
to a Gemini model id, calls Vertex AI with Application Default Credentials, and logs one JSON line
per request. There are no API keys anywhere: Vertex is reached with the runtime service account.

- Service URL (prod): `https://llm-proxy-406179055859.us-central1.run.app`
- GCP project: `wind-spirit-prod`, region `us-central1`, runtime SA `llm-proxy-sa@wind-spirit-prod.iam.gserviceaccount.com`
- Firebase web app config for the browser client: `firebase-web-config.json` (public client config, not a secret)

## API

All `/v1/*` routes require `Authorization: Bearer <Firebase ID token>` (anonymous auth is fine)
unless the service runs with `REQUIRE_AUTH=false`, in which case quotas are keyed by client IP.
CORS allows any origin with the `Authorization` and `Content-Type` headers.

### `POST /v1/generate`

Request body:

```jsonc
{
  "class": "routine" | "capable",       // model class; the client never names a model id
  "system": "optional system prompt",
  "messages": [{ "role": "user" | "model", "text": "..." }],   // last message must be role user
  "schema": { /* JSON schema */ },      // optional: structured output (responseMimeType application/json)
  "maxOutputTokens": 1024,              // optional, 1..65536
  "temperature": 0.7,                   // optional, 0..2
  "cacheKey": "village:abc",            // optional label; logged for cache diagnostics only
  "thinkingLevel": "low"                // optional passthrough to Gemini thinkingConfig.thinkingLevel
}
```

Response `200`:

```jsonc
{
  "text": "...",
  "json": { },                          // present when schema was given; parsed model output
  "usage": { "input": 123, "output": 45, "thoughts": 30 },   // output includes hidden thinking tokens
  "model": "gemini-3.8-flash",
  "ms": 812,
  "finishReason": "STOP"
}
```

When `schema` is given the model output is parsed as JSON; on parse failure the call is retried once,
then the proxy answers `502 {"error":"bad_model_output"}`.

### `POST /v1/stream`

Same body. Responds with Server-Sent Events:

```
data: {"text":"chunk"}
data: {"text":"chunk"}
data: {"done":true,"usage":{"input":..,"output":..,"thoughts":..},"model":"gemini-3.1-pro-preview","ms":1234}
```

A mid-stream failure ends the stream with `data: {"error":"...","message":"..."}`.

### `GET /health`

`{ ok: true, models: { routine, capable }, requireAuth, location }`. Add `?deep=1` to run a tiny
generation on each class and get `{ deep: { routine: {ok, ms, model, ...}, capable: {...} } }`
(503 if either fails). No auth required. `/healthz` is accepted as an alias, but on Cloud Run the Google
Frontend intercepts exactly `/healthz` on `*.run.app` and returns its own HTML 404, so use `/health` there.

### Errors

| Status | `error` | Meaning |
|---|---|---|
| 400 | `bad_request` | body failed validation (`message` says why) |
| 401 | `unauthorized` | missing/invalid Firebase ID token (only when `REQUIRE_AUTH=true`) |
| 413 | `too_large` | body over `MAX_BODY_BYTES` |
| 429 | `quota` | daily token quota used; `resetAt` is the next UTC midnight |
| 502 | `upstream` / `bad_model_output` | Vertex rejected the call, or JSON output never parsed |
| 503 | `quota_unavailable` | Firestore unreachable (fails closed: the quota is the cost backstop) |
| 504 | `timeout` | model call exceeded `REQUEST_TIMEOUT_MS` |

## Environment

| Var | Default | Notes |
|---|---|---|
| `MODEL_ROUTINE` | `gemini-3.8-flash` | model id for `class: routine`; verify against the live Vertex model list before changing |
| `MODEL_CAPABLE` | `gemini-3.1-pro-preview` | model id for `class: capable`; note `gemini-3.1-pro` (no suffix) does not exist on Vertex as of 2026-09-12 |
| `GOOGLE_CLOUD_PROJECT` | `wind-spirit-prod` | Vertex + Firebase project |
| `VERTEX_LOCATION` | `global` | Gemini 3.x on Vertex requires the global endpoint; regional 404s |
| `REQUIRE_AUTH` | `true` | `false` keys quotas by client IP instead of requiring a token |
| `DAILY_TOKEN_QUOTA` | `2000000` | input+output tokens per principal per UTC day |
| `REQUEST_TIMEOUT_MS` | `120000` | per-request model timeout |
| `QUOTA_COLLECTION` | `quotas` | Firestore collection; doc id `YYYY-MM-DD_<kind>_<id>` |
| `MAX_BODY_BYTES` | `2000000` | request body cap |
| `PORT` | `8080` | set by Cloud Run |

Model ids live only here. Clients send a class. When Google ships new models, change the env var
on the service (`gcloud run services update llm-proxy --update-env-vars MODEL_ROUTINE=...`) and
check `/health?deep=1`.

## Logging

One JSON line per request: `route, class, model, principal (uid, or hashed ip), cacheKey,
promptSha256, inputTokens, outputTokens, thoughtTokens, status, ms`. Prompt bodies are never logged.
Cloud Logging picks up `severity`.

## Deploy

Prerequisites (done once, 2026-09-12): Firebase added to the project, Anonymous sign-in enabled,
Firestore native database in `nam5`, service account `llm-proxy-sa` with `roles/aiplatform.user` and
`roles/datastore.user`.

```sh
cd /path/to/wind-spirit
gcloud run deploy llm-proxy \
  --source services/llm-proxy \
  --project wind-spirit-prod --region us-central1 \
  --service-account llm-proxy-sa@wind-spirit-prod.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=wind-spirit-prod,VERTEX_LOCATION=global,MODEL_ROUTINE=gemini-3.8-flash,MODEL_CAPABLE=gemini-3.1-pro-preview,REQUIRE_AUTH=true,DAILY_TOKEN_QUOTA=2000000 \
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
curl -s "$URL/health?deep=1" | jq
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

Unit tests: `pnpm --filter @wind-spirit/llm-proxy test` (validation and quota keys; the model calls are
exercised by `/health?deep=1` and the post-deploy curls).

Getting an ID token for manual testing: with the web config in `firebase-web-config.json`, call
`signInAnonymously` from the Firebase JS SDK and use `getIdToken()`. From a shell you can also use
the Identity Toolkit REST endpoint `accounts:signUp` with the web API key and an empty body, which
returns an anonymous user's `idToken` (see the Firebase Auth REST docs).
