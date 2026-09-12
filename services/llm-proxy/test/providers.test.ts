import { describe, expect, it } from 'vitest';
import { addUsage, estimateCost, MODELS, ZERO_USAGE } from '../src/models.js';
import { config } from '../src/config.js';
import { providerFor } from '../src/providers/index.js';
import { extractJson, jsonInstruction } from '../src/providers/types.js';
import { validateAgainst } from '../src/schema.js';
import { toParams, usageOf as anthropicUsage } from '../src/providers/anthropic.js';
import { endpointFor, sseJson, stripThink, toBody, usageOf as oaiUsage } from '../src/providers/openai-compat.js';
import { usageOf as geminiUsage } from '../src/providers/gemini.js';

describe('model catalog and cost', () => {
  it('every class default and every eval model is priced', () => {
    for (const id of Object.values(config.models)) expect(MODELS[id], id).toBeDefined();
    for (const id of config.evalModels) expect(MODELS[id], id).toBeDefined();
  });
  it('prices are positive and cache reads never cost more than input', () => {
    for (const m of Object.values(MODELS)) {
      expect(m.pricing.input).toBeGreaterThan(0);
      expect(m.pricing.output).toBeGreaterThan(0);
      expect(m.pricing.cacheRead).toBeLessThanOrEqual(m.pricing.input);
    }
  });
  it('charges cached tokens at the cache-read price and the rest at input', () => {
    // gemini-3.8-flash: $1.50 in, $7.50 out, $0.15 cached
    const cost = estimateCost('gemini-3.8-flash', { input: 10_000, output: 1_000, thoughts: 200, cached: 6_000, cacheWrite: 0 });
    expect(cost).toBeCloseTo((4_000 * 1.5 + 6_000 * 0.15 + 1_000 * 7.5) / 1e6, 10);
  });
  it('charges Anthropic cache writes at the cache-write price', () => {
    // claude-haiku-4-5: $1 in, $5 out, $0.10 read, $1.25 write; input includes cached + written
    const cost = estimateCost('claude-haiku-4-5', { input: 5_100, output: 100, thoughts: 0, cached: 0, cacheWrite: 5_000 });
    expect(cost).toBeCloseTo((100 * 1 + 5_000 * 1.25 + 100 * 5) / 1e6, 10);
  });
  it('costs 0 for an unknown model', () => {
    expect(estimateCost('nope', { ...ZERO_USAGE, input: 1e6 })).toBe(0);
  });
  it('adds usage field-wise', () => {
    expect(addUsage({ input: 1, output: 2, thoughts: 3, cached: 4, cacheWrite: 5 }, { input: 10, output: 20, thoughts: 30, cached: 40, cacheWrite: 50 }))
      .toEqual({ input: 11, output: 22, thoughts: 33, cached: 44, cacheWrite: 55 });
  });
});

describe('provider selection', () => {
  it('routes by catalog provider and defaults unknown ids to gemini', () => {
    expect(providerFor('gemini-3.8-flash').name).toBe('gemini');
    expect(providerFor('claude-haiku-4-5').name).toBe('anthropic');
    expect(providerFor('openai/gpt-oss-120b-maas').name).toBe('openai-compat');
    expect(providerFor('gemini-99-flash').name).toBe('gemini');
  });
});

describe('usage normalisation', () => {
  it('gemini: output includes thoughts, cached from cachedContentTokenCount', () => {
    const u = geminiUsage({ usageMetadata: { promptTokenCount: 7545, candidatesTokenCount: 2, thoughtsTokenCount: 26, cachedContentTokenCount: 4075 } } as never);
    expect(u).toEqual({ input: 7545, output: 28, thoughts: 26, cached: 4075, cacheWrite: 0 });
  });
  it('anthropic: input is the whole prompt including cache reads and writes', () => {
    const u = anthropicUsage({ input_tokens: 12, output_tokens: 40, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 } as never);
    expect(u).toEqual({ input: 5012, output: 40, thoughts: 0, cached: 5000, cacheWrite: 0 });
  });
  it('openai-compat: cached_tokens from prompt_tokens_details, missing details tolerated', () => {
    expect(oaiUsage({ prompt_tokens: 7557, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 7555 } }))
      .toEqual({ input: 7557, output: 3, thoughts: 0, cached: 7555, cacheWrite: 0 });
    expect(oaiUsage({ prompt_tokens: 96, completion_tokens: 299, prompt_tokens_details: null }).cached).toBe(0);
    expect(oaiUsage(undefined)).toEqual(ZERO_USAGE);
  });
});

describe('anthropic request shaping', () => {
  const schema = { type: 'object', properties: { decision: { type: 'string' } }, required: ['decision'] };
  it('puts cache_control on the system block and instructs JSON when a schema is given', () => {
    const p = toParams({ model: 'claude-haiku-4-5', system: 'You are chief.', schema, messages: [{ role: 'user', text: 'Decide.' }], cache: { key: 'k', ttlSeconds: 300 } });
    expect(Array.isArray(p.system)).toBe(true);
    const sys = p.system as Array<{ text: string; cache_control?: unknown }>;
    expect(sys[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(sys[0]!.text).toContain('You are chief.');
    expect(sys[0]!.text).toContain(JSON.stringify(schema));
    expect(p.messages).toEqual([{ role: 'user', content: 'Decide.' }]);
    expect(p.max_tokens).toBe(4096);
  });
  it('uses a plain system string without cache and maps model->assistant', () => {
    const p = toParams({ model: 'claude-sonnet-5', system: 's', messages: [{ role: 'model', text: 'a' }, { role: 'user', text: 'b' }], maxOutputTokens: 99 });
    expect(p.system).toBe('s');
    expect(p.messages[0]).toEqual({ role: 'assistant', content: 'a' });
    expect(p.max_tokens).toBe(99);
    expect(p.thinking).toBeUndefined();
  });
  it('puts a breakpoint on the last stable message', () => {
    const p = toParams({ model: 'claude-sonnet-5', messages: [{ role: 'user', text: 'lore', stable: true }, { role: 'model', text: 'ok', stable: true }, { role: 'user', text: 'now' }], cache: { key: 'k', ttlSeconds: 300 } });
    expect(p.messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'ok', cache_control: { type: 'ephemeral' } }] });
    expect(p.messages[2]).toEqual({ role: 'user', content: 'now' });
  });
});

describe('openai-compat request shaping', () => {
  const schema = { type: 'object', properties: { decision: { type: 'string' } }, required: ['decision'] };
  it('uses response_format json_schema for models with native support', () => {
    const b = toBody({ model: 'openai/gpt-oss-120b-maas', system: 's', schema, messages: [{ role: 'user', text: 'u' }], maxOutputTokens: 50, temperature: 0.2 }, false);
    expect(b.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'response', schema, strict: false } });
    expect(b.messages).toEqual([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }]);
    expect(b.max_tokens).toBe(50);
    expect(b.temperature).toBe(0.2);
    expect(b.stream).toBeUndefined();
  });
  it('falls back to instruction for models without native json_schema and requests usage when streaming', () => {
    const b = toBody({ model: 'deepseek-ai/deepseek-r1-0528-maas', schema, messages: [{ role: 'user', text: 'u' }] }, true);
    expect(b.response_format).toBeUndefined();
    expect((b.messages as Array<{ role: string; content: string }>)[0]).toEqual({ role: 'system', content: jsonInstruction(schema) });
    expect(b.stream).toBe(true);
    expect(b.stream_options).toEqual({ include_usage: true });
  });
  it('builds global and regional endpoints from the catalog location', () => {
    expect(endpointFor('openai/gpt-oss-120b-maas')).toBe(`https://aiplatform.googleapis.com/v1/projects/${config.project}/locations/global/endpoints/openapi/chat/completions`);
    expect(endpointFor('openai/gpt-oss-20b-maas')).toBe(`https://us-central1-aiplatform.googleapis.com/v1/projects/${config.project}/locations/us-central1/endpoints/openapi/chat/completions`);
  });
  it('strips a <think> preamble', () => {
    expect(stripThink('<think>\nhmm\n</think>\n{"a":1}')).toBe('{"a":1}');
    expect(stripThink('{"a":1}')).toBe('{"a":1}');
  });
  it('parses SSE data lines across chunk boundaries and ignores [DONE]', async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"He"}}]}\n\ndata: {"choi'));
        c.enqueue(enc.encode('ces":[{"delta":{"content":"llo"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\ndata: [DONE]\n\n'));
        c.close();
      },
    });
    const out: unknown[] = [];
    for await (const j of sseJson(stream)) out.push(j);
    expect(out).toHaveLength(3);
    expect((out[1] as { choices: Array<{ delta: { content: string } }> }).choices[0]!.delta.content).toBe('llo');
  });
});

describe('json extraction and validation', () => {
  const schema = { type: 'object', properties: { decision: { type: 'string', enum: ['hunt', 'rest'] } }, required: ['decision'], additionalProperties: false };
  it('extracts fenced, bare and prose-wrapped JSON', () => {
    expect(extractJson('{"decision":"hunt"}')).toEqual({ decision: 'hunt' });
    expect(extractJson('```json\n{"decision":"rest"}\n```')).toEqual({ decision: 'rest' });
    expect(extractJson('Sure: {"decision":"hunt"} done')).toEqual({ decision: 'hunt' });
    expect(extractJson('no json here')).toBeUndefined();
  });
  it('validates against the schema', () => {
    expect(validateAgainst(schema, { decision: 'hunt' })).toBeUndefined();
    expect(validateAgainst(schema, { decision: 'swim' })).toMatch(/enum|equal to one/);
    expect(validateAgainst(schema, { nope: 1 })).toBeTruthy();
  });
});
