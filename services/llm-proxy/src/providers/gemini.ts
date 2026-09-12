import {
  GoogleGenAI,
  type Content,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type ThinkingLevel,
} from '@google/genai';
import { config } from '../config.js';
import { modelInfo, type Usage } from '../models.js';
import { contentHash, forget, isTooShort, lookup, markTooShort, remember } from '../cache.js';
import { errorFields, log } from '../log.js';
import type { Provider, ProviderRequest, ProviderResult, StreamEvent } from './types.js';

let client: GoogleGenAI | undefined;

/** Vertex AI via Application Default Credentials. No API keys, anywhere. */
export function ai(): GoogleGenAI {
  client ??= new GoogleGenAI({ vertexai: true, project: config.project, location: config.location });
  return client;
}

export function usageOf(res: GenerateContentResponse | undefined): Usage {
  const u = res?.usageMetadata;
  const thoughts = u?.thoughtsTokenCount ?? 0;
  return {
    input: u?.promptTokenCount ?? 0,
    output: (u?.candidatesTokenCount ?? 0) + thoughts,
    thoughts,
    cached: u?.cachedContentTokenCount ?? 0,
    cacheWrite: 0, // Gemini bills cache creation at the plain input price; no separate write tier
  };
}

function toContent(m: { role: 'user' | 'model'; text: string }): Content {
  return { role: m.role, parts: [{ text: m.text }] };
}

/** Leading run of messages the client marked stable: the cacheable prefix after the system prompt. */
function stablePrefix(req: ProviderRequest): number {
  let n = 0;
  while (n < req.messages.length - 1 && req.messages[n]!.stable) n++;
  return n;
}

interface Prepared {
  contents: Content[];
  config: GenerateContentConfig;
  cacheNote?: string;
}

/**
 * Resolve an explicit context cache for the request (create on first use, reuse after) and return
 * the contents/config to send. Falls back silently to a plain call when the prefix is too short
 * for the model's minimum, the model is not cacheable, or the cache API fails.
 */
async function prepare(req: ProviderRequest, signal: AbortSignal): Promise<Prepared> {
  const cfg: GenerateContentConfig = { abortSignal: signal, httpOptions: { timeout: config.requestTimeoutMs } };
  if (req.maxOutputTokens !== undefined) cfg.maxOutputTokens = req.maxOutputTokens;
  if (req.temperature !== undefined) cfg.temperature = req.temperature;
  if (req.schema) {
    cfg.responseMimeType = 'application/json';
    cfg.responseJsonSchema = req.schema;
  }
  if (req.thinkingLevel) cfg.thinkingConfig = { thinkingLevel: req.thinkingLevel as ThinkingLevel };

  const plain = (): Prepared => {
    if (req.system) cfg.systemInstruction = req.system;
    return { contents: req.messages.map(toContent), config: cfg };
  };
  if (!req.cache) return plain();

  const info = modelInfo(req.model);
  const min = info?.minCacheTokens ?? 4096;
  if (!info || info.provider !== 'gemini' || min <= 0) return { ...plain(), cacheNote: 'explicit cache unsupported for model' };

  const n = stablePrefix(req);
  const prefixMessages = req.messages.slice(0, n);
  const hash = contentHash(req.model, { system: req.system ?? null, messages: prefixMessages.map((m) => ({ role: m.role, text: m.text })) });
  const key = req.cache.key;
  if (isTooShort(key, hash)) return { ...plain(), cacheNote: 'prefix below cache minimum (remembered)' };

  let rec = await lookup(key, req.model, hash);
  let note = rec ? 'explicit cache reused' : undefined;
  if (!rec) {
    // Cheap pre-check: countTokens is free, a failed create is a wasted round trip.
    try {
      const count = await ai().models.countTokens({
        model: req.model,
        contents: [...(req.system ? [{ role: 'user', parts: [{ text: req.system }] } as Content] : []), ...prefixMessages.map(toContent)],
        config: { abortSignal: signal },
      });
      if ((count.totalTokens ?? 0) < min) {
        markTooShort(key, hash);
        return { ...plain(), cacheNote: `prefix ${count.totalTokens ?? 0} tokens < minimum ${min}; no explicit cache` };
      }
    } catch (err) {
      log('WARNING', 'countTokens failed before cache create', { model: req.model, ...errorFields(err) });
    }
    try {
      const created = await ai().caches.create({
        model: req.model,
        config: {
          displayName: key,
          ttl: `${req.cache.ttlSeconds}s`,
          ...(req.system ? { systemInstruction: req.system } : {}),
          ...(prefixMessages.length ? { contents: prefixMessages.map(toContent) } : {}),
          abortSignal: signal,
        },
      });
      if (!created.name) throw new Error('cache create returned no name');
      rec = {
        name: created.name,
        model: req.model,
        contentHash: hash,
        expiresAt: created.expireTime ? Date.parse(created.expireTime) : Date.now() + req.cache.ttlSeconds * 1000,
        tokens: created.usageMetadata?.totalTokenCount ?? 0,
      };
      await remember(key, rec);
      note = `explicit cache created (${rec.tokens} tokens)`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/minimum token count/i.test(msg)) {
        markTooShort(key, hash);
        return { ...plain(), cacheNote: 'prefix below cache minimum; no explicit cache' };
      }
      log('WARNING', 'explicit cache create failed; continuing uncached', { model: req.model, key, ...errorFields(err) });
      return { ...plain(), cacheNote: 'explicit cache create failed' };
    }
  }
  // With a cache, the system instruction and the stable prefix live in the cache; send only the rest.
  cfg.cachedContent = rec.name;
  return { contents: req.messages.slice(n).map(toContent), config: cfg, cacheNote: note };
}

function isStaleCacheError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /cachedContent|cached content/i.test(msg) && /not found|expired|NOT_FOUND|INVALID_ARGUMENT|permission/i.test(msg);
}

export const geminiProvider: Provider = {
  name: 'gemini',

  async generate(req, signal): Promise<ProviderResult> {
    let p = await prepare(req, signal);
    let res: GenerateContentResponse;
    try {
      res = await ai().models.generateContent({ model: req.model, contents: p.contents, config: p.config });
    } catch (err) {
      if (req.cache && p.config.cachedContent && isStaleCacheError(err)) {
        // The registry pointed at a cache Vertex no longer has; drop it and retry once uncached.
        forget(req.cache.key);
        log('WARNING', 'explicit cache stale; retrying uncached', { key: req.cache.key, ...errorFields(err) });
        p = await prepare({ ...req, cache: undefined }, signal);
        res = await ai().models.generateContent({ model: req.model, contents: p.contents, config: p.config });
      } else {
        throw err;
      }
    }
    return {
      text: res.text ?? '',
      usage: usageOf(res),
      model: res.modelVersion ?? req.model,
      finishReason: res.candidates?.[0]?.finishReason,
      cacheNote: p.cacheNote,
    };
  },

  async *stream(req, signal): AsyncGenerator<StreamEvent> {
    const p = await prepare(req, signal);
    const stream = await ai().models.generateContentStream({ model: req.model, contents: p.contents, config: p.config });
    let usage: Usage = usageOf(undefined);
    let finishReason: string | undefined;
    for await (const chunk of stream) {
      if (chunk.usageMetadata) usage = usageOf(chunk);
      finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
      const text = chunk.text;
      if (text) yield { text };
    }
    yield { done: true, usage, finishReason, cacheNote: p.cacheNote };
  },
};
