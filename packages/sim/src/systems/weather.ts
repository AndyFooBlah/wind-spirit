import { P, seasonIndex, WEEKS_PER_SEASON } from '../params.js';
import type { Direction, SeasonRoll } from '../types.js';
import type { Ctx } from '../world.js';

/** Make sure rolls exist for the current season and four ahead. Emits WeatherRolled for each new roll. */
export function ensureRolls(ctx: Ctx): void {
  const { w } = ctx; const cur = seasonIndex(w.tick); const rng = ctx.rng.get('weather');
  for (let s = w.rolls.length; s <= cur + 4; s++) {
    const winter = s % 4 === 3;
    const r = rng.int(1000);
    let roll: SeasonRoll;
    const hard = winter ? P.rollHard : 0;
    if (r < hard) roll = 'hard';
    else if (r < hard + P.rollStorm) roll = 'storm';
    else if (r < hard + P.rollStorm + P.rollDrought) roll = 'drought';
    else if (r < hard + P.rollStorm + P.rollDrought + P.rollWet) roll = 'wet';
    else roll = 'normal';
    const wind = rng.int(8) as Direction;
    w.rolls.push(roll); w.wind.push(wind);
    if (w.tick > 0 || s === cur) ctx.events.push({ t: w.tick, type: 'WeatherRolled', season: s, roll, wind });
  }
}
export const currentRoll = (ctx: Ctx): SeasonRoll => ctx.w.rolls[seasonIndex(ctx.w.tick)] ?? 'normal';
export const isSeasonStart = (tick: number): boolean => tick % WEEKS_PER_SEASON === 0;
