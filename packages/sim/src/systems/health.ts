import { K, mul } from '../fixed.js';
import { AGE_ELDER, P, seasonOf, WEEKS_PER_YEAR } from '../params.js';
import type { Stage, Village } from '../types.js';
import { hasCap, newPerson, popCounts, shelter, stageOf, storeByCategory, type Ctx } from '../world.js';
import { currentRoll } from './weather.js';

function weeklyBaseM(stage: Stage, age: number): number {
  const a = P.annualDeath;
  const annual = stage === 'child' ? a.child : stage === 'adult' ? a.adult : a.elder + a.elderPerYear * Math.floor((age - AGE_ELDER()) / WEEKS_PER_YEAR);
  return Math.trunc(annual / WEEKS_PER_YEAR);
}

export function healthAndBirths(ctx: Ctx): void {
  const { w } = ctx; const rng = ctx.rng.get('mortality'); const births = ctx.rng.get('births');
  const winter = seasonOf(w.tick) === 3; const hard = currentRoll(ctx) === 'hard';
  for (const v of w.villages) {
    if (!v.alive) continue;
    const sh = shelter(w, v);
    let exposure = K;
    if (winter) { exposure = K + Math.trunc(((K - sh.score) * P.winterExposureMult) / K); if (hard) exposure = Math.trunc(exposure * 1.5); if (storeByCategory(w, v, 'cloth') >= Math.trunc((v.people.length * K) / 2)) exposure = Math.trunc((exposure * 700) / K); }
    const medicine = hasCap(v, 'medicine') ? 800 : K;
    let deaths = 0;
    const survivors = [];
    for (const p of v.people) {
      const age = w.tick - p.born; const stage = stageOf(p.born, w.tick);
      let pM = weeklyBaseM(stage, age);
      pM = Math.trunc((pM * exposure) / K); pM = Math.trunc((pM * medicine) / K);
      if (p.hungry > 0) { const h = Math.min(8, p.hungry / 1000); pM = Math.trunc(pM * (1 + P.hungerMult * h * h)); }
      if (pM > 0 && rng.chanceM(Math.min(pM, 999_999))) {
        deaths++;
        const cause = p.hungry >= 1000 ? 'hunger' : 'age';
        if (cause === 'hunger') v.year.deathsHunger++; else v.year.deathsAge++;
        ctx.events.push({ t: w.tick, type: 'Died', village: v.id, person: p.id, cause, stage });
        continue;
      }
      survivors.push(p);
    }
    v.people = survivors;
    v.recentDeaths.push(deaths); if (v.recentDeaths.length > 13) v.recentDeaths.shift();
    if (v.people.length === 0) { v.alive = false; w.tiles[v.tile].village = -1; ctx.events.push({ t: w.tick, type: 'VillageDied', village: v.id }); continue; }
    if (!v.people.some(p => p.id === v.chief)) succeed(ctx, v, 'death');

    // births
    const counts = popCounts(v, w.tick);
    let fertility = Math.max(0, K - Math.trunc((v.hardship * K) / P.birthHardshipZero));
    if (P.legacy.births === 'calmgate') fertility = v.calmWeeks >= 8 ? K : 0;   // the original cliff-shaped gate
    if (counts.adults >= 2 && fertility > 0) {
      const pM = Math.trunc(((P.annualBirthPerAdult / WEEKS_PER_YEAR) * fertility) / K);
      for (let i = 0; i < counts.adults; i++) if (births.chanceM(pM)) {
        const child = newPerson(w, w.tick); v.people.push(child); v.year.births++;
        ctx.events.push({ t: w.tick, type: 'Born', village: v.id, person: child.id });
      }
    }
  }
}

export function succeed(ctx: Ctx, v: Village, reason: 'death' | 'coup'): void {
  const rng = ctx.rng.get('names');
  const adults = v.people.filter(p => stageOf(p.born, ctx.w.tick) === 'adult' && p.id !== v.chief);
  const pool = adults.length ? adults : v.people.filter(p => p.id !== v.chief);
  if (!pool.length) return;
  v.chief = rng.pick(pool).id;
  v.chiefTraits = v.culture.map(c => Math.max(0, Math.min(K, c + rng.range(-150, 150))));
  v.culture = v.culture.map((c, i) => Math.max(0, Math.min(K, c + Math.trunc((v.chiefTraits[i] - c) / 10))));
  v.lowHappyWeeks = 0;
  v.trust = mul(v.trust, P.trustInherit);
  ctx.events.push({ t: ctx.w.tick, type: 'ChiefSucceeded', village: v.id, chief: v.chief, reason });
}
