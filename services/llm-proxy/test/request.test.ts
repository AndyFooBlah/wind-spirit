import { describe, expect, it } from 'vitest';
import { parseGenerateRequest, promptHash } from '../src/request.js';
import { nextUtcMidnight, quotaDocId, utcDay } from '../src/quota.js';
import { HttpError } from '../src/errors.js';

describe('parseGenerateRequest', () => {
  it('accepts a minimal valid body', () => {
    const r = parseGenerateRequest({ class: 'routine', messages: [{ role: 'user', text: 'hi' }] });
    expect(r).toEqual({ class: 'routine', messages: [{ role: 'user', text: 'hi' }] });
  });
  it('carries optional fields through', () => {
    const r = parseGenerateRequest({
      class: 'capable', system: 's', messages: [{ role: 'model', text: 'a' }, { role: 'user', text: 'b' }],
      schema: { type: 'object' }, maxOutputTokens: 10, temperature: 0.5, cacheKey: 'k', thinkingLevel: 'low',
    });
    expect(r.system).toBe('s');
    expect(r.schema).toEqual({ type: 'object' });
    expect(r.maxOutputTokens).toBe(10);
    expect(r.temperature).toBe(0.5);
    expect(r.cacheKey).toBe('k');
    expect(r.thinkingLevel).toBe('low');
  });
  it.each([
    [{}],
    [{ class: 'fast', messages: [{ role: 'user', text: 'x' }] }],
    [{ class: 'routine', messages: [] }],
    [{ class: 'routine', messages: [{ role: 'system', text: 'x' }] }],
    [{ class: 'routine', messages: [{ role: 'model', text: 'x' }] }],
    [{ class: 'routine', messages: [{ role: 'user', text: 'x' }], schema: 'nope' }],
    [{ class: 'routine', messages: [{ role: 'user', text: 'x' }], maxOutputTokens: 0 }],
    [{ class: 'routine', messages: [{ role: 'user', text: 'x' }], temperature: 3 }],
    ['string'],
  ])('rejects %j with 400', (body) => {
    expect(() => parseGenerateRequest(body)).toThrowError(HttpError);
    try { parseGenerateRequest(body); } catch (e) { expect((e as HttpError).status).toBe(400); }
  });
  it('hashes the prompt deterministically and ignores non-prompt fields', () => {
    const a = parseGenerateRequest({ class: 'routine', system: 's', messages: [{ role: 'user', text: 'x' }], temperature: 0.1 });
    const b = parseGenerateRequest({ class: 'capable', system: 's', messages: [{ role: 'user', text: 'x' }], temperature: 0.9 });
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
