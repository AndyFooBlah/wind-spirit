import { createHash } from 'node:crypto';
import { HttpError } from './errors.js';
import { config, isModelClass, type ModelClass } from './config.js';
import type { Message } from './providers/types.js';

export type { Message };

export interface GenerateRequest {
  /** Model class; required unless `model` names an allowlisted id. */
  class?: ModelClass;
  /** Explicit model id (evals only); must be in EVAL_MODELS. */
  model?: string;
  system?: string;
  messages: Message[];
  schema?: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
  /** Opaque client label for cache diagnostics; logged, never sent to the model. */
  cacheKey?: string;
  /** Explicit context cache: create/reuse a cache of the system prompt (+ stable messages) under this key. */
  cache?: { key: string; ttlSeconds: number };
  /** Optional passthrough to Gemini's thinkingLevel (e.g. 'low' for routine calls). */
  thinkingLevel?: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate an untrusted JSON body into a GenerateRequest. Throws HttpError(400). */
export function parseGenerateRequest(body: unknown): GenerateRequest {
  if (!isObject(body)) throw new HttpError(400, 'bad_request', 'body must be a JSON object');
  const cls = body.class;
  if (cls !== undefined && !isModelClass(cls)) {
    throw new HttpError(400, 'bad_request', "class must be one of 'cheap', 'routine', 'capable', 'premium'");
  }
  let model: string | undefined;
  if (body.model !== undefined) {
    if (typeof body.model !== 'string' || body.model.length > 120) {
      throw new HttpError(400, 'bad_request', 'model must be a string');
    }
    if (!config.evalModels.includes(body.model)) {
      throw new HttpError(400, 'bad_request', `model ${JSON.stringify(body.model)} is not in the EVAL_MODELS allowlist (see GET /v1/models)`);
    }
    model = body.model;
  }
  if (cls === undefined && model === undefined) {
    throw new HttpError(400, 'bad_request', 'class or model is required');
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new HttpError(400, 'bad_request', 'messages must be a non-empty array');
  }
  const messages: Message[] = body.messages.map((m, i) => {
    if (!isObject(m) || (m.role !== 'user' && m.role !== 'model') || typeof m.text !== 'string') {
      throw new HttpError(400, 'bad_request', `messages[${i}] must be {role:'user'|'model', text:string}`);
    }
    if (m.stable !== undefined && typeof m.stable !== 'boolean') {
      throw new HttpError(400, 'bad_request', `messages[${i}].stable must be a boolean`);
    }
    return m.stable ? { role: m.role, text: m.text, stable: true } : { role: m.role, text: m.text };
  });
  if (messages[messages.length - 1]!.role !== 'user') {
    throw new HttpError(400, 'bad_request', 'last message must have role user');
  }
  const req: GenerateRequest = { messages };
  if (cls !== undefined) req.class = cls;
  if (model !== undefined) req.model = model;
  if (body.system !== undefined) {
    if (typeof body.system !== 'string') throw new HttpError(400, 'bad_request', 'system must be a string');
    req.system = body.system;
  }
  if (body.schema !== undefined) {
    if (!isObject(body.schema)) throw new HttpError(400, 'bad_request', 'schema must be a JSON schema object');
    req.schema = body.schema;
  }
  if (body.maxOutputTokens !== undefined) {
    const n = body.maxOutputTokens;
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0 || n > 65_536) {
      throw new HttpError(400, 'bad_request', 'maxOutputTokens must be an integer in 1..65536');
    }
    req.maxOutputTokens = n;
  }
  if (body.temperature !== undefined) {
    const t = body.temperature;
    if (typeof t !== 'number' || !(t >= 0 && t <= 2)) {
      throw new HttpError(400, 'bad_request', 'temperature must be a number in 0..2');
    }
    req.temperature = t;
  }
  if (body.cacheKey !== undefined) {
    if (typeof body.cacheKey !== 'string' || body.cacheKey.length > 200) {
      throw new HttpError(400, 'bad_request', 'cacheKey must be a string of at most 200 chars');
    }
    req.cacheKey = body.cacheKey;
  }
  if (body.cache !== undefined) {
    const c = body.cache;
    if (!isObject(c) || typeof c.key !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(c.key)) {
      throw new HttpError(400, 'bad_request', 'cache.key must be a string of 1..120 chars [A-Za-z0-9._:-]');
    }
    const ttl = c.ttlSeconds ?? 3600;
    if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < 60 || ttl > 86_400) {
      throw new HttpError(400, 'bad_request', 'cache.ttlSeconds must be an integer in 60..86400');
    }
    req.cache = { key: c.key, ttlSeconds: ttl };
  }
  if (body.thinkingLevel !== undefined) {
    if (typeof body.thinkingLevel !== 'string' || !/^[a-z]{1,16}$/.test(body.thinkingLevel)) {
      throw new HttpError(400, 'bad_request', 'thinkingLevel must be a short lowercase string');
    }
    req.thinkingLevel = body.thinkingLevel;
  }
  return req;
}

/** The model id a request resolves to: the explicit allowlisted id, else the class mapping. */
export function resolveModel(req: GenerateRequest): string {
  // A class may be pointed at an id outside the catalog (a brand-new model); providerFor() defaults that to Gemini.
  return req.model ?? config.models[req.class!];
}

/** sha256 of the prompt (system + messages) for cache diagnostics. The hash is logged; the prompt is not. */
export function promptHash(req: GenerateRequest): string {
  return createHash('sha256')
    .update(JSON.stringify({ system: req.system ?? null, messages: req.messages.map((m) => ({ role: m.role, text: m.text })) }))
    .digest('hex');
}
