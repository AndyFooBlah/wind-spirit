import { K, mul, ceilDiv } from '../fixed.js';
import { P } from '../params.js';
import { commodityById, compactStores, foodNeed, storageMult, takeFood, type Ctx } from '../world.js';

export function consumeAndSpoil(ctx: Ctx): void {
  const { w } = ctx;
  for (const v of w.villages) {
    if (!v.alive) continue;
    const need = foodNeed(v);
    const eaten = takeFood(w, v, need);
    const shortage = need - eaten;
    // rationing: everyone eats the same share; hunger accumulates by the missing fraction and fades when fed
    const shortK = need > 0 ? Math.trunc((shortage * K) / need) : 0;
    const hungry = shortage > 0 ? Math.min(v.people.length, ceilDiv(shortage, P.foodPerPersonWeek)) : 0;
    v.hungryWeek = hungry;
    v.calmWeeks = shortK > 100 ? 0 : Math.min(999, v.calmWeeks + 1);
    v.hardship = Math.trunc((v.hardship * (K - P.hardshipRate) + shortK * P.hardshipRate) / K);
    if (P.legacy.starvation === 'selective') {
      // original model: a few people starve outright while everyone else eats
      const start = w.tick % Math.max(1, v.people.length);
      for (let i = 0; i < v.people.length; i++) { const p = v.people[(start + i) % v.people.length]; p.hungry = i < hungry ? Math.min(12_000, p.hungry + 1000) : 0; }
    } else for (const p of v.people) p.hungry = shortK > 0 ? Math.min(12_000, p.hungry + shortK) : Math.max(0, p.hungry - 500);
    if (hungry > 0 && w.tick % 4 === 0) ctx.events.push({ t: w.tick, type: 'Famine', village: v.id, hungry });

    // spoilage
    const mult = storageMult(w, v);
    const keep = [];
    for (const s of v.stores) {
      s.age++;
      const cm = commodityById(w, s.c);
      const limit = cm && cm.perish > 0 ? Math.trunc(mul(cm.perish * K, mult) / K) : 0;
      if (limit > 0 && s.age >= limit) { v.year.spoiled += s.qty; continue; }
      keep.push(s);
    }
    v.stores = keep;
    if (w.tick % 13 === 5) compactStores(w, v);
  }
}
