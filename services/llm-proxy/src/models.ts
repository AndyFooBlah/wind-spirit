/**
 * The model catalog: every model id the proxy knows how to call, with its provider, the endpoint
 * location, and the list price per 1M tokens used for the per-request cost estimate.
 *
 * Prices are USD per 1M tokens (pay-as-you-go, on-demand, <=200K context) and were verified
 * 2026-09-12 against the Cloud Billing Catalog (Vertex AI service C7E2-9256-1C43) or, where a
 * model is billed through Marketplace and has no catalog SKU, the public pricing page. See
 * MODELS.md for the SKU ids and sources. Update this table when prices change; it is served on
 * GET /v1/models so the eval runner can recompute costs.
 */
export type ProviderName = 'gemini' | 'anthropic' | 'openai-compat';

export interface Pricing {
  /** Uncached input tokens. */
  input: number;
  /** Output tokens (thinking tokens are billed as output on every provider here). */
  output: number;
  /** Cache-read (cache hit) tokens. */
  cacheRead: number;
  /** Cache-write tokens (Anthropic 5-minute cache write). Same as input where writes are not billed extra. */
  cacheWrite: number;
}

export interface ModelInfo {
  id: string;
  provider: ProviderName;
  /** Vertex location; `global` for most. Overrides the provider default when set. */
  location?: string;
  pricing: Pricing;
  /** Whether the provider endpoint enforces a JSON schema natively for this model. */
  nativeJsonSchema: boolean;
  /** Minimum prefix tokens for a context cache to be created/hit (0 = unsupported). */
  minCacheTokens: number;
  /** Short note surfaced on /v1/models (deprecations, enablement, regions). */
  note?: string;
}

const GEMINI_LOCATION_NOTE = 'Gemini 3.x requires the global endpoint';

export const MODELS: Record<string, ModelInfo> = {
  // ---- Google Gemini (Vertex AI, ADC, global endpoint) ----
  'gemini-3.8-flash': {
    id: 'gemini-3.8-flash', provider: 'gemini',
    pricing: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 1.5 },
    nativeJsonSchema: true, minCacheTokens: 4096, note: `baseline; ${GEMINI_LOCATION_NOTE}`,
  },
  'gemini-3.6-flash': {
    id: 'gemini-3.6-flash', provider: 'gemini',
    pricing: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 1.5 },
    nativeJsonSchema: true, minCacheTokens: 4096, note: GEMINI_LOCATION_NOTE,
  },
  'gemini-3.5-flash': {
    id: 'gemini-3.5-flash', provider: 'gemini',
    pricing: { input: 1.5, output: 9.0, cacheRead: 0.15, cacheWrite: 1.5 },
    nativeJsonSchema: true, minCacheTokens: 4096, note: GEMINI_LOCATION_NOTE,
  },
  'gemini-3.5-flash-lite': {
    id: 'gemini-3.5-flash-lite', provider: 'gemini',
    pricing: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0.3 },
    nativeJsonSchema: true, minCacheTokens: 4096, note: GEMINI_LOCATION_NOTE,
  },
  'gemini-3.1-flash-lite': {
    id: 'gemini-3.1-flash-lite', provider: 'gemini',
    pricing: { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0.25 },
    nativeJsonSchema: true, minCacheTokens: 4096, note: GEMINI_LOCATION_NOTE,
  },
  'gemini-3.1-pro-preview': {
    id: 'gemini-3.1-pro-preview', provider: 'gemini',
    pricing: { input: 2.0, output: 12.0, cacheRead: 0.2, cacheWrite: 2.0 },
    nativeJsonSchema: true, minCacheTokens: 4096, note: `implicit caching only per docs (6,144 min); ${GEMINI_LOCATION_NOTE}`,
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash', provider: 'gemini',
    pricing: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0.3 },
    nativeJsonSchema: true, minCacheTokens: 2048,
  },
  'gemini-2.5-flash-lite': {
    id: 'gemini-2.5-flash-lite', provider: 'gemini',
    pricing: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0.1 },
    nativeJsonSchema: true, minCacheTokens: 2048,
  },

  // ---- Anthropic Claude on Vertex AI (Marketplace-billed; needs Model Garden "Enable" click-through) ----
  'claude-haiku-4-5': {
    id: 'claude-haiku-4-5', provider: 'anthropic',
    pricing: { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
    nativeJsonSchema: false, minCacheTokens: 4096,
    note: 'requires Model Garden Enable (console click-through) in the project; global endpoint',
  },
  'claude-sonnet-5': {
    id: 'claude-sonnet-5', provider: 'anthropic',
    pricing: { input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 },
    nativeJsonSchema: false, minCacheTokens: 1024,
    note: 'requires Model Garden Enable (console click-through) in the project; global endpoint',
  },

  // ---- Open models as managed APIs (MaaS), OpenAI-compatible chat completions endpoint ----
  'openai/gpt-oss-120b-maas': {
    id: 'openai/gpt-oss-120b-maas', provider: 'openai-compat',
    pricing: { input: 0.09, output: 0.36, cacheRead: 0.09, cacheWrite: 0.09 },
    nativeJsonSchema: true, minCacheTokens: 0, note: 'reasoning tokens are billed as output; no cache-hit price published',
  },
  'openai/gpt-oss-20b-maas': {
    id: 'openai/gpt-oss-20b-maas', provider: 'openai-compat', location: 'us-central1',
    pricing: { input: 0.07, output: 0.25, cacheRead: 0.007, cacheWrite: 0.07 },
    nativeJsonSchema: true, minCacheTokens: 0, note: 'us-central1 only (not on the global endpoint)',
  },
  'deepseek-ai/deepseek-v3.2-maas': {
    id: 'deepseek-ai/deepseek-v3.2-maas', provider: 'openai-compat',
    pricing: { input: 0.56, output: 1.68, cacheRead: 0.056, cacheWrite: 0.56 },
    nativeJsonSchema: true, minCacheTokens: 0, note: 'deprecated 2026-07-21, retires 2026-10-21',
  },
  'deepseek-ai/deepseek-r1-0528-maas': {
    id: 'deepseek-ai/deepseek-r1-0528-maas', provider: 'openai-compat', location: 'us-central1',
    pricing: { input: 1.35, output: 5.4, cacheRead: 1.35, cacheWrite: 1.35 },
    nativeJsonSchema: false, minCacheTokens: 0, note: 'us-central1 only; emits <think> reasoning in content, expensive',
  },
  'qwen/qwen3-235b-a22b-instruct-2507-maas': {
    id: 'qwen/qwen3-235b-a22b-instruct-2507-maas', provider: 'openai-compat',
    pricing: { input: 0.22, output: 0.88, cacheRead: 0.22, cacheWrite: 0.22 },
    nativeJsonSchema: true, minCacheTokens: 0, note: 'deprecated 2026-07-21, retires 2026-10-21; reports cached_tokens but no cache-hit SKU',
  },
  'qwen/qwen3-next-80b-a3b-instruct-maas': {
    id: 'qwen/qwen3-next-80b-a3b-instruct-maas', provider: 'openai-compat',
    pricing: { input: 0.15, output: 1.2, cacheRead: 0.15, cacheWrite: 0.15 },
    nativeJsonSchema: true, minCacheTokens: 0, note: 'deprecated 2026-07-21, retires 2026-10-21',
  },
  'google/gemma-4-26b-a4b-it-maas': {
    id: 'google/gemma-4-26b-a4b-it-maas', provider: 'openai-compat',
    pricing: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0.15 },
    nativeJsonSchema: true, minCacheTokens: 0, note: 'global endpoint only',
  },
};

export function modelInfo(id: string): ModelInfo | undefined {
  return MODELS[id];
}

/** Normalised usage shared by every provider. `input` includes cached and cache-write tokens. */
export interface Usage {
  input: number;
  /** Billed output tokens: visible text plus hidden thinking. */
  output: number;
  thoughts: number;
  /** Tokens served from a context/prompt cache (billed at cacheRead). */
  cached: number;
  /** Tokens written to a prompt cache this call (billed at cacheWrite; 0 where writes are not billed separately). */
  cacheWrite: number;
}

export const ZERO_USAGE: Usage = { input: 0, output: 0, thoughts: 0, cached: 0, cacheWrite: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    thoughts: a.thoughts + b.thoughts,
    cached: a.cached + b.cached,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/** Estimated USD cost of a call from the pricing table. Unknown models cost 0 (and are flagged in the log). */
export function estimateCost(modelId: string, u: Usage): number {
  const m = MODELS[modelId];
  if (!m) return 0;
  const p = m.pricing;
  const uncached = Math.max(0, u.input - u.cached - u.cacheWrite);
  const usd =
    (uncached * p.input + u.cached * p.cacheRead + u.cacheWrite * p.cacheWrite + u.output * p.output) / 1_000_000;
  return Math.round(usd * 1e8) / 1e8;
}
