/**
 * Intelligence tiers: how much model to spend on chiefs. A tier maps decision classes to proxy model classes and
 * sets the deliberation cadence. Dollar targets are per chief per century at the measured token counts.
 */
import type { ModelClass } from './client.js';
export type DecisionClass = 'routine' | 'impactful' | 'conversation';
export type TierName = 'habit' | 'thrifty' | 'standard' | 'lavish';
export interface Tier { name: TierName; dollarsPerCentury: number; routine: ModelClass | 'habit'; impactful: ModelClass | 'habit'; conversation: ModelClass; digestOnly: boolean; }

export const TIERS: Record<TierName, Tier> = {
  habit:    { name: 'habit',    dollarsPerCentury: 0,   routine: 'habit',   impactful: 'habit',   conversation: 'capable', digestOnly: true },
  thrifty:  { name: 'thrifty',  dollarsPerCentury: 1,   routine: 'cheap',   impactful: 'routine', conversation: 'capable', digestOnly: true },
  standard: { name: 'standard', dollarsPerCentury: 5,   routine: 'routine', impactful: 'routine', conversation: 'capable', digestOnly: false },
  lavish:   { name: 'lavish',   dollarsPerCentury: 100, routine: 'routine', impactful: 'capable', conversation: 'premium', digestOnly: false },
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
