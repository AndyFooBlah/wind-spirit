/** All runtime configuration comes from the environment; model ids are never hard-coded elsewhere. */
import { MODELS } from './models.js';

export const MODEL_CLASSES = ['cheapest', 'cheap', 'routine', 'capable', 'premium'] as const;
export type ModelClass = (typeof MODEL_CLASSES)[number];

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`env ${name} must be a number, got ${JSON.stringify(v)}`);
  return n;
}

function list(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  if (v === undefined || v.trim() === '') return fallback;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Every catalog model that verified live on 2026-09-12 (see MODELS.md); the default eval allowlist. */
const DEFAULT_EVAL_MODELS = Object.values(MODELS)
  .filter((m) => m.provider !== 'anthropic') // Claude needs a console click-through first; add via EVAL_MODELS once enabled
  .map((m) => m.id);

export const config = {
  port: num('PORT', 8080),
  project: process.env.GOOGLE_CLOUD_PROJECT ?? 'wind-spirit-prod',
  /** Gemini 3.x on Vertex AI requires the global endpoint; regional endpoints 404. */
  location: process.env.VERTEX_LOCATION ?? 'global',
  /** Claude on Vertex: Haiku 4.5 and Sonnet 5 both serve on the global endpoint. */
  anthropicLocation: process.env.ANTHROPIC_LOCATION ?? 'global',
  /** MaaS open models: most serve only on the global endpoint; per-model overrides live in the catalog. */
  maasLocation: process.env.MAAS_LOCATION ?? 'global',
  models: {
    cheapest: process.env.MODEL_CHEAPEST ?? 'gemini-2.5-flash-lite',
    cheap: process.env.MODEL_CHEAP ?? 'gemini-3.5-flash-lite',
    routine: process.env.MODEL_ROUTINE ?? 'gemini-3.8-flash',
    capable: process.env.MODEL_CAPABLE ?? 'gemini-3.1-pro-preview',
    premium: process.env.MODEL_PREMIUM ?? 'gemini-3.1-pro-preview',
  } satisfies Record<ModelClass, string>,
  /** Explicit `model` ids a request may name (evals). Anything else is a 400. */
  evalModels: list('EVAL_MODELS', DEFAULT_EVAL_MODELS),
  requireAuth: (process.env.REQUIRE_AUTH ?? 'true').toLowerCase() !== 'false',
  /** Model calls need a redeemed invitation code (see invites.ts). Off only for local development. */
  requireInvite: (process.env.REQUIRE_INVITE ?? 'true').toLowerCase() !== 'false',
  invitesCollection: process.env.INVITES_COLLECTION ?? 'invites',
  playersCollection: process.env.PLAYERS_COLLECTION ?? 'players',
  dailyTokenQuota: num('DAILY_TOKEN_QUOTA', 2_000_000),
  requestTimeoutMs: num('REQUEST_TIMEOUT_MS', 120_000),
  quotaCollection: process.env.QUOTA_COLLECTION ?? 'quotas',
  cacheCollection: process.env.CACHE_COLLECTION ?? 'caches',
  maxBodyBytes: num('MAX_BODY_BYTES', 2_000_000),
  /**
   * OpenRouter. The API key itself is NOT here: `providers/openrouter.ts` reads OPENROUTER_API_KEY from
   * the environment at call time so it can never end up in a logged config dump.
   */
  openrouter: {
    /** Send `response_format: json_schema` to models whose supported_parameters include structured_outputs. Default: instruct + validate. */
    nativeJson: (process.env.OPENROUTER_NATIVE_JSON ?? 'false').toLowerCase() === 'true',
    /** App attribution headers (HTTP-Referer / X-OpenRouter-Title). */
    referer: process.env.OPENROUTER_REFERER ?? 'https://wind-spirit-prod.web.app',
    title: process.env.OPENROUTER_TITLE ?? 'Wind Spirit',
    /** How often to re-pull prices from the public models listing (0 disables the timer). */
    pricingRefreshMs: num('OPENROUTER_PRICING_REFRESH_MS', 3_600_000),
  },
} as const;

export function isModelClass(v: unknown): v is ModelClass {
  return typeof v === 'string' && (MODEL_CLASSES as readonly string[]).includes(v);
}
