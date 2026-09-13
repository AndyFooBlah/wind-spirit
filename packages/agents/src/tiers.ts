/**
 * Intelligence tiers: how much model to spend on chiefs. A tier maps decision classes to proxy model classes and
 * sets the deliberation cadence. Dollar targets are per chief per century at the measured token counts.
 */
import type { ModelClass } from './client.js';
export type DecisionClass = 'routine' | 'impactful' | 'conversation';
export type TierName = 'habit' | 'thrifty' | 'standard' | 'lavish';
export interface Tier { name: TierName; dollarsPerCentury: number; routine: ModelClass | 'habit'; impactful: ModelClass | 'habit'; conversation: ModelClass; digestOnly: boolean; }

export const TIERS: Record<TierName, Tier> = {
  // Measured 2026-09-12 on the 96-case corpus at Vertex prices (normal cadence, 13 routine + 4 impactful decisions a year):
  //   cheapest = Gemini 2.5 Flash-Lite ($0.0004/decision, rules 0.95), cheap = 3.5 Flash-Lite ($0.0016, rules 0.96, best journals),
  //   routine = 3.8 Flash ($0.0070, rules 0.97), capable/premium = 3.1 Pro ($0.0177). See docs/evals-notes.md.
  habit:    { name: 'habit',    dollarsPerCentury: 0,   routine: 'habit',    impactful: 'habit',   conversation: 'capable', digestOnly: true },
  thrifty:  { name: 'thrifty',  dollarsPerCentury: 1,   routine: 'cheapest', impactful: 'cheap',   conversation: 'capable', digestOnly: false },   // ~$1.16 a century
  standard: { name: 'standard', dollarsPerCentury: 5,   routine: 'cheap',    impactful: 'routine', conversation: 'capable', digestOnly: false },   // ~$5.07 a century
  lavish:   { name: 'lavish',   dollarsPerCentury: 100, routine: 'routine',  impactful: 'capable', conversation: 'premium', digestOnly: false },   // ~$16 a century; the rest of the budget is headroom
};

/** Which decisions carry weight: anything urgent, visitors with demands, and seasonal decisions where settling or raiding is on the table. */
export function classify(reason: string, ctx: { sites: number; pop: number; hungry: boolean; visitorThreat?: boolean }): DecisionClass {
  const rs = reason.split(/[, ]+/);
  if (rs.includes('visitor') || rs.includes('visitors')) return 'impactful';
  if (rs.some(r => ['raided', 'famine', 'succession', 'spirit', 'omen', 'founded'].includes(r))) return 'impactful';
  if (ctx.hungry) return 'impactful';
  if (rs.includes('season') && ctx.sites > 0 && ctx.pop >= 40) return 'impactful';
  return 'routine';
}
