/**
 * SimHost: the sim loop, chief scheduler, journals, auto-pause, dreams and the replay log, as a plain class.
 * The worker wraps it with postMessage; tests drive it directly with a fake timer.
 */
import { Rng, Sim, WEEKS_PER_YEAR, seasonIndex, type Event, type Input, type World } from '@wind-spirit/sim';
import { generateWorld, CAP_NAMES } from '@wind-spirit/gen';
import { POLICIES, hostAnswer } from '@wind-spirit/harness';
import { ChiefScheduler, Conversation, narrate, type JournalEntry, type LlmClient, type Speed } from '@wind-spirit/agents';
import {
  DEFAULT_SETTINGS, SPEED_MS, type AttentionEvent, type Frame, type FromWorker, type GenOpts, type LoggedInput, type NarrativeRequest, type Settings, type StaticMap, type VillageDetail,
} from './protocol.ts';
import { buildFrame, buildStaticMap, buildVillageDetail, feedVillages, historyWorthy, touches } from './views.ts';
export { touches };

export interface HostIO {
  post(msg: FromWorker): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  client: LlmClient;
}

const HISTORY_MAX = 200;
/** Weeks the sim may run on while a model decision is outstanding before it waits ("throttled by chief throughput"). */
export const THINK_GRACE = 2;
const URGENT = new Set(['raided', 'famine', 'succession', 'spirit', 'founded', 'visitor']);

export class SimHost {
  sim?: Sim;
  sched?: ChiefScheduler;
  speed: Speed = 'pause';
  settings: Settings = DEFAULT_SETTINGS;
  private pending: Input[] = [];
  private timer: unknown;
  private history = new Map<number, Event[]>();
  private famineSeen = new Map<number, number>();
  private memRef = new Map<number, string[]>();
  private inboxRef = new Map<number, string[]>();
  private lastSnapshotTick = -1;
  private mem: Record<number, Record<string, number>> = {};
  private conv?: { c: Conversation; village: number };
  private thinking = new Map<number, number>();      // village -> tick the model call started (only model villages)
  private thinkSeq = 0; private thinkingKeys = new Map<number, number>();
  private waitingPosted = '';
  constructor(private io: HostIO) {}

  get world(): World { return this.sim!.world; }

  // ---------- lifecycle ----------

  init(seed: string, opts: GenOpts = {}): void {
    const w = generateWorld({ seed, width: opts.width ?? 64, height: opts.height ?? 64, villages: opts.villages ?? 4, startPop: opts.startPop ?? 20 });
    this.start(new Sim(w));
    this.io.post({ type: 'loaded', tick: w.tick, frame: this.frame() });
  }

  /** Restore a snapshot and replay the logged inputs after it. Replay never calls a model. */
  load(snapshot: string, inputsAfter: LoggedInput[][]): void {
    const sim = Sim.fromSnapshot(snapshot);
    this.stopTimer(); this.sim = sim; this.sched = undefined; this.history.clear(); this.famineSeen.clear();
    for (const inputs of inputsAfter) {
      for (const i of inputs) { if (i.type === 'ChiefMemory') this.applyMemory(i); else sim.queue(i); }
      const events = sim.tick();
      this.record(events);
    }
    this.start(sim);
    this.io.post({ type: 'loaded', tick: sim.world.tick, frame: this.frame() });
  }

  private start(sim: Sim): void {
    this.stopTimer();
    this.sim = sim; this.pending = []; this.speed = 'pause'; this.conv = undefined;
    this.lastSnapshotTick = -1; this.mem = {}; this.thinking.clear(); this.thinkingKeys.clear(); this.waitingPosted = '';
    this.memRef.clear(); this.inboxRef.clear();
    for (const v of sim.world.villages) { this.memRef.set(v.id, v.memory); this.inboxRef.set(v.id, v.inbox); }
    const rng = Rng.fromSeed(sim.world.seed, 'work');
    this.sched = new ChiefScheduler({
      client: this.io.client, capNames: CAP_NAMES, maxInFlight: 3, yearlyBudget: 400_000,
      modelVillages: id => this.usesModel(id),
      speed: () => this.speed,
      fallback: {
        decide: (w, v, reason) => POLICIES.sensible({ w, v, reason, rng, mem: (this.mem[v.id] ??= {}) }),
        host: (w, v, m, g) => hostAnswer({ w, v, reason: 'visitor', rng, mem: (this.mem[v.id] ??= {}) }, m, g),
      },
      onJournal: e => this.io.post({ type: 'journal', entry: e }),
      onError: (err, village) => this.io.post({ type: 'error', message: (err as Error)?.message ?? String(err), village }),
    });
    this.io.post({ type: 'map', map: this.staticMap() });
  }

  usesModel(id: number): boolean {
    const m = this.settings.modelVillages;
    return m === 'all' || (m === 'focused' && this.settings.focused.includes(id));
  }
  setSettings(s: Settings): void { this.settings = s; }

  // ---------- time ----------

  setSpeed(speed: Speed): void {
    this.speed = speed; this.stopTimer();
    if (speed === 'pause') this.postSnapshot('pause');
    if (SPEED_MS[speed] > 0) this.arm();
    this.io.post({ type: 'speed', speed });
  }
  private arm(ms = SPEED_MS[this.speed]): void {
    if (SPEED_MS[this.speed] <= 0) return;
    this.timer = this.io.setTimer(() => {
      this.timer = undefined;
      if (this.throttled()) { this.postWaiting(); this.arm(Math.min(100, SPEED_MS[this.speed])); return; }
      this.postWaiting();
      this.tick();
      if (SPEED_MS[this.speed] > 0) this.arm();
    }, ms);
  }
  /** True while a model chief has been deliberating for more than the grace period. The sim never blocks on a chief, but the clock does. */
  throttled(): boolean {
    const t = this.sim?.world.tick ?? 0;
    for (const since of this.thinking.values()) if (t - since >= THINK_GRACE) return true;
    return false;
  }
  waitingFor(): number[] { const t = this.sim?.world.tick ?? 0; return [...this.thinking.entries()].filter(([, since]) => t - since >= THINK_GRACE).map(([v]) => v); }
  private postWaiting(): void {
    const v = this.waitingFor(); const key = v.join(',');
    if (key !== this.waitingPosted) { this.waitingPosted = key; this.io.post({ type: 'waiting', villages: v }); }
  }
  /** Mirror of the scheduler's decision order so promises can be matched to villages (UI only). */
  private expectedCalls(events: Event[]): number[] {
    const w = this.world; const out: number[] = []; const digestOnly = this.speed === 'fast' || this.speed === 'veryfast';
    for (const e of events) {
      if (e.type === 'VisitorArrived') { if (w.villages[e.village]?.alive) out.push(e.village); continue; }
      if (e.type !== 'DeliberationRequested' || !w.villages[e.village]?.alive) continue;
      const reasons = e.reason.split(','); if (digestOnly && !reasons.some(r => URGENT.has(r)) && !reasons.includes('season')) continue;
      out.push(e.village);
    }
    return out;
  }
  private track(events: Event[], started: Promise<void>[], tick: number): void {
    const villages = this.expectedCalls(events); if (villages.length !== started.length) return;
    started.forEach((p, i) => {
      const v = villages[i]; if (!this.usesModel(v) || this.thinking.has(v)) return;
      const key = ++this.thinkSeq; this.thinking.set(v, tick); this.thinkingKeys.set(v, key);
      p.finally(() => { if (this.thinkingKeys.get(v) === key) { this.thinking.delete(v); this.thinkingKeys.delete(v); } }).catch(() => undefined);
    });
  }
  private stopTimer(): void { if (this.timer !== undefined) { this.io.clearTimer(this.timer); this.timer = undefined; } }
  step(): void { if (this.speed !== 'pause' && this.speed !== 'step') this.setSpeed('pause'); this.tick(); }

  queue(input: Input): void { this.pending.push(input); }

  /** One week. Logs the inputs applied this tick, posts the frame, checks attention events. */
  tick(): Event[] {
    const sim = this.sim; if (!sim || !this.sched) return [];
    const w = sim.world; const t = w.tick;
    if (t % WEEKS_PER_YEAR === 0 && t !== this.lastSnapshotTick) this.postSnapshot('yearly');
    const inputs: LoggedInput[] = [...this.pending, ...this.sched.drain()]; this.pending = [];
    for (const v of w.villages) {
      const mr = this.memRef.get(v.id), ir = this.inboxRef.get(v.id);
      if (mr === undefined) { this.memRef.set(v.id, v.memory); this.inboxRef.set(v.id, v.inbox); continue; }
      if (mr !== v.memory || ir !== v.inbox) { inputs.push({ type: 'ChiefMemory', village: v.id, memory: [...v.memory], inbox: [...v.inbox] }); this.memRef.set(v.id, v.memory); this.inboxRef.set(v.id, v.inbox); }
    }
    for (const i of inputs) if (i.type !== 'ChiefMemory') sim.queue(i);
    const events = sim.tick();
    this.record(events);
    const started = this.sched.onEvents(w, events);
    for (const p of started) p.catch(() => { /* reported via onError */ });
    this.track(events, started, t);
    const frame = this.frame();
    this.io.post({ type: 'tick', tick: t, events, frame, inputs });
    const attention = this.attention(events);
    if (attention) { this.setSpeed('pause'); this.io.post({ type: 'attention', tick: t, event: attention }); }
    return events;
  }

  private applyMemory(i: Extract<LoggedInput, { type: 'ChiefMemory' }>): void {
    const v = this.sim!.world.villages[i.village]; if (!v) return;
    v.memory = [...i.memory]; v.inbox = [...i.inbox];
  }

  private record(events: Event[]): void {
    for (const e of events) { if (!historyWorthy(e)) continue; for (const id of feedVillages(this.sim!.world, e)) this.push(id, e); }
  }
  private push(village: number, e: Event): void {
    let h = this.history.get(village); if (!h) { h = []; this.history.set(village, h); }
    h.push(e); if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
  }

  private attention(events: Event[]): Event | undefined {
    const ap = this.settings.autoPause;
    for (const e of events) {
      const k = e.type as AttentionEvent;
      if (!(k in ap) || !ap[k]) continue;
      if (e.type === 'Famine') { const s = seasonIndex(e.t); if (this.famineSeen.get(e.village) === s) continue; this.famineSeen.set(e.village, s); }
      return e;
    }
    return undefined;
  }

  // ---------- views ----------

  postSnapshot(reason: string): void {
    if (!this.sim) return;
    const t = this.sim.world.tick; if (t === this.lastSnapshotTick) return;
    this.lastSnapshotTick = t;
    this.io.post({ type: 'snapshot', tick: t, json: this.sim.snapshot(), reason });
  }
  hash(): string { return this.sim!.hash(); }

  frame(): Frame { return buildFrame(this.world); }
  staticMap(): StaticMap { return buildStaticMap(this.world); }
  villageDetail(id: number): VillageDetail | undefined { return buildVillageDetail(this.world, id, this.history.get(id) ?? []); }

  /** Narrative synthesis over a span of a village's history (events and journals come from the store). */
  async narrate(r: NarrativeRequest): Promise<string> {
    const w = this.world; const v = w.villages[r.village]; if (!v) throw new Error('no such village');
    return narrate(w, v, r.events, r.journals as JournalEntry[], { client: this.io.client, capNames: CAP_NAMES, fromTick: r.fromTick, toTick: r.toTick, style: r.style });
  }

  // ---------- dreams ----------

  dreamStart(village: number): void {
    const w = this.world; const v = w.villages[village]; if (!v?.alive) return;
    if (this.speed !== 'pause') this.setSpeed('pause');
    const c = new Conversation(w, v, { client: this.io.client, capNames: CAP_NAMES, onError: e => this.io.post({ type: 'error', message: (e as Error)?.message ?? String(e), village }) });
    proseOnly(c);
    this.conv = { c, village };
  }
  async dreamSend(text: string): Promise<void> {
    const c = this.conv; if (!c) return;
    try {
      // Stream prose as it comes; if the chief slips into decision JSON anyway, hold the chunks and show the spoken part at the end.
      let buf = ''; let held = false;
      const reply = await c.c.send(text, chunk => { buf += chunk; if (held) return; if (looksLikeJson(buf)) { held = true; return; } this.io.post({ type: 'dreamChunk', text: chunk }); });
      this.io.post({ type: 'dreamReply', text: spokenPart(reply) });
    } catch (e) { this.io.post({ type: 'error', message: `The chief did not answer: ${(e as Error)?.message ?? e}`, village: c.village }); this.io.post({ type: 'dreamReply', text: '' }); }
  }
  async dreamClose(): Promise<void> {
    const c = this.conv; this.conv = undefined; if (!c) return;
    const { claims, memoryNotes } = await c.c.close();
    const v = this.world.villages[c.village];
    if (v) { v.memory = [...memoryNotes]; }
    if (claims.length) this.pending.push({ type: 'ClaimsMade', village: c.village, claims });
    this.io.post({ type: 'dreamClosed', claims: claims.map(x => ({ text: x.text, due: x.due })), memoryNotes });
  }
}

/**
 * Conversation reuses the decision prompt, whose system text ends with "Answer only with the JSON asked for" and whose
 * state text ends with the order menu and "Answer with JSON: {...}". The capable model often obeys those over the one-line
 * "speak" instruction. Until packages/agents builds a prose-only prompt, rewrite those two sections here.
 */
function proseOnly(c: Conversation): void {
  const priv = c as unknown as { system: string; state: string };
  if (typeof priv.system === 'string') {
    priv.system = priv.system.replace('Decide standing orders for your adults. Orders persist until you change them. Answer only with the JSON asked for.', 'Tonight you decide nothing; you only talk.')
      + '\n\nThis is a conversation, not a decision. Answer in plain spoken words only, two to five sentences, in your own voice. Never write JSON, lists, headings or field names.';
  }
  if (typeof priv.state === 'string') { const cut = priv.state.indexOf('# Orders you may give'); if (cut > 0) priv.state = priv.state.slice(0, cut).trimEnd(); }
}
function looksLikeJson(s: string): boolean { const t = s.trimStart(); return t.startsWith('{') || t.startsWith('```'); }
/** The chief's spoken words out of a reply that came back as decision JSON; the reply itself when it is prose. */
export function spokenPart(reply: string): string {
  if (!looksLikeJson(reply)) return reply;
  const raw = reply.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '');
  try { const j = JSON.parse(raw) as Record<string, unknown>; const said = j.replyToSpirit ?? j.reply ?? j.journal ?? j.text; if (typeof said === 'string' && said.trim()) return said.trim(); } catch { /* not JSON after all */ }
  const m = raw.match(/"replyToSpirit"\s*:\s*"((?:[^"\\]|\\.)*)"/); if (m) return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
  return reply;
}
