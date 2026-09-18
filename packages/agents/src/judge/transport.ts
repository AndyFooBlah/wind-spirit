/**
 * How a Jev judgment reaches TypeSafe. The questions and their composition live in jev.ts and are the same
 * either way; only the credential path differs. The browser gets `ProxySystemOne`, which carries no key and
 * lets services/llm-proxy add one; evals and server code can use the SDK directly.
 */
import type { JsonObject } from './state.js';

export interface SystemOneRequest { state: JsonObject; questions: Record<string, unknown>; model?: string }
export interface SystemOneResult {
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
  /** USD, when the transport knows it. */
  cost?: number;
}
export interface SystemOneTransport { systemOne(req: SystemOneRequest): Promise<SystemOneResult> }

/** Talks to services/llm-proxy, which holds the API key. Safe in the browser. */
export class ProxySystemOne implements SystemOneTransport {
  constructor(private baseUrl: string, private token: () => Promise<string | undefined> = async () => undefined, private fetchImpl: typeof fetch = (i, o) => fetch(i, o)) {}
  async systemOne(req: SystemOneRequest): Promise<SystemOneResult> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const t = await this.token(); if (t) headers.authorization = `Bearer ${t}`;
    const res = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, { method: 'POST', headers, body: JSON.stringify(req) });
    if (!res.ok) throw new Error(`proxy ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as SystemOneResult;
  }
}
