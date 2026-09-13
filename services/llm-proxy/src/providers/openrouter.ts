import { config } from '../config.js';
import { MODELS, modelInfo, type ModelInfo, type Pricing } from '../models.js';
import { errorFields, log } from '../log.js';
import { chatBody, completionResult, completionStream, postChat } from './chat-completions.js';
import type { Provider, ProviderRequest, ProviderResult, StreamEvent } from './types.js';

/**
 * OpenRouter: one API key, many vendors, OpenAI-compatible chat completions.
 *
 *   POST https://openrouter.ai/api/v1/chat/completions
 *   Authorization: Bearer $OPENROUTER_API_KEY   (Secret Manager `openrouter-api-key`, injected by Cloud Run)
 *
 * The key is read from the environment at call time and is never logged, never written anywhere and
 * never returned to a client. When it is missing (or is the placeholder literal `unset`) the provider
 * reports itself unavailable: the server answers 503 `provider_disabled`, `/v1/models` lists the
 * models with `available: false`, and `/health` shows `openrouter: disabled`.
 *
 * JSON output is instruct-and-validate by default (the same lesson as Vertex MaaS: constrained
 * decoding stripped optional fields). Native `response_format: json_schema` is sent only when the
 * model's OpenRouter `supported_parameters` includes `structured_outputs` AND
 * `OPENROUTER_NATIVE_JSON=true`.
 *
 * Usage accounting needs no request option: OpenRouter always returns `usage` with `cost` (credits,
 * USD), `prompt_tokens_details.{cached_tokens,cache_write_tokens}` and
 * `completion_tokens_details.reasoning_tokens`; in streams it rides on the last SSE chunk. The
 * `usage: {include: true}` / `stream_options.include_usage` flags are documented as deprecated no-ops
 * (https://openrouter.ai/docs/use-cases/usage-accounting), so the adapter does not send them.
 */
export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const PLACEHOLDER = 'unset';

/** The API key, or undefined when the provider is disabled. Keep this value out of every log line. */
export function openrouterApiKey(): string | undefined {
  const k = process.env.OPENROUTER_API_KEY?.trim();
  return k && k !== PLACEHOLDER ? k : undefined;
}

export function openrouterEnabled(): boolean {
  return openrouterApiKey() !== undefined;
}

export const DISABLED_NOTE = 'OPENROUTER_API_KEY not set';

/** Native JSON schema is opt-in per deployment and per model capability. */
export function useNativeJson(model: string, info: ModelInfo | undefined = modelInfo(model)): boolean {
  return config.openrouter.nativeJson && (info?.supportedParameters?.includes('structured_outputs') ?? false);
}

const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);

/** Build the chat completions body. Exported for tests. */
export function toBody(req: ProviderRequest, stream: boolean): Record<string, unknown> {
  // OpenRouter always attaches usage (with cost) to the final chunk; no stream_options needed.
  const body = chatBody(req, { nativeJson: useNativeJson(req.model), stream, streamUsageOption: false });
  // The proxy's thinkingLevel maps onto OpenRouter's unified `reasoning.effort`; unsupported values are dropped
  // and models without reasoning ignore the field.
  if (req.thinkingLevel && REASONING_EFFORTS.has(req.thinkingLevel)) body.reasoning = { effort: req.thinkingLevel };
  return body;
}

function headers(): Record<string, string> {
  const key = openrouterApiKey();
  if (!key) throw new Error(DISABLED_NOTE);
  return {
    Authorization: `Bearer ${key}`,
    'HTTP-Referer': config.openrouter.referer,
    'X-OpenRouter-Title': config.openrouter.title,
    'X-Title': config.openrouter.title, // legacy name, still accepted
  };
}

function cacheNote(req: ProviderRequest): string | undefined {
  return req.cache ? 'openrouter: provider-side automatic caching only; cached_tokens reported when hit' : undefined;
}

export const openrouterProvider: Provider = {
  name: 'openrouter',
  available: openrouterEnabled,

  async generate(req, signal): Promise<ProviderResult> {
    const res = await postChat(OPENROUTER_CHAT_URL, headers(), toBody(req, false), signal);
    const out = await completionResult(res, req, { costSource: 'openrouter' });
    const note = cacheNote(req);
    return note ? { ...out, cacheNote: note } : out;
  },

  async *stream(req, signal): AsyncGenerator<StreamEvent> {
    const res = await postChat(OPENROUTER_CHAT_URL, headers(), toBody(req, true), signal);
    const note = cacheNote(req);
    for await (const ev of completionStream(res, req, { costSource: 'openrouter' })) {
      yield 'done' in ev && note ? { ...ev, cacheNote: note } : ev;
    }
  },
};

// ---------- live pricing from GET /api/v1/models ----------

interface OpenRouterModel {
  id?: string;
  pricing?: { prompt?: string | number | null; completion?: string | number | null; input_cache_read?: string | number | null; input_cache_write?: string | number | null };
  supported_parameters?: string[] | null;
}

export interface LiveModelInfo {
  pricing: Pricing;
  supportedParameters: string[];
}

function perMillion(v: string | number | null | undefined): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e6) / 1e6 : undefined;
}

/**
 * Normalise OpenRouter per-token prices into the catalog's per-1M shape. `input_cache_read` falls back
 * to the input price when absent (no cache discount). `input_cache_write` is the full per-token price
 * when it is at least the input price (Anthropic, Qwen) and a storage add-on when it is below it
 * (Gemini: "input price plus 5 minutes of storage"), so the catalog value is always what a written
 * token costs in total; absent means writes are not billed separately.
 */
export function pricingFromOpenRouter(p: OpenRouterModel['pricing']): Pricing | undefined {
  const input = perMillion(p?.prompt);
  const output = perMillion(p?.completion);
  if (input === undefined || output === undefined) return undefined;
  const cacheRead = Math.min(input, perMillion(p?.input_cache_read) ?? input);
  const write = perMillion(p?.input_cache_write);
  const cacheWrite = write === undefined ? input : write >= input ? write : Math.round((input + write) * 1e6) / 1e6;
  return { input, output, cacheRead, cacheWrite };
}

/** Parse the public models listing into live info for the given catalog ids. Exported for tests. */
export function parseOpenRouterModels(body: unknown, ids: Iterable<string>): Map<string, LiveModelInfo> {
  const data = (body as { data?: unknown })?.data;
  const out = new Map<string, LiveModelInfo>();
  if (!Array.isArray(data)) return out;
  const wanted = new Set(ids);
  for (const raw of data as OpenRouterModel[]) {
    if (!raw?.id || !wanted.has(raw.id)) continue;
    const pricing = pricingFromOpenRouter(raw.pricing);
    if (!pricing) continue;
    out.set(raw.id, { pricing, supportedParameters: Array.isArray(raw.supported_parameters) ? raw.supported_parameters.filter((s) => typeof s === 'string') : [] });
  }
  return out;
}

export interface PricingStatus {
  source: 'static' | 'openrouter-live';
  fetchedAt?: string;
  updated?: number;
  missing?: string[];
  error?: string;
}

let status: PricingStatus = { source: 'static' };

export function openrouterPricingStatus(): PricingStatus {
  return { ...status };
}

export function openrouterCatalogIds(): string[] {
  return Object.values(MODELS).filter((m) => m.provider === 'openrouter').map((m) => m.id);
}

/** Fetch the public listing and overwrite catalog prices/capabilities in place. Returns the status. */
export async function refreshOpenRouterPricing(fetchImpl: typeof fetch = fetch): Promise<PricingStatus> {
  const ids = openrouterCatalogIds();
  try {
    const res = await fetchImpl(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GET ${OPENROUTER_MODELS_URL} -> ${res.status}`);
    const live = parseOpenRouterModels(await res.json(), ids);
    const missing: string[] = [];
    for (const id of ids) {
      const info = live.get(id);
      if (!info) {
        missing.push(id);
        continue;
      }
      const m = MODELS[id]!;
      m.pricing = info.pricing;
      m.supportedParameters = info.supportedParameters;
    }
    status = { source: live.size > 0 ? 'openrouter-live' : status.source, fetchedAt: new Date().toISOString(), updated: live.size, missing };
    if (missing.length) log('WARNING', 'openrouter models missing from the public listing; static prices kept', { missing });
    else log('INFO', 'openrouter pricing refreshed', { updated: live.size });
  } catch (err) {
    status = { ...status, error: err instanceof Error ? err.message : String(err) };
    log('WARNING', 'openrouter pricing refresh failed; keeping previous prices', errorFields(err));
  }
  return openrouterPricingStatus();
}

/** Refresh at startup and hourly. The timer is unref'd so it never keeps the process alive. */
export function startOpenRouterPricingRefresh(intervalMs = config.openrouter.pricingRefreshMs): void {
  void refreshOpenRouterPricing();
  if (intervalMs > 0) setInterval(() => void refreshOpenRouterPricing(), intervalMs).unref();
}

/** Test hook. */
export function resetOpenRouterPricingStatus(): void {
  status = { source: 'static' };
}
