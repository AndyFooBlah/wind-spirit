import type { Usage } from '../models.js';
import { jsonInstruction, type ProviderRequest, type ProviderResult, type StreamEvent } from './types.js';

/**
 * Shared OpenAI-style chat completions plumbing used by the Vertex MaaS adapter (`openai-compat.ts`)
 * and the OpenRouter adapter (`openrouter.ts`): request body shaping, usage normalisation, SSE
 * parsing and the generate/stream runners. Each adapter supplies only its endpoint, its headers
 * and its own decision about native JSON-schema output.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
  /** OpenRouter: total credits (USD) charged for the call. Never present on Vertex. */
  cost?: number | null;
  /** Some backends report cache writes at the top level rather than under prompt_tokens_details. */
  cache_write_tokens?: number | null;
}

export interface ChatError {
  code?: number | string;
  message?: string;
}

export interface ChatCompletion {
  model?: string;
  choices?: Array<{
    message?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string | null;
    error?: ChatError | null;
  }>;
  usage?: ChatUsage | null;
  error?: ChatError | null;
}

export interface ChatChunk {
  model?: string;
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null; error?: ChatError | null }>;
  usage?: ChatUsage | null;
  error?: ChatError | null;
}

export function usageOf(u: ChatUsage | null | undefined): Usage {
  const thoughts = u?.completion_tokens_details?.reasoning_tokens ?? 0;
  return {
    input: u?.prompt_tokens ?? 0,
    output: u?.completion_tokens ?? 0,
    thoughts,
    cached: u?.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWrite: u?.prompt_tokens_details?.cache_write_tokens ?? u?.cache_write_tokens ?? 0,
  };
}

/** The provider-reported cost, when the backend bills per call and says so (OpenRouter `usage.cost`). */
export function reportedCost(u: ChatUsage | null | undefined): number | undefined {
  const c = u?.cost;
  return typeof c === 'number' && Number.isFinite(c) && c >= 0 ? c : undefined;
}

export interface BodyOptions {
  /** Send `response_format: json_schema` instead of instructing + validating. */
  nativeJson: boolean;
  stream: boolean;
  /** Ask for usage in the final stream chunk (`stream_options.include_usage`); OpenRouter always sends it. */
  streamUsageOption?: boolean;
}

/** Build the chat completions body. The schema goes into the system prompt unless nativeJson is set. */
export function chatBody(req: ProviderRequest, opts: BodyOptions): Record<string, unknown> {
  const native = opts.nativeJson && !!req.schema;
  const messages: ChatMessage[] = [];
  const systemText = [req.system, req.schema && !native ? jsonInstruction(req.schema) : undefined].filter(Boolean).join('\n\n');
  if (systemText) messages.push({ role: 'system', content: systemText });
  for (const m of req.messages) messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text });
  const body: Record<string, unknown> = { model: req.model, messages };
  if (req.maxOutputTokens !== undefined) body.max_tokens = req.maxOutputTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (native) {
    body.response_format = { type: 'json_schema', json_schema: { name: 'response', schema: req.schema, strict: false } };
  }
  if (opts.stream) {
    body.stream = true;
    if (opts.streamUsageOption !== false) body.stream_options = { include_usage: true };
  }
  return body;
}

export class UpstreamError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/** POST a chat completions body; a non-2xx becomes an UpstreamError carrying the (truncated) body text. */
export async function postChat(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<Response> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
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

/** Parse an SSE byte stream into JSON chunks. Comment lines (": OPENROUTER PROCESSING") and [DONE] are skipped. */
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

function errorMessage(e: ChatError | null | undefined): string | undefined {
  if (!e) return undefined;
  return e.message ?? (e.code !== undefined ? `upstream error ${e.code}` : 'upstream error');
}

export interface RunnerOptions {
  /** Label attached to the result when the backend reported its own cost. */
  costSource?: string;
}

/** Turn a non-streaming chat completion response into a ProviderResult. */
export async function completionResult(res: Response, req: ProviderRequest, opts: RunnerOptions = {}): Promise<ProviderResult> {
  const data = (await res.json()) as ChatCompletion;
  const choice = data.choices?.[0];
  // OpenRouter can answer 200 with the error inside the body (top level or per choice).
  const failure = errorMessage(data.error) ?? errorMessage(choice?.error);
  if (failure && !choice?.message?.content) throw new UpstreamError(502, failure);
  const out: ProviderResult = {
    text: stripThink(choice?.message?.content ?? ''),
    usage: usageOf(data.usage),
    model: data.model || req.model,
    finishReason: choice?.finish_reason ?? undefined,
  };
  const cost = reportedCost(data.usage);
  if (cost !== undefined && opts.costSource) {
    out.cost = cost;
    out.costSource = opts.costSource;
  }
  return out;
}

/** Turn a streaming chat completion response into StreamEvents; usage (and cost) come from the final chunk. */
export async function* completionStream(res: Response, req: ProviderRequest, opts: RunnerOptions = {}): AsyncGenerator<StreamEvent> {
  if (!res.body) throw new UpstreamError(502, 'empty stream body');
  let usage: Usage = usageOf(undefined);
  let cost: number | undefined;
  let finishReason: string | undefined;
  for await (const raw of sseJson(res.body)) {
    const chunk = raw as ChatChunk;
    const c = chunk.choices?.[0];
    const failure = errorMessage(chunk.error) ?? errorMessage(c?.error);
    if (failure) throw new UpstreamError(502, failure);
    if (chunk.usage?.prompt_tokens !== undefined) {
      usage = usageOf(chunk.usage);
      cost = reportedCost(chunk.usage);
    }
    if (c?.finish_reason) finishReason = c.finish_reason;
    const text = c?.delta?.content;
    if (text) yield { text };
  }
  void req;
  const done: StreamEvent = { done: true, usage, finishReason };
  if (cost !== undefined && opts.costSource) {
    done.cost = cost;
    done.costSource = opts.costSource;
  }
  yield done;
}
