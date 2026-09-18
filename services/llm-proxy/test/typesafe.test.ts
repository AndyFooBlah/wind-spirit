import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../src/errors.js';
import { parseSystemOneBody, systemOne, typesafeApiKey, typesafeEnabled, TYPESAFE_USD_PER_INPUT_TOKEN } from '../src/typesafe.js';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const answer = { model: 'jev-1.13.0', answers: { a: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 100, output_tokens: 5 } };

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('parseSystemOneBody', () => {
  it('accepts a state and at least one question', () => {
    const b = parseSystemOneBody({ state: { x: 1 }, questions: { a: { type: 'noul' } } });
    expect(b.questions.a).toEqual({ type: 'noul' });
    expect(b.model).toBeUndefined();
  });
  it('rejects a body with no questions, or empty questions', () => {
    expect(() => parseSystemOneBody({ state: 'x' })).toThrow(HttpError);
    expect(() => parseSystemOneBody({ state: 'x', questions: {} })).toThrow(/must not be empty/);
    expect(() => parseSystemOneBody({ state: 'x', questions: [] })).toThrow(/keyed by question name/);
  });
  it('rejects a missing state and a non-object body', () => {
    expect(() => parseSystemOneBody({ questions: { a: {} } })).toThrow(/state is required/);
    expect(() => parseSystemOneBody('nope')).toThrow(/JSON object/);
  });
  it('allows a null state, which the API accepts', () => {
    expect(parseSystemOneBody({ state: null, questions: { a: {} } }).state).toBeNull();
  });
});

describe('the key', () => {
  it('is absent when unset or the placeholder', () => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
    expect(typesafeApiKey()).toBeUndefined(); expect(typesafeEnabled()).toBe(false);
    vi.stubEnv('TYPESAFE_API_KEY', 'unset');
    expect(typesafeEnabled()).toBe(false);
    vi.stubEnv('TYPESAFE_API_KEY', 'ts-live');
    expect(typesafeEnabled()).toBe(true);
  });
  it('never travels to the client: an upstream 401 becomes a 502 without the key in it', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'ts-secret-value');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad key', { status: 401 })));
    const err = await systemOne({ state: 'x', questions: { a: {} } }, new AbortController().signal).catch(e => e as HttpError);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(502);
    expect((err as HttpError).message).not.toContain('ts-secret-value');
  });
});

describe('systemOne', () => {
  it('sends the key as a bearer token and defaults the model', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'ts-live');
    const f = vi.fn(async () => ok(answer));
    vi.stubGlobal('fetch', f);
    const r = await systemOne({ state: { a: 1 }, questions: { a: {} } }, new AbortController().signal);
    expect(r.usage.input_tokens).toBe(100);
    const [, init] = f.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ts-live');
    expect(JSON.parse(String(init.body)).model).toBe('jev-latest');
  });
  it('refuses when the key is missing rather than calling out', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'unset');
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    await expect(systemOne({ state: 'x', questions: { a: {} } }, new AbortController().signal)).rejects.toThrow(/not set/);
    expect(f).not.toHaveBeenCalled();
  });
  it('rejects an answer with no usage', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'ts-live');
    vi.stubGlobal('fetch', vi.fn(async () => ok({ model: 'jev', answers: {} })));
    await expect(systemOne({ state: 'x', questions: { a: {} } }, new AbortController().signal)).rejects.toThrow(/no answers or usage/);
  });
  it('prices input only', () => {
    expect(1_000_000 * TYPESAFE_USD_PER_INPUT_TOKEN).toBeCloseTo(0.042, 6);
  });
});
