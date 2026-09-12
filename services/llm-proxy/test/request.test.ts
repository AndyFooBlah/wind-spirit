import { describe, expect, it } from 'vitest';
import { parseGenerateRequest, promptHash, resolveModel } from '../src/request.js';
import { nextUtcMidnight, quotaDocId, utcDay } from '../src/quota.js';
import { HttpError } from '../src/errors.js';
import { config } from '../src/config.js';

describe('parseGenerateRequest', () => {
  it('accepts a minimal valid body', () => {
    const r = parseGenerateRequest({ class: 'routine', messages: [{ role: 'user', text: 'hi' }] });
    expect(r).toEqual({ class: 'routine', messages: [{ role: 'user', text: 'hi' }] });
  });
  it('carries optional fields through', () => {
    const r = parseGenerateRequest({
      class: 'capable', system: 's', messages: [{ role: 'model', text: 'a', stable: true }, { role: 'user', text: 'b' }],
      schema: { type: 'object' }, maxOutputTokens: 10, temperature: 0.5, cacheKey: 'k', thinkingLevel: 'low',
      cache: { key: 'village:1', ttlSeconds: 600 },
    });
    expect(r.system).toBe('s');
    expect(r.schema).toEqual({ type: 'object' });
    expect(r.maxOutputTokens).toBe(10);
    expect(r.temperature).toBe(0.5);
    expect(r.cacheKey).toBe('k');
    expect(r.thinkingLevel).toBe('low');
    expect(r.cache).toEqual({ key: 'village:1', ttlSeconds: 600 });
    expect(r.messages[0]).toEqual({ role: 'model', text: 'a', stable: true });
  });
  it('accepts the four classes', () => {
    for (const c of ['cheap', 'routine', 'capable', 'premium']) {
      expect(parseGenerateRequest({ class: c, messages: [{ role: 'user', text: 'x' }] }).class).toBe(c);
    }
  });
  it('accepts an allowlisted model without a class and resolves to it', () => {
    const id = config.evalModels[0]!;
    const r = parseGenerateRequest({ model: id, messages: [{ role: 'user', text: 'x' }] });
    expect(r.model).toBe(id);
    expect(resolveModel(r)).toBe(id);
  });
  it('resolves a class through the env mapping', () => {
    const r = parseGenerateRequest({ class: 'cheap', messages: [{ role: 'user', text: 'x' }] });
    expect(resolveModel(r)).toBe(config.models.cheap);
  });
  it('rejects a model outside the allowlist', () => {
    expect(() => parseGenerateRequest({ model: 'gemini-9-ultra', messages: [{ role: 'user', text: 'x' }] })).toThrowError(/EVAL_MODELS/);
  });
  it('defaults cache.ttlSeconds to 3600', () => {
    const r = parseGenerateRequest({ class: 'routine', messages: [{ role: 'user', text: 'x' }], cache: { key: 'k' } });
    expect(r.cache).toEqual({ key: 'k', ttlSeconds: 3600 });
  });
  it.each([
    [{}],
    [{ messages: [{ role: 'user', text: 'x' }] }],
    [{ class: 'fast', messages: [{ role: 'user', text: 'x' }] }],
    [{ class: 'routine', messages: [] }],
    [{ class: 'routine', messages: [{ role: 'system', text: 'x' }] }],
    [{ class: 'routine', messages: [{ role: 'model', text: 'x' }] }],
    [{ class: 'routine', messages: [{ role: 'user', text: 'x', stable: 'yes' }] }],
    [{ class: 'routine', messages: [{ role: 'user', text: 'x' }], schema: 'nope' }],
    [{ class: 'routine', messages: [{ role: 'user', text: 'x' }], maxOutputTokens: 0 }],
    [{ class: 'routine', messages: [{ role: 'user', text: 'x' }], temperature: 3 }],
    [{ class: 'routine', messages: [{ role: 'user', text: 'x' }], cache: { key: 'bad key!' } }],
    [{ class: 'routine', messages: [{ role: 'user', text: 'x' }], cache: { key: 'k', ttlSeconds: 5 } }],
    [{ class: 'routine', messages: [{ role: 'user', text: 'x' }], model: 42 }],
    ['string'],
  ])('rejects %j with 400', (body) => {
    expect(() => parseGenerateRequest(body)).toThrowError(HttpError);
    try { parseGenerateRequest(body); } catch (e) { expect((e as HttpError).status).toBe(400); }
  });
  it('hashes the prompt deterministically and ignores non-prompt fields', () => {
    const a = parseGenerateRequest({ class: 'routine', system: 's', messages: [{ role: 'user', text: 'x' }], temperature: 0.1 });
    const b = parseGenerateRequest({ class: 'capable', system: 's', messages: [{ role: 'user', text: 'x', stable: true }], temperature: 0.9 });
    expect(promptHash(a)).toBe(promptHash(b));
    expect(promptHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('quota keys', () => {
  it('uses the UTC day and resets at the next UTC midnight', () => {
    const now = new Date('2026-09-12T23:59:30Z');
    expect(utcDay(now)).toBe('2026-09-12');
    expect(nextUtcMidnight(now).toISOString()).toBe('2026-09-13T00:00:00.000Z');
  });
  it('builds a slash-free doc id', () => {
    expect(quotaDocId({ kind: 'user', id: 'abc' }, '2026-09-12')).toBe('2026-09-12_user_abc');
    expect(quotaDocId({ kind: 'ip', id: '::ffff:1.2.3.4/x' }, '2026-09-12')).toBe('2026-09-12_ip_::ffff:1.2.3.4_x');
  });
});
