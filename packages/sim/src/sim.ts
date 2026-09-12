import { cyrb53 } from './hash.js';
import { Streams } from './rng.js';
import { tick } from './tick.js';
import type { Event, Input, World } from './types.js';
import type { Ctx } from './world.js';

/** The simulation: a world, its RNG streams, and a queue of inputs applied at the next tick. */
export class Sim {
  readonly ctx: Ctx;
  private pending: Input[] = [];
  constructor(world: World) {
    const rng = new Streams(world.seed, Object.keys(world.rng).length ? world.rng : undefined);
    this.ctx = { w: world, rng, events: [] };   // rolls are ensured at the start of each tick, never here, so a restored world hashes as stored
  }
  get world(): World { return this.ctx.w; }
  queue(input: Input): void { this.pending.push(input); }
  /** Advance one week; returns this week's events. */
  tick(): Event[] {
    const inputs = this.pending; this.pending = [];
    tick(this.ctx, inputs);
    const out = this.ctx.events; this.ctx.events = [];
    return out;
  }
  /** Write the RNG stream states into the world so it can be handed off or serialized elsewhere. */
  syncRng(): World { this.ctx.w.rng = this.ctx.rng.save(); return this.ctx.w; }
  snapshot(): string { return JSON.stringify(this.syncRng()); }
  hash(): string { return cyrb53(this.snapshot()); }
  static fromSnapshot(json: string): Sim { return new Sim(JSON.parse(json) as World); }
}
