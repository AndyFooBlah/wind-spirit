/**
 * The engine: buses, lifecycle, scene and the glue between the pure logic (coalescer, generator,
 * markers) and the players. Nothing here runs at import time; the context is created on the
 * first `resume()` unless one was passed in.
 */
import { AmbientMixer, ambientRecipe } from './ambient.js';
import { Coalescer, type Cue } from './events.js';
import { MarkerPlayer } from './markers.js';
import { deriveMusic, type MusicSpec } from './music.js';
import { MusicPlayer } from './musicPlayer.js';
import { playSound } from './sfx.js';
import { SpiritLayer } from './spirit.js';
import { SynthKit } from './synth.js';
import {
  BUSES, type AudioContextLike, type AudioEngine, type AudioEngineOptions, type Bus, type EngineSnapshot,
  type MusicSettings, type PlayOptions, type Scene, type SimEvent, type SoundName, type Speed, type SpiritKind, type VillageState,
} from './types.js';
import { VillageLayer } from './village.js';
import { MAJOR } from './events.js';

const LOOKAHEAD = 0.5;
const SCHEDULE_MS = 120;
/** Identical one-shots closer than this (seconds) are merged rather than stacked. */
const MIN_GAP = 0.12;

interface Graph {
  ctx: AudioContextLike;
  kit: SynthKit;
  buses: Record<Bus, GainNode>;
  ducks: { ambient: GainNode; village: GainNode };
  ambient: AmbientMixer;
  village: VillageLayer;
  spirit: SpiritLayer;
  music: MusicPlayer;
  markers: MarkerPlayer;
}

type Ctor = new () => AudioContextLike;

function findContextCtor(): Ctor | null {
  const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

class Engine implements AudioEngine {
  readonly seed: string;
  readonly spec: MusicSpec;
  private ctx: AudioContextLike | null;
  private owned: boolean;
  private graph: Graph | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private busGain: Record<Bus, number>;
  private busMuted: Record<Bus, boolean>;
  private scene: Scene | null = null;
  private village: VillageState | null = null;
  private music: MusicSettings = { enabled: true, intensity: 'melody' };
  private coalescer = new Coalescer('normal');
  private lastTick = 0;
  private dreaming = false;
  private lastPlayed = new Map<SoundName, number>();

  constructor(opts: AudioEngineOptions) {
    this.seed = opts.seed;
    this.spec = deriveMusic(opts.seed);
    this.ctx = opts.context ?? null;
    this.owned = !opts.context;
    this.busGain = Object.fromEntries(BUSES.map((b) => [b, 1])) as Record<Bus, number>;
    this.busMuted = Object.fromEntries(BUSES.map((b) => [b, false])) as Record<Bus, boolean>;
  }

  private get speed(): Speed { return this.scene?.speed ?? 'normal'; }

  async resume(): Promise<void> {
    if (this.disposed) throw new Error('AudioEngine is disposed');
    if (!this.ctx) {
      const Ctor = findContextCtor();
      if (!Ctor) throw new Error('Web Audio is not available in this environment; pass a context to createAudioEngine');
      this.ctx = new Ctor();
    }
    if (!this.graph) this.build(this.ctx);
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.startScheduler();
  }

  async suspend(): Promise<void> {
    this.stopScheduler();
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
  }

  setBusGain(bus: Bus, gain: number): void {
    this.busGain[bus] = Math.max(0, Math.min(1, gain));
    this.applyBus(bus);
  }

  mute(bus: Bus, muted: boolean): void {
    this.busMuted[bus] = muted;
    this.applyBus(bus);
  }

  setScene(scene: Scene): void {
    const prev = this.scene;
    this.scene = { ...scene };
    if (!prev || prev.speed !== scene.speed) this.playCues(this.coalescer.setSpeed(scene.speed, this.lastTick));
    const g = this.graph;
    if (!g) return;
    g.ambient.apply(ambientRecipe(scene));
    g.village.set(this.village, scene.zoom);
    g.music.setPaused(scene.speed === 'pause');
  }

  setVillage(state: VillageState | null): void {
    this.village = state ? { ...state } : null;
    this.graph?.village.set(this.village, this.scene?.zoom ?? 'village');
  }

  tick(tick: number): void {
    this.lastTick = tick;
    this.playCues(this.coalescer.flush(tick));
    this.graph?.markers.tick(tick, this.speed);
  }

  onEvents(events: SimEvent[], focusedVillage: number | null): void {
    const t = events.length ? Math.max(this.lastTick, events[events.length - 1].t) : this.lastTick;
    this.playCues(this.coalescer.push(events, focusedVillage, t));
  }

  play(sound: SoundName, opts: PlayOptions = {}): void {
    this.playCues([{ sound, count: opts.count ?? 1, focused: opts.focused ?? true, major: MAJOR.has(sound), village: null, tick: this.lastTick }]);
  }

  spirit(kind: SpiritKind, pool: number): void {
    this.graph?.spirit.play(kind, pool);
  }

  setMusic(settings: MusicSettings): void {
    this.music = { ...settings };
    this.graph?.music.set(this.music);
  }

  snapshot(): EngineSnapshot {
    const buses = {} as EngineSnapshot['buses'];
    for (const b of BUSES) buses[b] = { gain: this.busGain[b], muted: this.busMuted[b], effective: this.busMuted[b] ? 0 : this.busGain[b] };
    return {
      started: this.graph !== null,
      contextState: this.ctx?.state ?? 'none',
      seed: this.seed,
      scene: this.scene ? { ...this.scene } : null,
      village: this.village ? { ...this.village } : null,
      music: { ...this.music },
      buses,
      dreaming: this.dreaming,
      coalescer: { pending: this.coalescer.pendingCount, suppressed: this.coalescer.suppressedCount },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopScheduler();
    const g = this.graph;
    if (g) {
      g.ambient.dispose(); g.village.dispose(); g.spirit.dispose(); g.music.dispose();
      try { g.buses.master.disconnect(); } catch { /* */ }
      this.graph = null;
    }
    if (this.owned && this.ctx && this.ctx.state !== 'closed') void this.ctx.close().catch(() => undefined);
    this.ctx = null;
  }

  // ---- internals ----

  private build(ctx: AudioContextLike): void {
    const kit = new SynthKit(ctx, this.seed);
    const buses = {} as Record<Bus, GainNode>;
    for (const b of BUSES) { buses[b] = ctx.createGain(); buses[b].gain.value = this.busMuted[b] ? 1e-4 : this.busGain[b]; }
    buses.master.connect(ctx.destination);
    const ducks = { ambient: ctx.createGain(), village: ctx.createGain() };
    ducks.ambient.gain.value = 1; ducks.village.gain.value = 1;
    buses.ambient.connect(ducks.ambient); ducks.ambient.connect(buses.master);
    buses.village.connect(ducks.village); ducks.village.connect(buses.master);
    for (const b of ['markers', 'events', 'spirit', 'music'] as const) buses[b].connect(buses.master);
    // A small shared room for the pitched, informational sounds.
    const room = kit.room(buses.master, { time: 0.23, feedback: 0.32, tone: 2400, wet: 0.22 });
    buses.markers.connect(room.input); buses.events.connect(room.input); buses.music.connect(room.input);

    const g: Graph = {
      ctx, kit, buses, ducks,
      ambient: new AmbientMixer(kit, buses.ambient),
      village: new VillageLayer(kit, buses.village, this.spec),
      spirit: new SpiritLayer(kit, buses.spirit, (open) => this.onDream(open)),
      music: new MusicPlayer(kit, buses.music, this.spec),
      markers: new MarkerPlayer(kit, buses.markers, this.spec),
    };
    this.graph = g;
    g.music.set(this.music);
    if (this.scene) {
      g.ambient.apply(ambientRecipe(this.scene), 0.5);
      g.music.setPaused(this.scene.speed === 'pause');
    }
    g.village.set(this.village, this.scene?.zoom ?? 'village');
  }

  private applyBus(bus: Bus): void {
    const g = this.graph;
    if (!g) return;
    const eff = this.busMuted[bus] ? 0 : this.busGain[bus];
    g.buses[bus].gain.setTargetAtTime(Math.max(1e-4, eff), g.ctx.currentTime, 0.05);
  }

  private onDream(open: boolean): void {
    this.dreaming = open;
    const g = this.graph;
    if (!g) return;
    const t = g.ctx.currentTime;
    g.ducks.ambient.gain.setTargetAtTime(open ? 0.25 : 1, t, 0.7);
    g.ducks.village.gain.setTargetAtTime(open ? 0.3 : 1, t, 0.7);
  }

  private playCues(cues: Cue[]): void {
    const g = this.graph;
    if (!g || cues.length === 0) return;
    const now = g.ctx.currentTime;
    for (const c of cues) {
      const last = this.lastPlayed.get(c.sound);
      if (last !== undefined && now - last < MIN_GAP) continue;
      this.lastPlayed.set(c.sound, now);
      playSound(g.kit, g.buses.events, this.spec, { sound: c.sound, count: c.count, focused: c.focused });
    }
  }

  private startScheduler(): void {
    if (this.timer) return;
    const run = () => {
      const g = this.graph;
      if (!g) return;
      const now = g.ctx.currentTime, until = now + LOOKAHEAD;
      g.ambient.schedule(now, until);
      g.village.schedule(now, until);
      g.spirit.schedule(now, until);
      g.music.schedule(now, until);
    };
    run();
    this.timer = setInterval(run, SCHEDULE_MS);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private stopScheduler(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}

/** Create an engine. Nothing is allocated on the audio side until `resume()`. */
export function createAudioEngine(opts: AudioEngineOptions): AudioEngine & { readonly spec: MusicSpec } {
  return new Engine(opts);
}
