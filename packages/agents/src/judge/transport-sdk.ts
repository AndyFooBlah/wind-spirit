/**
 * The SDK transport: talks to api.typesafe.ai directly with an API key from the environment.
 * Server and eval code only — importing this in the browser would ship the key. The barrel does not re-export it.
 */
import { TypeSafeClient } from '@typesafe-ai/sdk';
import type { SystemOneRequest, SystemOneResult, SystemOneTransport } from './transport.js';

export interface SdkSystemOneOptions { apiKey?: string; defaultModel?: string; timeout?: number }

export class SdkSystemOne implements SystemOneTransport {
  private client: TypeSafeClient;
  constructor(o: SdkSystemOneOptions = {}) {
    this.client = new TypeSafeClient({ apiKey: o.apiKey, defaultModel: o.defaultModel ?? 'jev-latest', timeout: o.timeout ?? 15000 });
  }
  async systemOne(req: SystemOneRequest): Promise<SystemOneResult> {
    const res = await this.client.systemOne({ state: req.state, questions: req.questions as never, ...(req.model ? { model: req.model } : {}) });
    return { model: res.model, answers: res.answers as Record<string, unknown>, usage: res.usage };
  }
}
