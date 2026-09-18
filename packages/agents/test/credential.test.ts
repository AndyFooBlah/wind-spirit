import { describe, expect, it } from 'vitest';
import { HttpLlmClient, proxyHeaders } from '../src/client.js';
import { ProxySystemOne } from '../src/judge/transport.js';

describe('proxyHeaders', () => {
  it('a bare string is an ID token (historical shape)', () => {
    expect(proxyHeaders('abc')).toEqual({ 'content-type': 'application/json', authorization: 'Bearer abc' });
  });
  it('an object carries the App Check token too, each header only when present', () => {
    expect(proxyHeaders({ idToken: 'abc', appCheckToken: 'ac' })).toEqual({ 'content-type': 'application/json', authorization: 'Bearer abc', 'x-firebase-appcheck': 'ac' });
    expect(proxyHeaders({ idToken: 'abc' })).toEqual({ 'content-type': 'application/json', authorization: 'Bearer abc' });
    expect(proxyHeaders({ appCheckToken: 'ac' })).toEqual({ 'content-type': 'application/json', 'x-firebase-appcheck': 'ac' });
    expect(proxyHeaders(undefined)).toEqual({ 'content-type': 'application/json' });
  });
});

describe('clients send the App Check header', () => {
  const capture = () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify({ text: '{}', usage: { input: 1, output: 1 }, model: 'm', ms: 1, answers: {} }), { status: 200 });
    }) as typeof fetch;
    return { seen, fetchImpl };
  };
  it('HttpLlmClient', async () => {
    const { seen, fetchImpl } = capture();
    await new HttpLlmClient('http://p', async () => ({ idToken: 't', appCheckToken: 'a' }), fetchImpl).generate({ class: 'cheap', messages: [{ role: 'user', text: 'x' }] });
    expect(seen[0]!.headers).toMatchObject({ authorization: 'Bearer t', 'x-firebase-appcheck': 'a' });
  });
  it('ProxySystemOne', async () => {
    const { seen, fetchImpl } = capture();
    await new ProxySystemOne('http://p', async () => ({ idToken: 't', appCheckToken: 'a' }), fetchImpl).systemOne({ state: {}, questions: { q: {} } });
    expect(seen[0]!.url).toBe('http://p/v1/systemone');
    expect(seen[0]!.headers).toMatchObject({ authorization: 'Bearer t', 'x-firebase-appcheck': 'a' });
  });
});
