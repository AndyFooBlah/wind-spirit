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

/** Advance the world by one week. Inputs are applied first, as events. */
export function tick(ctx: Ctx, inputs: Input[]): void {
  const { w } = ctx; const since = ctx.events.length;
  if (w.tick % WEEKS_PER_YEAR === 0) for (const v of w.villages) v.year = emptyYear();
  for (const i of inputs) {
    const v = w.villages[i.village]; if (!v || !v.alive) continue;
    v.orders = i.orders.map(o => ({ ...o, since: w.tick }));
    ctx.events.push({ t: w.tick, type: 'ChiefDecided', village: i.village, orders: i.orders, requestedAt: i.requestedAt });
  }
  ensureRolls(ctx);
  moveParties(ctx);
  work(ctx);
  consumeAndSpoil(ctx);
  healthAndBirths(ctx);
  regrow(ctx);
  happiness(ctx);
  decayPaths(ctx);
  schedule(ctx, since);
  let births = 0, deaths = 0, pop = 0, villages = 0;
  for (let i = since; i < ctx.events.length; i++) { const e = ctx.events[i]; if (e.type === 'Born') births++; else if (e.type === 'Died') deaths++; }
  for (const v of w.villages) if (v.alive) { villages++; pop += v.people.length; }
  ctx.events.push({ t: w.tick, type: 'WeekSummary', births, deaths, pop, villages });
  w.tick++;
}
