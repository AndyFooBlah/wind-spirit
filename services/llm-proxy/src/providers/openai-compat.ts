import { GoogleAuth } from 'google-auth-library';
import { config } from '../config.js';
import { modelInfo, type Usage } from '../models.js';
import { jsonInstruction, type Provider, type ProviderRequest, type ProviderResult, type StreamEvent } from './types.js';

/**
 * Open models served as managed APIs (MaaS) through Vertex AI's OpenAI-compatible chat completions
 * endpoint. Bearer is an ADC access token for the runtime service account.
 *
 *   POST https://{host}/v1/projects/{p}/locations/{loc}/endpoints/openapi/chat/completions
 *   { model: "<publisher>/<model>", messages: [...], response_format?, stream?, stream_options? }
 *
 * Usage comes back OpenAI-style: prompt_tokens (including cached), completion_tokens (including any
 * reasoning), prompt_tokens_details.cached_tokens when the backend reports cache hits.
 */
let auth: GoogleAuth | undefined;

async function accessToken(): Promise<string> {
  auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const token = await auth.getAccessToken();
  if (!token) throw new Error('could not obtain an access token from ADC');
  return token;
}

export function endpointFor(model: string): string {
  const loc = modelInfo(model)?.location ?? config.maasLocation;
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${config.project}/locations/${loc}/endpoints/openapi/chat/completions`;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
}

interface ChatCompletion {
  model?: string;
  choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }>;
  usage?: ChatUsage;
}

interface ChatChunk {
  model?: string;
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: ChatUsage | null;
}

export function usageOf(u: ChatUsage | null | undefined): Usage {
  const thoughts = u?.completion_tokens_details?.reasoning_tokens ?? 0;
  return {
    input: u?.prompt_tokens ?? 0,
    output: u?.completion_tokens ?? 0,
    thoughts,
    cached: u?.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWrite: 0,
  };
}

/** Build the chat completions body. Exported for tests. */
export function toBody(req: ProviderRequest, stream: boolean): Record<string, unknown> {
  const native = modelInfo(req.model)?.nativeJsonSchema ?? false;
  const messages: ChatMessage[] = [];
  const systemText = [req.system, req.schema && !native ? jsonInstruction(req.schema) : undefined].filter(Boolean).join('\n\n');
  if (systemText) messages.push({ role: 'system', content: systemText });
  for (const m of req.messages) messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text });
  const body: Record<string, unknown> = { model: req.model, messages };
  if (req.maxOutputTokens !== undefined) body.max_tokens = req.maxOutputTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.schema && native) {
    body.response_format = { type: 'json_schema', json_schema: { name: 'response', schema: req.schema, strict: true } };
  }
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  return body;
}

class UpstreamError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

async function post(req: ProviderRequest, body: unknown, signal: AbortSignal): Promise<Response> {
  const res = await fetch(endpointFor(req.model), {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 4000);
    // Vertex wraps errors in a one-element array; server.ts digs the message out of the JSON.
    throw new UpstreamError(res.status, text.startsWith('[') ? text.slice(1, -1).trim() : text);
  }
  return res;
}

/** Strip a DeepSeek-R1-style <think>...</think> preamble so JSON extraction sees the answer. */
export function stripThink(text: string): string {
  return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '');
}

/** Parse an SSE byte stream into JSON chunks. Exported for tests. */
export async function* sseJson(stream: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          yield JSON.parse(data);
        } catch {
          /* ignore malformed keep-alives */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const openAiCompatProvider: Provider = {
  name: 'openai-compat',

  async generate(req, signal): Promise<ProviderResult> {
    const res = await post(req, toBody(req, false), signal);
    const data = (await res.json()) as ChatCompletion;
    const choice = data.choices?.[0];
    return {
      text: stripThink(choice?.message?.content ?? ''),
      usage: usageOf(data.usage),
      model: data.model || req.model,
      finishReason: choice?.finish_reason ?? undefined,
    };
  },

  async *stream(req, signal): AsyncGenerator<StreamEvent> {
    const res = await post(req, toBody(req, true), signal);
    if (!res.body) throw new UpstreamError(502, 'empty stream body');
    let usage: Usage = usageOf(undefined);
    let finishReason: string | undefined;
    let model = req.model;
    for await (const raw of sseJson(res.body)) {
      const chunk = raw as ChatChunk;
      if (chunk.model) model = chunk.model;
      if (chunk.usage?.prompt_tokens !== undefined) usage = usageOf(chunk.usage);
      const c = chunk.choices?.[0];
      if (c?.finish_reason) finishReason = c.finish_reason;
      const text = c?.delta?.content;
      if (text) yield { text };
    }
    void model;
    yield { done: true, usage, finishReason };
  },
};
