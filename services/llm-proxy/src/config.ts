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

function oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  if (v === '') return fallback;
  if (!(allowed as readonly string[]).includes(v)) throw new Error(`env ${name} must be one of ${allowed.join('|')}, got ${JSON.stringify(v)}`);
  return v as T;
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
  /**
   * Brakes on the invitation gate (see throttle.ts). Redemption attempts are counted per uid and per client IP
   * in Firestore so they survive restarts; a run of consecutive bad codes locks the key out for a day.
   */
  invite: {
    attemptsCollection: process.env.INVITE_ATTEMPTS_COLLECTION ?? 'inviteAttempts',
    windowMs: num('INVITE_WINDOW_MS', 15 * 60_000),
    /** Redemption attempts per uid per window. A real player needs one or two. */
    uidAttempts: num('INVITE_UID_ATTEMPTS', 5),
    /** Per client IP per window; higher so a household behind one NAT can all redeem at once. */
    ipAttempts: num('INVITE_IP_ATTEMPTS', 20),
    /** Consecutive wrong codes from one uid before it is locked out. */
    lockoutFailures: num('INVITE_LOCKOUT_FAILURES', 10),
    /** Same for one IP; higher because an IP is shared, so it only bites on a sustained run from one address. */
    ipLockoutFailures: num('INVITE_IP_LOCKOUT_FAILURES', 40),
    lockoutMs: num('INVITE_LOCKOUT_MS', 24 * 3_600_000),
    /** Requests an uninvited uid may make to gated routes per window before it is answered 429 without a lookup (per instance). */
    uninvitedRequests: num('UNINVITED_REQUESTS', 30),
  },
  /**
   * Firebase App Check (see appcheck.ts): `off` ignores the header, `log` verifies and records the outcome without
   * blocking, `enforce` answers 401 unless the request carries a valid token from one of the allowed app ids.
   */
  appCheck: oneOf('APP_CHECK', ['off', 'log', 'enforce'] as const, 'off'),
  appCheckAppIds: list('APP_CHECK_APP_IDS', ['1:406179055859:web:c8e690b638cdd7e7944f86']),
  /** `/health?deep=1` makes five paid model calls with no auth; at most one deep probe per interval per instance. */
  deepHealthMinIntervalMs: num('DEEP_HEALTH_MIN_INTERVAL_MS', 60_000),
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
