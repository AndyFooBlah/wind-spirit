/** The spirit's side: messages, breath, storms, claims, and trust. */
import { K, mul } from '../fixed.js';
import { P, seasonIndex } from '../params.js';
import type { BreathAction, Claim, SeasonRoll, Village } from '../types.js';
import { type Ctx } from '../world.js';

const WET_ORDER: SeasonRoll[] = ['drought', 'normal', 'wet'];

export function spiritSpoke(ctx: Ctx, village: number, text: string): void {
  const v = ctx.w.villages[village]; if (!v?.alive) return;
  v.inbox.push(text.slice(0, 1000));
  ctx.events.push({ t: ctx.w.tick, type: 'SpiritSpoke', village, text });
}

export function prayer(ctx: Ctx, village: number, text: string): void { ctx.events.push({ t: ctx.w.tick, type: 'Prayer', village, text }); }

export function regenBreath(ctx: Ctx): void { ctx.w.breath = Math.min(P.breathCap, ctx.w.breath + P.breathRegen); }

/** Apply a breath action if the pool allows and the target is legal. Weather acts only on seasons not yet begun. */
export function breathe(ctx: Ctx, a: BreathAction): boolean {
  const { w } = ctx; const cur = seasonIndex(w.tick);
  const cost = a.kind === 'nudge' ? P.breathNudge : a.kind === 'override' ? P.breathOverride : a.kind === 'storm' ? P.breathStorm : P.breathSail;
  if (w.breath < cost) return false;
  let natural: SeasonRoll | undefined, adjusted: SeasonRoll | undefined;
  if (a.kind === 'nudge' || a.kind === 'override') {
    if (a.season <= cur || a.season >= w.rolls.length) return false;
    natural = w.rolls[a.season]; const winter = a.season % 4 === 3;
    if (a.kind === 'override') adjusted = a.roll;
    else if (a.direction === 'milder' || a.direction === 'harsher') { if (!winter) return false; adjusted = a.direction === 'milder' ? (natural === 'hard' ? 'normal' : natural) : (natural === 'normal' ? 'hard' : natural); }
    else { const i = WET_ORDER.indexOf(natural === 'storm' || natural === 'hard' ? 'normal' : natural); const j = Math.max(0, Math.min(2, i + (a.direction === 'wetter' ? 1 : -1))); adjusted = WET_ORDER[j]; }
    w.rolls[a.season] = adjusted;
  } else if (a.kind === 'storm') {
    if (a.tile < 0 || a.tile >= w.tiles.length) return false;
    w.storms.push({ tile: a.tile, tick: w.tick + 1 });
  } else {
    const p = w.parties.find(x => x.id === a.party); if (!p || !p.boat) return false;
    p.sailBoost = a.mode;
  }
  w.breath -= cost;
  ctx.events.push({ t: w.tick, type: 'SpiritBreathed', action: a, cost, natural, adjusted });
  return true;
}

/** Storms strike parties on the tile: boats may sink, land parties lose people and a week. */
export function storms(ctx: Ctx): void {
  const { w } = ctx; const rng = ctx.rng.get('weather');
  const due = w.storms.filter(s => s.tick <= w.tick); if (!due.length) return;
  w.storms = w.storms.filter(s => s.tick > w.tick);
  for (const s of due) {
    let parties = 0, drowned = 0;
    for (const p of w.parties) {
      if (p.at !== s.tile || p.sailBoost === 'fill') continue;
      parties++;
      const share = p.boat ? 500 : 250;
      const lost = p.members.filter(() => rng.chance(share));
      for (const m of lost) ctx.events.push({ t: w.tick, type: 'Died', village: p.home, person: m.id, cause: 'travel', stage: 'adult' });
      p.members = p.members.filter(m => !lost.includes(m)); drowned += lost.length; w.villages[p.home].year.deathsTravel += lost.length;
      if (p.boat) p.cargo = []; p.lostWeeks += 1;
    }
    w.parties = w.parties.filter(p => p.members.length > 0);
    ctx.events.push({ t: w.tick, type: 'StormStruck', tile: s.tile, parties, drowned });
  }
}

export function recordClaims(ctx: Ctx, village: number, claims: { text: string; due: number; check: Claim['check'] }[]): void {
  const v = ctx.w.villages[village]; if (!v?.alive) return;
  for (const c of claims.slice(0, 5)) { const claim: Claim = { id: ctx.w.nextId++, tick: ctx.w.tick, text: c.text.slice(0, 300), due: Math.max(ctx.w.tick + 1, c.due), check: c.check, outcome: 'pending' }; v.chronicle.push(claim); ctx.events.push({ t: ctx.w.tick, type: 'ClaimRecorded', village, claim }); }
  if (v.chronicle.length > 40) v.chronicle = v.chronicle.slice(-40);
}

function applyOutcome(ctx: Ctx, v: Village, c: Claim, outcome: 'fulfilled' | 'failed' | 'unverifiable'): void {
  const before = v.trust; c.outcome = outcome;
  const skepticism = K - v.chiefTraits[0];
  if (outcome === 'fulfilled') v.trust = Math.min(K, v.trust + mul(P.trustFulfilled, K - Math.trunc(skepticism / 2)));
  else if (outcome === 'failed') v.trust = Math.max(0, v.trust + P.trustFailed);
  ctx.events.push({ t: ctx.w.tick, type: 'ClaimResolved', village: v.id, claim: c.id, outcome, trustBefore: before, trustAfter: v.trust });
}

/** Sim-checkable claims resolve when due; judged claims wait for the chief. */
export function resolveClaims(ctx: Ctx): void {
  const { w } = ctx;
  for (const v of w.villages) { if (!v.alive) continue; for (const c of v.chronicle) {
    if (c.outcome !== 'pending' || c.due > w.tick) continue;
    if (c.check.kind === 'weather') { const actual = w.rolls[c.check.season]; applyOutcome(ctx, v, c, actual === undefined ? 'unverifiable' : actual === c.check.roll ? 'fulfilled' : 'failed'); }
    else if (c.check.kind === 'none') applyOutcome(ctx, v, c, 'unverifiable');
    // 'judged' claims stay pending until the chief rules on them
  } }
}

export function chiefJudged(ctx: Ctx, village: number, verdicts: { claim: number; verdict: 'fulfilled' | 'failed' | 'unverifiable' }[]): void {
  const v = ctx.w.villages[village]; if (!v?.alive) return;
  for (const vd of verdicts) { const c = v.chronicle.find(x => x.id === vd.claim); if (c && c.outcome === 'pending' && c.check.kind === 'judged') applyOutcome(ctx, v, c, vd.verdict); }
}
