/**
 * LLM judge: the same three questions put to a normal model through the proxy, with the same compact state,
 * so a comparison against Jev measures the judgment and not the prompt. Probabilities are self-reported and
 * therefore not calibrated by construction — that is part of what the comparison is for.
 */
import type { LlmClient, ModelClass } from '../client.js';
import { credibilityState, hostState, verdictState, type JsonObject } from './state.js';
import { binaryConfidence, type CredibilityInput, type HostInput, type HostValue, type Judge, type Judgment, type Spend, type VerdictInput, type VerdictValue } from './types.js';

const P = { type: 'number', description: 'a probability from 0 to 1' } as const;
const CRED_SCHEMA = { type: 'object', properties: { consistent: P, harmful: P }, required: ['consistent', 'harmful'] } as const;
const VERDICT_SCHEMA = { type: 'object', properties: { verdict: { type: 'string', enum: ['fulfilled', 'failed', 'unverifiable'] }, probability: P }, required: ['verdict', 'probability'] } as const;
const HOST_JUDGE_SCHEMA = { type: 'object', properties: { answer: { type: 'string', enum: ['accept', 'counter', 'refuse'] }, probability: P }, required: ['answer', 'probability'] } as const;

const clamp01 = (x: unknown): number => Math.max(0, Math.min(1, Number(x) || 0));

export interface LlmJudgeOptions { client: LlmClient; modelClass?: ModelClass; model?: string }

export class LlmJudge implements Judge {
  readonly name: string;
  readonly spent: Spend = { calls: 0, input: 0, output: 0, cost: 0 };
  constructor(private o: LlmJudgeOptions) { this.name = `llm:${o.model ?? o.modelClass ?? 'routine'}`; }

  private async ask(system: string, state: JsonObject, schema: object): Promise<Record<string, unknown>> {
    const res = await this.o.client.generate({
      class: this.o.modelClass ?? 'routine', model: this.o.model, system,
      messages: [{ role: 'user', text: JSON.stringify(state, null, 1) }],
      schema, maxOutputTokens: 1000, temperature: 0, thinkingLevel: 'low',
    });
    this.spent.calls++; this.spent.input += res.usage.input; this.spent.output += res.usage.output; this.spent.cost += res.cost ?? 0;
    const json = (res.json ?? safeJson(res.text)) as Record<string, unknown> | undefined;
    if (!json) throw new Error('judge: no json');
    return json;
  }

  async credible(i: CredibilityInput): Promise<Judgment<boolean>> {
    const json = await this.ask(
      'You weigh what a spirit has told the chief of a stone-age village against what that village actually knows. Answer only with the JSON asked for. `consistent` is the probability that the whisper agrees with the village\'s own facts. `harmful` is the probability that the village would be worse off if the chief did exactly as it says.',
      credibilityState(i), CRED_SCHEMA);
    const consistent = clamp01(json.consistent); const harmful = clamp01(json.harmful);
    const p = consistent * (1 - harmful);
    return { value: p >= 0.5, p, confidence: binaryConfidence(p), distribution: { consistent, harmful } };
  }

  async verdict(i: VerdictInput): Promise<Judgment<VerdictValue>> {
    const json = await this.ask(
      'You judge whether a spirit\'s claim to a stone-age village came true, using only what the village saw. Answer only with the JSON asked for; `probability` is your confidence in the verdict you chose.',
      verdictState(i), VERDICT_SCHEMA);
    const value = String(json.verdict) as VerdictValue;
    const p = clamp01(json.probability);
    return { value, p, confidence: p, distribution: { [value]: p } };
  }

  async hostAnswer(i: HostInput): Promise<Judgment<HostValue>> {
    const json = await this.ask(
      'You advise the chief of a stone-age village on how to answer envoys. Keep enough food for our own people; give generously to kin and old trading partners, carefully to strangers, and weigh a threat by whether they could carry it out. Answer only with the JSON asked for; `probability` is your confidence in the answer you chose.',
      hostState(i), HOST_JUDGE_SCHEMA);
    const value = String(json.answer) as HostValue;
    const p = clamp01(json.probability);
    return { value, p, confidence: p, distribution: { [value]: p } };
  }
}

function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { const m = s.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch { return undefined; } } return undefined; } }
