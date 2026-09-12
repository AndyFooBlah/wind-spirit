import { createHash } from 'node:crypto';
import { HttpError } from './errors.js';
import type { ModelClass } from './config.js';

export interface Message {
  role: 'user' | 'model';
  text: string;
}

export interface GenerateRequest {
  class: ModelClass;
  system?: string;
  messages: Message[];
  schema?: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
  /** Opaque client label for cache diagnostics; logged, never sent to the model. */
  cacheKey?: string;
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
  if (cls !== 'routine' && cls !== 'capable') {
    throw new HttpError(400, 'bad_request', "class must be 'routine' or 'capable'");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new HttpError(400, 'bad_request', 'messages must be a non-empty array');
  }
  const messages: Message[] = body.messages.map((m, i) => {
    if (!isObject(m) || (m.role !== 'user' && m.role !== 'model') || typeof m.text !== 'string') {
      throw new HttpError(400, 'bad_request', `messages[${i}] must be {role:'user'|'model', text:string}`);
    }
    return { role: m.role, text: m.text };
  });
  if (messages[messages.length - 1]!.role !== 'user') {
    throw new HttpError(400, 'bad_request', 'last message must have role user');
  }
  const req: GenerateRequest = { class: cls, messages };
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
  if (body.thinkingLevel !== undefined) {
    if (typeof body.thinkingLevel !== 'string' || !/^[a-z]{1,16}$/.test(body.thinkingLevel)) {
      throw new HttpError(400, 'bad_request', 'thinkingLevel must be a short lowercase string');
    }
    req.thinkingLevel = body.thinkingLevel;
  }
  return req;
}

/** sha256 of the prompt (system + messages) for cache diagnostics. The hash is logged; the prompt is not. */
export function promptHash(req: GenerateRequest): string {
  return createHash('sha256')
    .update(JSON.stringify({ system: req.system ?? null, messages: req.messages }))
    .digest('hex');
}
