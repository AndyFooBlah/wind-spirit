/**
 * TypeSafe System One (Jev). Not a `Provider`: System One answers typed judgments, not text, so it has its own
 * request shape and its own route rather than being squeezed into `/v1/generate`.
 *
 *   POST https://api.typesafe.ai/v1/systemone
 *   Authorization: Bearer $TYPESAFE_API_KEY   (Secret Manager `typesafe-api-key`, injected by Cloud Run)
 *
 * The proxy does not know what the questions mean. It holds the key, enforces auth, invitation and quota, and
 * forwards the body — the same division as `/v1/generate`, where prompts are the client's business. Question
 * definitions live in `packages/agents/src/judge/`, where they are tested.
 *
 * The key is read from the environment at call time and is never logged, never written anywhere and never
 * returned to a client. When it is missing (or is the placeholder literal `unset`) the route answers 503.
 */
import { HttpError } from './errors.js';

export const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
const PLACEHOLDER = 'unset';

/** $42 per billion input tokens; output is free. docs.typesafe.ai/models, verified 2026-09-17. */
export const TYPESAFE_USD_PER_INPUT_TOKEN = 42 / 1e9;

/** The API key, or undefined when the route is disabled. Keep this value out of every log line. */
export function typesafeApiKey(): string | undefined {
  const k = process.env.TYPESAFE_API_KEY?.trim();
  return k && k !== PLACEHOLDER ? k : undefined;
}

export function typesafeEnabled(): boolean {
  return typesafeApiKey() !== undefined;
}

export interface SystemOneBody { state: unknown; questions: Record<string, unknown>; model?: string }
export interface SystemOneUpstream {
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
}

/** Validate only what the proxy needs to route and bill; the meaning of a question is the client's business. */
export function parseSystemOneBody(raw: unknown): SystemOneBody {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new HttpError(400, 'bad_request', 'body must be a JSON object');
  const b = raw as Record<string, unknown>;
  if (!('state' in b)) throw new HttpError(400, 'bad_request', 'state is required');
  const q = b.questions;
  if (typeof q !== 'object' || q === null || Array.isArray(q)) throw new HttpError(400, 'bad_request', 'questions must be an object keyed by question name');
  if (Object.keys(q).length === 0) throw new HttpError(400, 'bad_request', 'questions must not be empty');
  if (b.model !== undefined && typeof b.model !== 'string') throw new HttpError(400, 'bad_request', 'model must be a string');
  return { state: b.state, questions: q as Record<string, unknown>, ...(b.model ? { model: b.model as string } : {}) };
}

export async function systemOne(body: SystemOneBody, signal: AbortSignal): Promise<SystemOneUpstream> {
  const key = typesafeApiKey();
  if (!key) throw new HttpError(503, 'provider_disabled', 'TYPESAFE_API_KEY not set on this deployment');
  const res = await fetch(TYPESAFE_URL, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: body.model ?? 'jev-latest', state: body.state, questions: body.questions }),
  });
  const text = await res.text();
  if (!res.ok) {
    // Upstream messages can echo the request; pass the status and a short body through, never the key.
    const status = res.status === 401 || res.status === 403 ? 502 : res.status;
    throw new HttpError(status, 'upstream_error', `typesafe ${res.status}: ${text.slice(0, 300)}`);
  }
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new HttpError(502, 'bad_upstream', 'typesafe did not answer with JSON'); }
  const u = json as Partial<SystemOneUpstream>;
  if (!u || typeof u !== 'object' || !u.answers || !u.usage) throw new HttpError(502, 'bad_upstream', 'typesafe answer had no answers or usage');
  return { model: String(u.model ?? body.model ?? 'jev-latest'), answers: u.answers, usage: { input_tokens: Number(u.usage.input_tokens ?? 0), output_tokens: Number(u.usage.output_tokens ?? 0) } };
}
