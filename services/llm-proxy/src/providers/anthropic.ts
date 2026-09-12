import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import type Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { modelInfo, type Usage } from '../models.js';
import { jsonInstruction, type Provider, type ProviderRequest, type ProviderResult, type StreamEvent } from './types.js';

/**
 * Claude on Vertex AI through the Anthropic Vertex SDK. Auth is ADC (the SDK uses google-auth-library
 * with the runtime service account); there is no Anthropic API key.
 *
 * JSON schemas are enforced by instruction + validation in the server (Vertex gates native structured
 * outputs behind the org policy constraint vertexai.allowedPartnerModelFeatures, off by default).
 * Prompt caching: the system block carries cache_control so repeated system prompts are read from
 * cache once they exceed the model minimum (Haiku 4.5: 4096 tokens, Sonnet 5: 1024); stable
 * leading messages get the last breakpoint so a long stable history is cached too.
 */
const clients = new Map<string, AnthropicVertex>();

function client(location: string): AnthropicVertex {
  let c = clients.get(location);
  if (!c) {
    c = new AnthropicVertex({ projectId: config.project, region: location, timeout: config.requestTimeoutMs, maxRetries: 1 });
    clients.set(location, c);
  }
  return c;
}

export function usageOf(u: Anthropic.Usage | undefined): Usage {
  const cached = u?.cache_read_input_tokens ?? 0;
  const cacheWrite = u?.cache_creation_input_tokens ?? 0;
  // Anthropic's input_tokens excludes cache reads/writes; normalise so input = everything in the prompt.
  return { input: (u?.input_tokens ?? 0) + cached + cacheWrite, output: u?.output_tokens ?? 0, thoughts: 0, cached, cacheWrite };
}

const CACHE: Anthropic.CacheControlEphemeral = { type: 'ephemeral' };

/** Build the Messages API params. Exported for tests. */
export function toParams(req: ProviderRequest): Anthropic.MessageCreateParamsNonStreaming {
  const useCache = !!req.cache && (modelInfo(req.model)?.minCacheTokens ?? 0) > 0;
  let n = 0;
  while (useCache && n < req.messages.length - 1 && req.messages[n]!.stable) n++;
  const messages: Anthropic.MessageParam[] = req.messages.map((m, i) => {
    const role = m.role === 'model' ? 'assistant' : 'user';
    const last = useCache && n > 0 && i === n - 1;
    return last
      ? { role, content: [{ type: 'text', text: m.text, cache_control: CACHE }] }
      : { role, content: m.text };
  });
  const systemText = [req.system, req.schema ? jsonInstruction(req.schema) : undefined].filter(Boolean).join('\n\n');
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: req.model,
    max_tokens: req.maxOutputTokens ?? 4096,
    messages,
  };
  if (systemText) {
    params.system = useCache ? [{ type: 'text', text: systemText, cache_control: CACHE }] : systemText;
  }
  if (req.temperature !== undefined) params.temperature = req.temperature;
  // thinkingLevel is a Gemini knob; Haiku 4.5 wants budget_tokens and Sonnet 5 wants adaptive, so map loosely.
  if (req.thinkingLevel && req.thinkingLevel !== 'low' && req.thinkingLevel !== 'minimal') {
    params.thinking = req.model.startsWith('claude-haiku-4-5')
      ? { type: 'enabled', budget_tokens: Math.max(1024, Math.floor(params.max_tokens / 2)) }
      : { type: 'adaptive' };
  }
  return params;
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
}

function locationFor(model: string): string {
  return modelInfo(model)?.location ?? config.anthropicLocation;
}

export const anthropicProvider: Provider = {
  name: 'anthropic',

  async generate(req, signal): Promise<ProviderResult> {
    const params = toParams(req);
    const msg = await client(locationFor(req.model)).messages.create(params, { signal });
    return {
      text: textOf(msg.content),
      usage: usageOf(msg.usage),
      model: msg.model || req.model,
      finishReason: msg.stop_reason ?? undefined,
      cacheNote: req.cache ? 'cache_control on system block' : undefined,
    };
  },

  async *stream(req, signal): AsyncGenerator<StreamEvent> {
    const params = toParams(req);
    const stream = client(locationFor(req.model)).messages.stream(params, { signal });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta' && event.delta.text) {
        yield { text: event.delta.text };
      }
    }
    const final = await stream.finalMessage();
    yield {
      done: true,
      usage: usageOf(final.usage),
      finishReason: final.stop_reason ?? undefined,
      cacheNote: req.cache ? 'cache_control on system block' : undefined,
    };
  },
};
