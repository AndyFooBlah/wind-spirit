import { mul } from '../fixed.js';
import { P, TERRAIN } from '../params.js';
import type { Ctx } from '../world.js';

export function tread(ctx: Ctx, tile: number, amount: number): void {
  const t = ctx.w.tiles[tile];
  // Boats leave no trail: water never wears into a path, except a ford, which is a crossing on foot.
  if (t.road || (TERRAIN[t.terrain].water && !t.ford)) return;
  const before = t.trodden; t.trodden += amount;
  if (before < P.pathAt && t.trodden >= P.pathAt) ctx.events.push({ t: ctx.w.tick, type: 'PathFormed', tile });
}

export function decayPaths(ctx: Ctx): void {
  for (const t of ctx.w.tiles) if (t.trodden > 0 && !t.road) { t.trodden -= mul(t.trodden, P.pathDecay); if (t.trodden < 0) t.trodden = 0; }
}
export const isPath = (trodden: number, road: boolean): boolean => road || trodden >= P.pathAt;
