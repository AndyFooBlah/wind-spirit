import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { estimateCost, MODELS } from '../src/models.js';
import { providerFor } from '../src/providers/index.js';
import { completionResult, completionStream, usageOf, reportedCost } from '../src/providers/chat-completions.js';
import { jsonInstruction } from '../src/providers/types.js';
import {
  DISABLED_NOTE,
  OPENROUTER_MODELS_URL,
  openrouterApiKey,
  openrouterCatalogIds,
  openrouterEnabled,
  openrouterPricingStatus,
  openrouterProvider,
  parseOpenRouterModels,
  pricingFromOpenRouter,
  refreshOpenRouterPricing,
  resetOpenRouterPricingStatus,
  toBody,
  useNativeJson,
} from '../src/providers/openrouter.js';

const schema = { type: 'object', properties: { decision: { type: 'string' } }, required: ['decision'] };
const OR_IDS = [
  'anthropic/claude-haiku-4.5', 'anthropic/claude-sonnet-5', 'openai/gpt-5-mini', 'openai/gpt-5-nano', 'openai/gpt-5.4-nano',
  'openai/gpt-5.6-luna', 'openai/gpt-5.6-luna-pro', 'meta-llama/llama-4-maverick', 'moonshotai/kimi-k2.5', 'moonshotai/kimi-k3', 'z-ai/glm-5.3-flash', 'z-ai/glm-4.7', 'minimax/minimax-m2.7',
  'deepseek/deepseek-v3.2', 'deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro', 'mistralai/mistral-medium-3.1', 'xiaomi/mimo-v2.5', 'qwen/qwen3.8-flash',
  'nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/nemotron-3-super-120b-a12b',
  'google/gemini-3.8-flash', 'google/gemini-3.5-flash-lite', 'google/gemini-2.5-flash-lite',
];

const savedKey = process.env.OPENROUTER_API_KEY;
afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;
});

describe('openrouter catalog', () => {
  it('lists every candidate with provider openrouter, in the default eval allowlist, priced', () => {
    for (const id of OR_IDS) {
      const m = MODELS[id];
      expect(m, id).toBeDefined();
      expect(m!.provider).toBe('openrouter');
      expect(m!.pricing.input).toBeGreaterThan(0);
      expect(m!.pricing.output).toBeGreaterThan(0);
      expect(config.evalModels, id).toContain(id);
      expect(providerFor(id).name).toBe('openrouter');
    }
    expect(openrouterCatalogIds().sort()).toEqual([...OR_IDS].sort());
  });
  it('keeps the google/ ids distinct from the Vertex gemini-* ids', () => {
    expect(providerFor('gemini-3.8-flash').name).toBe('gemini');
    expect(providerFor('google/gemini-3.8-flash').name).toBe('openrouter');
    // Vertex list price is 1.50/M in; OpenRouter lists a different number, so the two rows must not be conflated.
    expect(MODELS['google/gemini-3.8-flash']!.pricing.input).not.toBe(MODELS['gemini-3.8-flash']!.pricing.input);
  });
});

describe('openrouter enable/disable', () => {
  it('is disabled when the key is missing, blank or the literal placeholder', () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(openrouterEnabled()).toBe(false);
    process.env.OPENROUTER_API_KEY = '';
    expect(openrouterEnabled()).toBe(false);
    process.env.OPENROUTER_API_KEY = 'unset';
    expect(openrouterEnabled()).toBe(false);
    expect(openrouterApiKey()).toBeUndefined();
    expect(openrouterProvider.available!()).toBe(false);
  });
  it('is enabled with a real key and exposes it only through openrouterApiKey()', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    expect(openrouterEnabled()).toBe(true);
    expect(openrouterProvider.available!()).toBe(true);
    expect(openrouterApiKey()).toBe('sk-or-v1-test');
    expect(JSON.stringify(config)).not.toContain('sk-or-v1-test');
  });
  it('refuses to call upstream when disabled, without touching the network', async () => {
    process.env.OPENROUTER_API_KEY = 'unset';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(openrouterProvider.generate({ model: 'openai/gpt-5-nano', messages: [{ role: 'user', text: 'x' }] }, new AbortController().signal))
      .rejects.toThrow(DISABLED_NOTE);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('openrouter request shaping', () => {
  it('instructs + validates JSON by default (no response_format), maps roles, and sends no usage/stream_options flags', () => {
    const b = toBody({ model: 'openai/gpt-5-nano', system: 's', schema, messages: [{ role: 'model', text: 'a' }, { role: 'user', text: 'u' }], maxOutputTokens: 50, temperature: 0.2 }, false);
    expect(b.model).toBe('openai/gpt-5-nano');
    expect(b.response_format).toBeUndefined();
    const msgs = b.messages as Array<{ role: string; content: string }>;
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toContain('s');
    expect(msgs[0]!.content).toContain(jsonInstruction(schema));
    expect(msgs[1]).toEqual({ role: 'assistant', content: 'a' });
    expect(msgs[2]).toEqual({ role: 'user', content: 'u' });
    expect(b.max_tokens).toBe(50);
    expect(b.temperature).toBe(0.2);
    expect(b.stream).toBeUndefined();
    expect(b.stream_options).toBeUndefined();
    expect(b.usage).toBeUndefined();
  });
  it('streams without stream_options (OpenRouter always puts usage on the last chunk)', () => {
    const b = toBody({ model: 'openai/gpt-5-nano', messages: [{ role: 'user', text: 'u' }] }, true);
    expect(b.stream).toBe(true);
    expect(b.stream_options).toBeUndefined();
  });
  it('maps thinkingLevel onto reasoning.effort and drops unknown values', () => {
    expect(toBody({ model: 'openai/gpt-5-nano', messages: [{ role: 'user', text: 'u' }], thinkingLevel: 'low' }, false).reasoning).toEqual({ effort: 'low' });
    expect(toBody({ model: 'openai/gpt-5-nano', messages: [{ role: 'user', text: 'u' }], thinkingLevel: 'turbo' }, false).reasoning).toBeUndefined();
  });
  it('uses native json_schema only when the model supports structured_outputs AND OPENROUTER_NATIVE_JSON=true', () => {
    const info = MODELS['openai/gpt-5-nano']!;
    const cfg = config.openrouter as { nativeJson: boolean };
    const saved = cfg.nativeJson;
    try {
      cfg.nativeJson = false;
      expect(useNativeJson('openai/gpt-5-nano', { ...info, supportedParameters: ['structured_outputs'] })).toBe(false);
      cfg.nativeJson = true;
      expect(useNativeJson('openai/gpt-5-nano', { ...info, supportedParameters: ['structured_outputs'] })).toBe(true);
      expect(useNativeJson('openai/gpt-5-nano', { ...info, supportedParameters: ['tools'] })).toBe(false);
      expect(useNativeJson('openai/gpt-5-nano', { ...info, supportedParameters: undefined })).toBe(false);
      const b = toBody({ model: 'openai/gpt-5-nano', schema, messages: [{ role: 'user', text: 'u' }] }, false);
      expect(b.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'response', schema, strict: false } });
      expect(b.messages).toEqual([{ role: 'user', content: 'u' }]);
    } finally {
      cfg.nativeJson = saved;
    }
  });
});

describe('openrouter usage mapping', () => {
  it('maps prompt/completion/cached/cache_write/reasoning tokens', () => {
    const u = usageOf({
      prompt_tokens: 194, completion_tokens: 12,
      prompt_tokens_details: { cached_tokens: 50, cache_write_tokens: 100 },
      completion_tokens_details: { reasoning_tokens: 7 },
      cost: 0.00042,
    });
    expect(u).toEqual({ input: 194, output: 12, thoughts: 7, cached: 50, cacheWrite: 100 });
  });
  it('accepts a top-level cache_write_tokens and null details', () => {
    expect(usageOf({ prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: null, cache_write_tokens: 4 }).cacheWrite).toBe(4);
  });
  it('reportedCost is the credits figure when present and undefined otherwise', () => {
    expect(reportedCost({ cost: 0.0012 })).toBe(0.0012);
    expect(reportedCost({ cost: 0 })).toBe(0);
    expect(reportedCost({ cost: null })).toBeUndefined();
    expect(reportedCost({})).toBeUndefined();
    expect(reportedCost({ cost: -1 })).toBeUndefined();
  });

  const req = { model: 'openai/gpt-5-nano', messages: [{ role: 'user' as const, text: 'u' }] };
  const completion = (usage: Record<string, unknown>) =>
    new Response(JSON.stringify({ model: 'openai/gpt-5-nano', choices: [{ message: { content: '{"decision":"hunt"}' }, finish_reason: 'stop' }], usage }));

  it('generate: uses usage.cost as the cost with costSource openrouter', async () => {
    const r = await completionResult(completion({ prompt_tokens: 100, completion_tokens: 10, cost: 0.00123 }), req, { costSource: 'openrouter' });
    expect(r.text).toBe('{"decision":"hunt"}');
    expect(r.finishReason).toBe('stop');
    expect(r.usage).toEqual({ input: 100, output: 10, thoughts: 0, cached: 0, cacheWrite: 0 });
    expect(r.cost).toBe(0.00123);
    expect(r.costSource).toBe('openrouter');
  });
  it('generate: without usage.cost leaves cost undefined so the server prices from the table', async () => {
    const r = await completionResult(completion({ prompt_tokens: 1_000_000, completion_tokens: 0 }), req, { costSource: 'openrouter' });
    expect(r.cost).toBeUndefined();
    expect(r.costSource).toBeUndefined();
    expect(estimateCost(req.model, r.usage)).toBeCloseTo(MODELS['openai/gpt-5-nano']!.pricing.input, 10);
  });
  it('generate: the Vertex adapter never reports a cost even if the body has one', async () => {
    const r = await completionResult(completion({ prompt_tokens: 1, completion_tokens: 1, cost: 5 }), req);
    expect(r.cost).toBeUndefined();
  });
  it('generate: surfaces an error carried in a 200 body', async () => {
    const res = new Response(JSON.stringify({ error: { code: 402, message: 'Insufficient credits' } }));
    await expect(completionResult(res, req, { costSource: 'openrouter' })).rejects.toThrow('Insufficient credits');
  });
  it('stream: text chunks, then usage + cost from the final chunk; comment lines ignored', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(': OPENROUTER PROCESSING\n\ndata: {"choices":[{"delta":{"content":"He"}}]}\n\n'));
        c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"llo"},"finish_reason":"stop"}]}\n\n'));
        c.enqueue(enc.encode('data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":3},"cost":0.000009}}\n\ndata: [DONE]\n\n'));
        c.close();
      },
    });
    const events = [];
    for await (const ev of completionStream(new Response(body), req, { costSource: 'openrouter' })) events.push(ev);
    expect(events.slice(0, 2)).toEqual([{ text: 'He' }, { text: 'llo' }]);
    expect(events[2]).toEqual({ done: true, usage: { input: 5, output: 2, thoughts: 0, cached: 3, cacheWrite: 0 }, finishReason: 'stop', cost: 0.000009, costSource: 'openrouter' });
  });
  it('stream: without cost the final event has no cost fields', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"x"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n'));
        c.close();
      },
    });
    const events = [];
    for await (const ev of completionStream(new Response(body), req, { costSource: 'openrouter' })) events.push(ev);
    expect(events[1]).toEqual({ done: true, usage: { input: 1, output: 1, thoughts: 0, cached: 0, cacheWrite: 0 }, finishReason: undefined });
  });
});

describe('openrouter pricing refresh', () => {
  const listing = {
    data: [
      { id: 'openai/gpt-5-nano', pricing: { prompt: '0.00000005', completion: '0.0000004', input_cache_read: '0.000000005', input_cache_write: null }, supported_parameters: ['structured_outputs', 'tools'] },
      { id: 'anthropic/claude-haiku-4.5', pricing: { prompt: '0.000001', completion: '0.000005', input_cache_read: '0.0000001', input_cache_write: '0.00000125' }, supported_parameters: ['tools'] },
      { id: 'google/gemini-3.8-flash', pricing: { prompt: '0.00000075', completion: '0.00000375', input_cache_read: '0.000000075', input_cache_write: '0.0000000416666666666667' }, supported_parameters: ['structured_outputs'] },
      { id: 'meta-llama/llama-4-maverick', pricing: { prompt: '0.0000002', completion: '0.000000696' } },
      { id: 'someone/unrelated-model', pricing: { prompt: '1', completion: '1' } },
      { id: 'broken/no-price', pricing: {} },
    ],
  };
  it('converts per-token strings to USD per 1M and derives cache prices', () => {
    expect(pricingFromOpenRouter({ prompt: '0.00000005', completion: '0.0000004', input_cache_read: '0.000000005', input_cache_write: null }))
      .toEqual({ input: 0.05, output: 0.4, cacheRead: 0.005, cacheWrite: 0.05 });
    // full-price cache write (Anthropic)
    expect(pricingFromOpenRouter({ prompt: '0.000001', completion: '0.000005', input_cache_read: '0.0000001', input_cache_write: '0.00000125' }).cacheWrite).toBe(1.25);
    // storage add-on cache write (Gemini): input + add-on
    expect(pricingFromOpenRouter({ prompt: '0.00000075', completion: '0.00000375', input_cache_write: '0.0000000416666666666667' })!.cacheWrite).toBeCloseTo(0.791667, 5);
    // no cache prices: cache read = input
    expect(pricingFromOpenRouter({ prompt: '0.0000002', completion: '0.000000696' })).toEqual({ input: 0.2, output: 0.696, cacheRead: 0.2, cacheWrite: 0.2 });
    expect(pricingFromOpenRouter({})).toBeUndefined();
    expect(pricingFromOpenRouter(undefined)).toBeUndefined();
  });
  it('parses only the requested ids and skips unpriced rows', () => {
    const live = parseOpenRouterModels(listing, ['openai/gpt-5-nano', 'anthropic/claude-haiku-4.5', 'broken/no-price', 'missing/one']);
    expect([...live.keys()].sort()).toEqual(['anthropic/claude-haiku-4.5', 'openai/gpt-5-nano']);
    expect(live.get('openai/gpt-5-nano')).toEqual({ pricing: { input: 0.05, output: 0.4, cacheRead: 0.005, cacheWrite: 0.05 }, supportedParameters: ['structured_outputs', 'tools'] });
    expect(parseOpenRouterModels({ nope: 1 }, ['openai/gpt-5-nano']).size).toBe(0);
    expect(parseOpenRouterModels(null, ['openai/gpt-5-nano']).size).toBe(0);
  });

  const snapshot = new Map(openrouterCatalogIds().map((id) => [id, { pricing: { ...MODELS[id]!.pricing }, sp: MODELS[id]!.supportedParameters }]));
  beforeEach(() => resetOpenRouterPricingStatus());
  afterEach(() => {
    for (const [id, s] of snapshot) {
      MODELS[id]!.pricing = { ...s.pricing };
      MODELS[id]!.supportedParameters = s.sp;
    }
  });

  it('refresh overwrites the catalog in place, reports missing ids, and estimateCost sees the new prices', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(OPENROUTER_MODELS_URL);
      return new Response(JSON.stringify({ data: [{ id: 'openai/gpt-5-nano', pricing: { prompt: '0.000002', completion: '0.000003' }, supported_parameters: ['tools'] }] }));
    });
    const st = await refreshOpenRouterPricing(fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(st.source).toBe('openrouter-live');
    expect(st.updated).toBe(1);
    expect(st.missing).toHaveLength(openrouterCatalogIds().length - 1);
    expect(MODELS['openai/gpt-5-nano']!.pricing).toEqual({ input: 2, output: 3, cacheRead: 2, cacheWrite: 2 });
    expect(MODELS['openai/gpt-5-nano']!.supportedParameters).toEqual(['tools']);
    expect(estimateCost('openai/gpt-5-nano', { input: 1_000_000, output: 1_000_000, thoughts: 0, cached: 0, cacheWrite: 0 })).toBe(5);
    expect(openrouterPricingStatus().source).toBe('openrouter-live');
  });
  it('refresh keeps the static prices when the listing fails', async () => {
    const before = { ...MODELS['openai/gpt-5-nano']!.pricing };
    const st = await refreshOpenRouterPricing((async () => new Response('nope', { status: 503 })) as unknown as typeof fetch);
    expect(st.source).toBe('static');
    expect(st.error).toMatch(/503/);
    expect(MODELS['openai/gpt-5-nano']!.pricing).toEqual(before);
    const st2 = await refreshOpenRouterPricing((async () => { throw new Error('offline'); }) as unknown as typeof fetch);
    expect(st2.error).toBe('offline');
    expect(MODELS['openai/gpt-5-nano']!.pricing).toEqual(before);
  });
});
