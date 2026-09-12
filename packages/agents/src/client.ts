/** Model client contract. The proxy implements it over HTTP; tests use a mock. */
export type ModelClass = 'routine' | 'capable';
export interface GenerateRequest { class: ModelClass; system?: string; messages: { role: 'user' | 'model'; text: string }[]; schema?: object; maxOutputTokens?: number; temperature?: number; cacheKey?: string; thinkingLevel?: 'low' | 'medium' | 'high'; }
export interface GenerateResponse { text: string; json?: unknown; usage: { input: number; output: number }; model: string; ms: number; }
export interface LlmClient {
  generate(req: GenerateRequest): Promise<GenerateResponse>;
  stream?(req: GenerateRequest, onText: (t: string) => void): Promise<GenerateResponse>;
}

/** HTTP client for services/llm-proxy. `token` returns a Firebase ID token (or undefined when auth is off). */
export class HttpLlmClient implements LlmClient {
  constructor(private baseUrl: string, private token: () => Promise<string | undefined> = async () => undefined, private fetchImpl: typeof fetch = (i, o) => fetch(i, o)) {}
  private async headers(): Promise<Record<string, string>> { const h: Record<string, string> = { 'content-type': 'application/json' }; const t = await this.token(); if (t) h.authorization = `Bearer ${t}`; return h; }
  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/generate`, { method: 'POST', headers: await this.headers(), body: JSON.stringify(req) });
    if (!res.ok) throw new Error(`proxy ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as GenerateResponse;
  }
  async stream(req: GenerateRequest, onText: (t: string) => void): Promise<GenerateResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/stream`, { method: 'POST', headers: await this.headers(), body: JSON.stringify(req) });
    if (!res.ok || !res.body) throw new Error(`proxy ${res.status}`);
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let text = ''; let usage = { input: 0, output: 0 }; const t0 = Date.now();
    for (;;) {
      const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
      let nl; while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!line.startsWith('data:')) continue; try { const j = JSON.parse(line.slice(5)); if (j.text) { text += j.text; onText(j.text); } if (j.usage) usage = j.usage; } catch { /* partial */ } }
    }
    return { text, usage, model: 'stream', ms: Date.now() - t0 };
  }
}

/** Deterministic mock: answers from a function of the request. */
export class MockLlmClient implements LlmClient {
  calls = 0;
  constructor(private answer: (req: GenerateRequest) => unknown) {}
  async generate(req: GenerateRequest): Promise<GenerateResponse> { this.calls++; const json = this.answer(req); return { text: JSON.stringify(json), json, usage: { input: 1000, output: 200 }, model: 'mock', ms: 1 }; }
}
