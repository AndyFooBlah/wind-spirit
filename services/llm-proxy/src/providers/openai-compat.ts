import { GoogleAuth } from 'google-auth-library';
import { config } from '../config.js';
import { modelInfo } from '../models.js';
import { chatBody, completionResult, completionStream, postChat } from './chat-completions.js';
import type { Provider, ProviderRequest, ProviderResult, StreamEvent } from './types.js';

/**
 * Open models served as managed APIs (MaaS) through Vertex AI's OpenAI-compatible chat completions
 * endpoint. Bearer is an ADC access token for the runtime service account.
 *
 *   POST https://{host}/v1/projects/{p}/locations/{loc}/endpoints/openapi/chat/completions
 *   { model: "<publisher>/<model>", messages: [...], response_format?, stream?, stream_options? }
 *
 * Usage comes back OpenAI-style: prompt_tokens (including cached), completion_tokens (including any
 * reasoning), prompt_tokens_details.cached_tokens when the backend reports cache hits. The request
 * and response plumbing is shared with the OpenRouter adapter in `chat-completions.ts`.
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

/** Build the chat completions body. Exported for tests. */
export function toBody(req: ProviderRequest, stream: boolean): Record<string, unknown> {
  return chatBody(req, { nativeJson: modelInfo(req.model)?.nativeJsonSchema ?? false, stream });
}

async function post(req: ProviderRequest, body: unknown, signal: AbortSignal): Promise<Response> {
  return postChat(endpointFor(req.model), { Authorization: `Bearer ${await accessToken()}` }, body, signal);
}

export const openAiCompatProvider: Provider = {
  name: 'openai-compat',

  async generate(req, signal): Promise<ProviderResult> {
    return completionResult(await post(req, toBody(req, false), signal), req);
  },

  async *stream(req, signal): AsyncGenerator<StreamEvent> {
    yield* completionStream(await post(req, toBody(req, true), signal), req);
  },
};

export { sseJson, stripThink, usageOf } from './chat-completions.js';
