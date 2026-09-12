/** Replay helpers: rebuild the world at any tick from a snapshot and the inputs logged after it. No model calls. */
import { Sim } from './sim.js';
import type { Input, World } from './types.js';

/** Inputs keyed by the tick at which they were queued (i.e. applied at the start of that tick's processing). */
export type InputLog = Record<number, Input[]>;

/**
 * Replay from a snapshot taken at `snapshot.tick` up to `targetTick` (exclusive of the tick after it).
 * `inputs[t]` are the inputs queued while the world was at tick t, so they are applied when the world advances from t.
 */
export function replayTo(snapshotJson: string, inputs: InputLog, targetTick: number): World {
  const sim = Sim.fromSnapshot(snapshotJson);
  while (sim.world.tick < targetTick) {
    for (const i of inputs[sim.world.tick] ?? []) sim.queue(i);
    sim.tick();
  }
  return sim.syncRng();
}
