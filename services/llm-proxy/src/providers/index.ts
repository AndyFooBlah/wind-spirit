import { modelInfo, type ProviderName } from '../models.js';
import { geminiProvider } from './gemini.js';
import { anthropicProvider } from './anthropic.js';
import { openAiCompatProvider } from './openai-compat.js';
import type { Provider } from './types.js';

const providers: Record<ProviderName, Provider> = {
  gemini: geminiProvider,
  anthropic: anthropicProvider,
  'openai-compat': openAiCompatProvider,
};

/** Provider for a model id. Ids outside the catalog are assumed to be Gemini (a class pointed at a brand-new model). */
export function providerFor(model: string): Provider {
  return providers[modelInfo(model)?.provider ?? 'gemini'];
}

export type { Provider, ProviderRequest, ProviderResult, StreamEvent } from './types.js';
