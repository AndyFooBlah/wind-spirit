/**
 * SimHost: the sim loop, chief scheduler, journals, auto-pause, dreams and the replay log, as a plain class.
 * The worker wraps it with postMessage; tests drive it directly with a fake timer.
 */
import {
  P, Rng, Sim, WEEKS_PER_SEASON, WEEKS_PER_YEAR, commodityById, popCounts, recipeById, seasonIndex, seasonOf, storesWeeks, yearOf,
  type Event, type Input, type Village, type World,
} from '@wind-spirit/sim';
import { generateWorld, CAP_NAMES } from '@wind-spirit/gen';
import { POLICIES, hostAnswer } from '@wind-spirit/harness';
import { ChiefScheduler, Conversation, buildView, renderChronicle, renderEvents, SEASONS, type LlmClient, type Speed } from '@wind-spirit/agents';
import {
  DEFAULT_SETTINGS, SPEED_MS, type AttentionEvent, type Frame, type FromWorker, type GenOpts, type LoggedInput, type Settings, type StaticMap, type VillageDetail,
} from './protocol.ts';

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

/** Does an event touch this village? (same rule the scheduler uses, minus the weather broadcast) */
export function touches(e: Event, village: number): boolean {
  const any = e as unknown as Record<string, unknown>;
  return any.village === village || any.parent === village || any.attacker === village || any.defender === village || any.guest === village || any.to === village || any.from === village;
}

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
    for (const e of events) {
      if (e.type === 'WeekSummary' || e.type === 'DeliberationRequested' || e.type === 'PathFormed') continue;
      if (e.type === 'WeatherRolled') { if (e.season === seasonIndex(e.t)) for (const v of this.sim!.world.villages) if (v.alive) this.push(v.id, e); continue; }
      for (const v of this.sim!.world.villages) if (touches(e, v.id)) this.push(v.id, e);
    }
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

  frame(): Frame {
    const w = this.world; const cur = seasonIndex(w.tick);
    const paths: number[] = [], roads: number[] = [];
    for (let i = 0; i < w.tiles.length; i++) { const t = w.tiles[i]; if (t.road) roads.push(i); else if (t.trodden >= P.pathAt) paths.push(i); }
    return {
      tick: w.tick, year: yearOf(w.tick), season: seasonOf(w.tick), week: (w.tick % WEEKS_PER_SEASON) + 1,
      villages: w.villages.map(v => ({ id: v.id, name: v.name, tile: v.tile, alive: v.alive, pop: popCounts(v, w.tick), happiness: v.happiness, trust: v.trust, foodWeeks: storesWeeks(w, v), hungryWeek: v.hungryWeek, capabilities: v.capabilities.length })),
      parties: w.parties.map(p => ({ id: p.id, kind: p.kind, home: p.home, at: p.at, boat: p.boat, target: p.target, targetVillage: p.targetVillage, returning: p.returning, size: p.members.length, waiting: p.waiting })),
      paths, roads,
      breath: w.breath / 1000,
      rolls: w.rolls.slice(cur, cur + 5), rollSeasons: [0, 1, 2, 3, 4].map(i => cur + i), wind: w.wind.slice(cur, cur + 5),
      storms: [...w.storms],
    };
  }

  staticMap(): StaticMap {
    const w = this.world;
    return {
      seed: w.seed, width: w.width, height: w.height,
      terrain: w.tiles.map(t => t.terrain), ford: w.tiles.map(t => t.ford), extra: w.tiles.map(t => Object.keys(t.extra)),
      names: { commodities: Object.fromEntries(w.commodities.map(c => [c.id, c.name])), recipes: Object.fromEntries(w.recipes.map(r => [r.id, r.name])), capabilities: { ...CAP_NAMES } },
    };
  }

  villageDetail(id: number): VillageDetail | undefined {
    const w = this.world; const v = w.villages[id]; if (!v) return undefined;
    const cname = (c: string) => commodityById(w, c)?.name ?? c;
    const rname = (r: string) => recipeById(w, r)?.name ?? r;
    const capName = (c: string) => (CAP_NAMES as Record<string, string>)[c] ?? c;
    const view = buildView(w, v, { events: [], capNames: CAP_NAMES, pendingSpirit: [...v.inbox], chronicle: renderChronicle(w, v) });
    const { names: _names, ...rest } = view; void _names;
    const feed = this.feed(w, v, cname, rname, capName);
    const plots = v.plots.map(p => ({ kind: p.kind, planted: p.planted, recipe: p.recipe ? rname(p.recipe) : '', crop: p.crop ? cname(p.crop) : '', building: p.kind !== 'structure' && p.recipe !== '' }));
    return { id, tick: w.tick, alive: v.alive, view: rest, plots, chronicle: [...v.chronicle], feed, inbox: [...v.inbox], chiefId: v.chief };
  }

  /** The history feed: this village's last events grouped by season and rendered as sentences. */
  private feed(w: World, v: Village, cname: (c: string) => string, rname: (r: string) => string, capName: (c: string) => string) {
    const h = this.history.get(v.id) ?? [];
    const groups: { when: string; tick: number; events: Event[] }[] = [];
    for (const e of h) {
      const s = seasonIndex(e.t); const last = groups[groups.length - 1];
      if (last && seasonIndex(last.tick) === s) last.events.push(e);
      else groups.push({ when: `Year ${yearOf(e.t)}, ${SEASONS[seasonOf(e.t)]}`, tick: e.t, events: [e] });
    }
    return groups.map(g => ({ when: g.when, tick: g.tick, lines: renderEvents(w, v, g.events, cname, rname, capName) })).filter(g => g.lines.length).reverse();
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
