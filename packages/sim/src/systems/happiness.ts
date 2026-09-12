import { K } from '../fixed.js';
import { P } from '../params.js';
import { shelter, storesWeeks, type Ctx } from '../world.js';
import { succeed } from './health.js';

export function happiness(ctx: Ctx): void {
  const { w } = ctx;
  for (const v of w.villages) {
    if (!v.alive) continue;
    const food = Math.min(K, Math.trunc((v.calmWeeks * K) / P.happyCalmWeeks) + Math.min(300, storesWeeks(w, v) * 30));
    const sh = shelter(w, v).score;
    const deaths = v.recentDeaths.reduce((a, b) => a + b, 0);
    const deathRate = Math.min(K, Math.trunc((deaths * K) / Math.max(1, v.people.length)));
    const hunger = Math.min(K, Math.trunc((v.hungryWeek * K) / Math.max(1, v.people.length)));
    let h = Math.trunc((food * 500 + sh * 300 + (K - deathRate) * 200) / K) - Math.trunc(hunger / 2);
    h = Math.max(0, Math.min(K, h));
    v.happiness = Math.trunc((v.happiness * 3 + h) / 4);   // smooth
    if (v.happiness < P.coupBelow) { v.lowHappyWeeks++; if (v.lowHappyWeeks >= P.coupWeeks) succeed(ctx, v, 'coup'); }
    else v.lowHappyWeeks = 0;
  }
}
