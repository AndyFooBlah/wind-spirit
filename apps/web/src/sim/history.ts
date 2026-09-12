/**
 * History: rebuild the world at any past tick from the nearest earlier snapshot and the logged inputs after it.
 * Pure (no worker, no DB) so the history worker and the tests share it.
 */
import { cyrb53, replayTo, type Input, type InputLog, type World } from '@wind-spirit/sim';
import type { LoggedInput } from './protocol.ts';

export interface HistoryWindow { snapshot: string; snapshotTick: number; inputs: Record<number, LoggedInput[]>; }

/**
 * The world as it was when its tick counter read `targetTick` (before that tick's inputs were applied).
 * Sim inputs replay through the sim; the `ChiefMemory` side effects (memory notes, inbox) are applied afterwards,
 * last one per village wins, so the result is bit-identical to the live world at that tick.
 */
export function worldAt(win: HistoryWindow, targetTick: number): World {
  if (targetTick < win.snapshotTick) throw new Error(`target ${targetTick} is before the snapshot at ${win.snapshotTick}`);
  // The Sim constructor calls ensureRolls, which at a season boundary rolls one season ahead before any tick runs
  // (the live sim does that inside the next tick). For the snapshot tick itself the stored JSON is the exact state.
  if (targetTick === win.snapshotTick) return JSON.parse(win.snapshot) as World;
  const log: InputLog = {};
  for (const [t, inputs] of Object.entries(win.inputs)) { const sim = inputs.filter((i): i is Input => i.type !== 'ChiefMemory'); if (sim.length) log[Number(t)] = sim; }
  const w = replayTo(win.snapshot, log, targetTick);
  for (const t of Object.keys(win.inputs).map(Number).sort((a, b) => a - b)) {
    if (t >= targetTick) break;
    for (const i of win.inputs[t]) if (i.type === 'ChiefMemory') { const v = w.villages[i.village]; if (v) { v.memory = [...i.memory]; v.inbox = [...i.inbox]; } }
  }
  return w;
}

/** Same hash the live Sim computes (`Sim.hash()`), for tests and diagnostics. */
export const worldHash = (w: World): string => cyrb53(JSON.stringify(w));
