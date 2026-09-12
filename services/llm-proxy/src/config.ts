/** All runtime configuration comes from the environment; model ids are never hard-coded elsewhere. */
export type ModelClass = 'routine' | 'capable';

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`env ${name} must be a number, got ${JSON.stringify(v)}`);
  return n;
}

export const config = {
  port: num('PORT', 8080),
  project: process.env.GOOGLE_CLOUD_PROJECT ?? 'wind-spirit-prod',
  /** Gemini 3.x on Vertex AI requires the global endpoint; regional endpoints 404. */
  location: process.env.VERTEX_LOCATION ?? 'global',
  models: {
    routine: process.env.MODEL_ROUTINE ?? 'gemini-3.8-flash',
    capable: process.env.MODEL_CAPABLE ?? 'gemini-3.1-pro-preview',
  } satisfies Record<ModelClass, string>,
  requireAuth: (process.env.REQUIRE_AUTH ?? 'true').toLowerCase() !== 'false',
  dailyTokenQuota: num('DAILY_TOKEN_QUOTA', 2_000_000),
  requestTimeoutMs: num('REQUEST_TIMEOUT_MS', 120_000),
  quotaCollection: process.env.QUOTA_COLLECTION ?? 'quotas',
  maxBodyBytes: num('MAX_BODY_BYTES', 2_000_000),
} as const;
