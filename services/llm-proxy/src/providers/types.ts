import type { Usage } from '../models.js';

export interface Message {
  role: 'user' | 'model';
  text: string;
  /**
   * Marked by the client when the message is part of a stable prefix that may be placed in an
   * explicit context cache (Gemini) or under a cache breakpoint (Anthropic). Only a leading run of
   * stable messages is cached; the first non-stable message ends the prefix.
   */
  stable?: boolean;
}

/** What every provider receives: the validated request plus the resolved model id. */
export interface ProviderRequest {
  model: string;
  system?: string;
  messages: Message[];
  schema?: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
  thinkingLevel?: string;
  /** Explicit context-cache request (Gemini explicit caching / Anthropic cache_control). */
  cache?: { key: string; ttlSeconds: number };
}

export interface ProviderResult {
  text: string;
  usage: Usage;
  model: string;
  finishReason?: string;
  /** Provider-specific detail about caching for the log line (e.g. explicit cache name, or why none). */
  cacheNote?: string;
  /** USD charged for the call as reported by the provider itself (OpenRouter `usage.cost`); absent means "use the pricing table". */
  cost?: number;
  /** Where `cost` came from when the provider reported it (e.g. 'openrouter'). */
  costSource?: string;
}

/** Stream events: text deltas, then exactly one final event carrying usage. */
export type StreamEvent =
  | { text: string }
  | { done: true; usage: Usage; finishReason?: string; cacheNote?: string; cost?: number; costSource?: string };

export interface Provider {
  readonly name: string;
  /** Absent = always available. Returns false when the provider is deployed without its credential (503 provider_disabled). */
  readonly available?: () => boolean;
  generate(req: ProviderRequest, signal: AbortSignal): Promise<ProviderResult>;
  stream(req: ProviderRequest, signal: AbortSignal): AsyncGenerator<StreamEvent>;
}

/** Appended to the system prompt when a provider cannot enforce a JSON schema natively. */
export function jsonInstruction(schema: Record<string, unknown>): string {
  return [
    'Respond with a single JSON value and nothing else: no prose, no markdown fences.',
    'The JSON must conform to this JSON Schema:',
    JSON.stringify(schema),
  ].join('\n');
}

/** Pull a JSON value out of model text that may be wrapped in fences or prose. Returns undefined if none parses. */
export function extractJson(text: string): unknown {
  const candidates = [text.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) candidates.unshift(fenced[1].trim());
  const first = text.search(/[[{]/);
  if (first >= 0) {
    const lastObj = text.lastIndexOf('}');
    const lastArr = text.lastIndexOf(']');
    const last = Math.max(lastObj, lastArr);
    if (last > first) candidates.push(text.slice(first, last + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try next */
    }
  }
  return undefined;
}
