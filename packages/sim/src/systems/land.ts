import { K, mul, div } from '../fixed.js';
import { P, regrowWeatherFactor, seasonOf, WEEKS_PER_SEASON } from '../params.js';
import { WILD } from '../types.js';
import type { Ctx } from '../world.js';
import { currentRoll } from './weather.js';

export function regrow(ctx: Ctx): void {
  const { w } = ctx; const season = seasonOf(w.tick); const wf = regrowWeatherFactor(currentRoll(ctx));
  const growingSeason = season === 0 || season === 1;
  for (const t of w.tiles) {
    for (const r of WILD) {
      const cap = t.cap[r]; if (cap === 0) continue;
      const stock = t.stock[r]; if (stock >= cap) continue;
      let rate = P.regrow[r]; if (rate === 0) continue;
      if (r === 'plants') { if (!growingSeason) continue; rate = mul(rate, wf); }
      const floor = Math.max(stock, Math.trunc(cap / 100));           // depleted stocks recover from a seed floor
      const growth = mul(mul(rate, floor), div(cap - stock, cap));
      t.stock[r] = Math.min(cap, stock + Math.max(1, growth));
    }
  }
  if (w.tick % WEEKS_PER_SEASON === 0) {
    for (const v of w.villages) if (v.alive) for (const p of v.plots) {
      if ((p.kind === 'clear' || p.kind === 'field') && !p.planted && p.fertility < K) p.fertility = Math.min(K, p.fertility + P.fertilityRecoverPerFallowSeason);
    }
  }
}
