import { P, WEEKS_PER_SEASON } from '../params.js';
import type { Event } from '../types.js';
import { storesWeeks, type Ctx } from '../world.js';

/** Emit DeliberationRequested for villages that need a decision. `since` is the index of this tick's first event. */
export function schedule(ctx: Ctx, since: number): void {
  const { w } = ctx;
  const reasons = new Map<number, string[]>();
  const add = (v: number, r: string) => { const a = reasons.get(v) ?? []; a.push(r); reasons.set(v, a); };
  for (let i = since; i < ctx.events.length; i++) {
    const e: Event = ctx.events[i];
    if (e.type === 'ChiefSucceeded') add(e.village, 'succession');
    else if (e.type === 'PartyReturned') add(e.village, 'party-returned');
    else if (e.type === 'VillageFounded') add(e.village, 'founded');
    else if (e.type === 'Built') add(e.village, 'built');
    else if (e.type === 'Discovered') add(e.village, 'discovery');
    else if (e.type === 'SpiritSpoke') add(e.village, 'spirit');
    else if (e.type === 'ClaimResolved') add(e.village, 'omen');
    else if (e.type === 'RaidResolved') { add(e.defender, 'raided'); }
    else if (e.type === 'TradeCompleted' || e.type === 'TradeRefused') add(e.village, 'visitor-left');
  }
  for (const v of w.villages) {
    if (!v.alive) continue;
    if (w.tick % WEEKS_PER_SEASON === 0) add(v.id, 'season');
    else if (v.hungryWeek > 0 && w.tick % 2 === 0) add(v.id, 'famine');
    else if (storesWeeks(w, v) < P.famineStoresWeeks && w.tick % 4 === 0) add(v.id, 'low-food');
  }
  for (const [village, rs] of reasons) ctx.events.push({ t: w.tick, type: 'DeliberationRequested', village, reason: rs.join(',') });
}
