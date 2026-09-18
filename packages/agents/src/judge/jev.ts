/**
 * Jev judge: TypeSafe System One. Every question is a typed judgment, so nothing here parses prose.
 *
 * The API key is never this class's business: it takes a transport, which is either the proxy (browser, key
 * stays on the server) or the SDK (evals and server code). See transport.ts and transport-sdk.ts.
 */
import { credibilityState, hostState, verdictState } from './state.js';
import type { SystemOneTransport } from './transport.js';
import { binaryConfidence, type CredibilityInput, type HostInput, type HostValue, type Judge, type Judgment, type Spend, type VerdictInput, type VerdictValue } from './types.js';

/** $42 per billion input tokens; output is free. Verified against docs.typesafe.ai/models 2026-09-17. */
export const USD_PER_INPUT_TOKEN = 42 / 1e9;

/** The shape of a Noul answer; a probability of yes and nothing else. */
interface NoulResponse { noul: number }
/** The shape of a Choice answer: the label, its confidence, and the whole distribution. */
interface ChoiceResponse { choice: string; confidence: number; probabilities: Record<string, number> }

export interface JevJudgeOptions { transport: SystemOneTransport; model?: string }

export class JevJudge implements Judge {
  readonly name: string;
  readonly spent: Spend = { calls: 0, input: 0, output: 0, cost: 0 };
  private client: SystemOneTransport;
  private model?: string;
  constructor(o: JevJudgeOptions) {
    this.client = o.transport; this.model = o.model;
    this.name = `jev:${o.model ?? 'latest'}`;
  }

  private bill(usage: { input_tokens: number; output_tokens: number }, cost?: number): void {
    this.spent.calls++; this.spent.input += usage.input_tokens; this.spent.output += usage.output_tokens;
    this.spent.cost += cost ?? usage.input_tokens * USD_PER_INPUT_TOKEN;
  }

  /**
   * Two independent judgments over the same state, asked together: does the whisper agree with what the village
   * has seen, and would obeying it hurt them. Code composes the two rather than asking the model to weigh them,
   * so the threshold stays a game parameter.
   */
  async credible(i: CredibilityInput): Promise<Judgment<boolean>> {
    const res = await this.client.systemOne({
      model: this.model,
      state: credibilityState(i),
      questions: {
        consistent: {
          type: 'noul',
          instructions: 'Does `whisper` agree with what this village has actually seen and knows? Judge the claim against the village\'s own facts, not against whether a spirit is usually right.',
          criteria: { true: 'Nothing the village knows contradicts it, or its own observations support it.', false: 'It contradicts the village\'s stores, land, season or recent events, or asserts something they have no sign of.' },
        },
        harmful: {
          type: 'noul',
          instructions: 'If the chief did exactly as `whisper` says, would this village be worse off for it?',
          criteria: { true: 'Obeying would cost them food, a harvest, a season\'s work or lives.', false: 'Obeying costs little or nothing, or would help them.' },
        },
      },
    });
    this.bill(res.usage, res.cost);
    const consistent = (res.answers.consistent as unknown as NoulResponse).noul;
    const harmful = (res.answers.harmful as unknown as NoulResponse).noul;
    const p = consistent * (1 - harmful);
    return { value: p >= 0.5, p, confidence: binaryConfidence(p), distribution: { consistent, harmful } };
  }

  async verdict(i: VerdictInput): Promise<Judgment<VerdictValue>> {
    const res = await this.client.systemOne({
      model: this.model,
      state: verdictState(i),
      questions: {
        verdict: {
          type: 'choice',
          instructions: 'The spirit made `the_claim`. Judging by `what_happened_since` and the village\'s state now, did it come true?',
          criteria: {
            fulfilled: 'What the spirit said would happen did happen, as the village would see it.',
            failed: 'What the spirit said would happen plainly did not happen.',
            unverifiable: 'The village has no way to tell either way: nothing they saw bears on the claim.',
          },
        },
      },
    });
    this.bill(res.usage, res.cost);
    const a = res.answers.verdict as unknown as ChoiceResponse;
    return { value: a.choice as VerdictValue, p: a.probabilities[a.choice] ?? 0, confidence: a.confidence, distribution: { ...a.probabilities } };
  }

  async hostAnswer(i: HostInput): Promise<Judgment<HostValue>> {
    const res = await this.client.systemOne({
      model: this.model,
      state: hostState(i),
      questions: {
        answer: {
          type: 'choice',
          instructions: 'Envoys stand before the chief with the offer and the ask in the state. How should the chief answer? Keep enough food for our own people; give generously to kin and old trading partners, carefully to strangers, and weigh a threat by whether they could carry it out.',
          criteria: {
            accept: 'Take what they offer and give what they ask, as it stands.',
            counter: 'Trade, but on different terms: give less, or ask for more than they offered.',
            refuse: 'Send them away with nothing.',
          },
        },
      },
    });
    this.bill(res.usage, res.cost);
    const a = res.answers.answer as unknown as ChoiceResponse;
    return { value: a.choice as HostValue, p: a.probabilities[a.choice] ?? 0, confidence: a.confidence, distribution: { ...a.probabilities } };
  }
}
