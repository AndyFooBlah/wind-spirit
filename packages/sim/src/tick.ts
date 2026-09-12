import { WEEKS_PER_YEAR } from './params.js';
import type { Input } from './types.js';
import { emptyYear, type Ctx } from './world.js';
import { consumeAndSpoil } from './systems/consume.js';
import { happiness } from './systems/happiness.js';
import { healthAndBirths } from './systems/health.js';
import { regrow } from './systems/land.js';
import { decayPaths } from './systems/paths.js';
import { schedule } from './systems/schedule.js';
import { moveParties } from './systems/travel.js';
import { ensureRolls } from './systems/weather.js';
import { work } from './systems/work.js';
import { decayGrudges, envoyTimeouts, hostDecides } from './systems/diplomacy.js';
import { breathe, chiefJudged, prayer, recordClaims, regenBreath, resolveClaims, spiritSpoke, storms } from './systems/spirit.js';

/** Advance the world by one week. Inputs are applied first, as events. */
export function tick(ctx: Ctx, inputs: Input[]): void {
  const { w } = ctx; const since = ctx.events.length;
  if (w.tick % WEEKS_PER_YEAR === 0) for (const v of w.villages) v.year = emptyYear();
  for (const i of inputs) {
    if (i.type === 'SpiritBreathed') { breathe(ctx, i.action); continue; }
    const v = w.villages[i.village]; if (!v || !v.alive) continue;
    if (i.type === 'SpiritSpoke') { spiritSpoke(ctx, i.village, i.text); continue; }
    if (i.type === 'ClaimsMade') { recordClaims(ctx, i.village, i.claims); continue; }
    if (i.type === 'ChiefJudged') { chiefJudged(ctx, i.village, i.verdicts); continue; }
    if (i.type === 'Prayer') { prayer(ctx, i.village, i.text); continue; }
    if (i.type === 'ChiefDecided') {
      v.orders = i.orders.map(o => ({ ...o, params: { ...o.params }, since: w.tick }));   // clone: the sim mutates params, inputs must stay immutable
      ctx.events.push({ t: w.tick, type: 'ChiefDecided', village: i.village, orders: i.orders, requestedAt: i.requestedAt });
    } else if (i.type === 'HostDecided') {
      const p = w.parties.find(x => x.id === i.party); if (!p || p.waiting === 0 || p.targetVillage !== v.id) continue;
      ctx.events.push({ t: w.tick, type: 'HostDecided', village: i.village, party: i.party, answer: i.answer, requestedAt: i.requestedAt });
      hostDecides(ctx, v, p, i.answer);
    }
  }
  ensureRolls(ctx);
  regenBreath(ctx);
  moveParties(ctx);
  storms(ctx);
  envoyTimeouts(ctx);
  work(ctx);
  consumeAndSpoil(ctx);
  healthAndBirths(ctx);
  regrow(ctx);
  happiness(ctx);
  decayPaths(ctx);
  decayGrudges(ctx);
  resolveClaims(ctx);
  schedule(ctx, since);
  let births = 0, deaths = 0, pop = 0, villages = 0;
  for (let i = since; i < ctx.events.length; i++) { const e = ctx.events[i]; if (e.type === 'Born') births++; else if (e.type === 'Died') deaths++; }
  for (const v of w.villages) if (v.alive) { villages++; pop += v.people.length; }
  ctx.events.push({ t: w.tick, type: 'WeekSummary', births, deaths, pop, villages });
  w.tick++;
}
