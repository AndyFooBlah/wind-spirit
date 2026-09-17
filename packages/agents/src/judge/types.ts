/**
 * The judgment adapter: the handful of chief decisions that are a label or a probability rather than prose.
 * Two implementations answer the same three questions — a System One model (Jev) or an LLM through the proxy —
 * so a deployment can swap one for the other without the scheduler knowing which it has.
 */
import type { Mandate } from '@wind-spirit/sim';
import type { VillageView } from '../view.js';

/** One judgment. `p` is the probability of the chosen value; for a binary it is p(yes). */
export interface Judgment<V = string> {
  value: V;
  p: number;
  /** How concentrated the distribution is. A binary has none, so it reports p's distance from a coin flip. */
  confidence: number;
  distribution?: Record<string, number>;
}

export interface CredibilityInput { view: VillageView; whisper: string }
export interface VerdictInput { view: VillageView; claim: string; since: string[] }
export interface HostInput { view: VillageView; from: string; mandate: Mandate; cname: (id: string) => string; rname: (id: string) => string }

export type VerdictValue = 'fulfilled' | 'failed' | 'unverifiable';
export type HostValue = 'accept' | 'counter' | 'refuse';

export interface Spend { calls: number; input: number; output: number; cost: number }

export interface Judge {
  readonly name: string;
  /** Should the chief act on what the spirit just said? p is the probability the whisper is worth believing. */
  credible(i: CredibilityInput): Promise<Judgment<boolean>>;
  /** Did a spirit claim now due come true? */
  verdict(i: VerdictInput): Promise<Judgment<VerdictValue>>;
  /** How to answer envoys standing in the village. */
  hostAnswer(i: HostInput): Promise<Judgment<HostValue>>;
  readonly spent: Spend;
}

/** Binary confidence: 0 at a coin flip, 1 at certainty. Keeps Noul comparable with Choice's own confidence. */
export const binaryConfidence = (p: number): number => Math.abs(p - 0.5) * 2;
