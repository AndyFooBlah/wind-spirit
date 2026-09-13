/**
 * The chief scheduler: turns DeliberationRequested and VisitorArrived events into model calls, applies cadence,
 * coalescing, a per-village token budget, and a scripted fallback. Never blocks the sim: decisions come back as inputs.
 */
import { WEEKS_PER_YEAR, cargoOf, commodityById, recipeById, type Event, type Input, type Order, type Village, type World, type Mandate, type HostAnswer } from '@wind-spirit/sim';
import { buildView, type VillageView } from './view.js';

import { statePrompt, systemPrompt, visitorPrompt } from './prompt.js';
import { DECISION_SCHEMA, HOST_SCHEMA, type ChiefDecisionJson, type HostDecisionJson } from './schema.js';
import { parseDecision, parseHostDecision } from './parse.js';
import { renderChronicle } from './conversation.js';
import { TIERS, classify, type Tier, type TierName } from './tiers.js';
import type { LlmClient } from './client.js';

export type Speed = 'pause' | 'step' | 'slow' | 'normal' | 'fast' | 'veryfast';
export interface JournalEntry { tick: number; requestedAt: number; village: number; reason: string; text: string; source: 'model' | 'habit'; dropped?: string[]; }
export interface Fallback { decide(w: World, v: Village, reason: string): Order[]; host(w: World, v: Village, mandate: Mandate, guest: Village): HostAnswer; }

export interface SchedulerOptions {
  client: LlmClient; fallback: Fallback; capNames: Record<string, string>;
  /** tokens per village per game-year before falling back to habit for the rest of the year */
  yearlyBudget?: number; maxInFlight?: number; onJournal?: (e: JournalEntry) => void; onError?: (err: unknown, village: number) => void;
  /** which villages the model runs; others use the fallback (for cost control and tests) */
  modelVillages?: (id: number) => boolean;
  speed?: () => Speed;
  /** how much model to spend; see tiers.ts */
  tier?: () => TierName;
}

const URGENT = new Set(['raided', 'famine', 'succession', 'spirit', 'founded', 'visitor']);

export class ChiefScheduler {
  private inFlight = new Set<number>();
  private pendingReasons = new Map<number, Set<string>>();
  private spent = new Map<string, number>();          // `${village}:${year}` -> tokens
  private lastDecided = new Map<number, number>();
  private eventsSince = new Map<number, Event[]>();
  private queue: Input[] = [];
  readonly journals: JournalEntry[] = [];
  constructor(private o: SchedulerOptions) {}

  /** Inputs ready to be queued into the sim; drain each tick. */
  drain(): Input[] { const q = this.queue; this.queue = []; return q; }

  /** Feed this tick's events. Returns promises for any model calls started (tests await them). */
  onEvents(w: World, events: Event[]): Promise<void>[] {
    const started: Promise<void>[] = [];
    for (const v of w.villages) if (v.alive) (this.eventsSince.get(v.id) ?? this.eventsSince.set(v.id, []).get(v.id)!).push(...events.filter(e => touches(e, v.id)));
    const speed = this.o.speed?.() ?? 'normal';
    for (const e of events) {
      if (e.type === 'VisitorArrived') { const host = w.villages[e.village]; if (host?.alive) started.push(this.visitor(w, host, e.party, e.from, e.mandate)); continue; }
      if (e.type !== 'DeliberationRequested') continue;
      const v = w.villages[e.village]; if (!v?.alive) continue;
      const reasons = e.reason.split(',');
      const urgent = reasons.some(r => URGENT.has(r));
      const digestOnly = speed === 'fast' || speed === 'veryfast' || this.tier().digestOnly;
      if (digestOnly && !urgent && !reasons.includes('season')) { const s = this.pendingReasons.get(v.id) ?? new Set(); reasons.forEach(r => s.add(r)); this.pendingReasons.set(v.id, s); continue; }
      const all = new Set([...(this.pendingReasons.get(v.id) ?? []), ...reasons]); this.pendingReasons.delete(v.id);
      started.push(this.deliberate(w, v, [...all].join(', ')));
    }
    return started;
  }

  private key(v: Village, w: World): string { return `${v.id}:${Math.floor(w.tick / WEEKS_PER_YEAR)}`; }
  private overBudget(v: Village, w: World): boolean { return (this.spent.get(this.key(v, w)) ?? 0) >= (this.o.yearlyBudget ?? 200_000); }
  private tier(): Tier { return TIERS[this.o.tier?.() ?? 'standard']; }
  private useModel(v: Village, w: World): boolean { return (this.o.modelVillages?.(v.id) ?? true) && !this.overBudget(v, w) && this.inFlight.size < (this.o.maxInFlight ?? 4); }

  private habit(w: World, v: Village, reason: string, requestedAt: number, note: string): void {
    const orders = this.o.fallback.decide(w, v, reason);
    this.queue.push({ type: 'ChiefDecided', village: v.id, orders, requestedAt });
    this.journal({ tick: w.tick, requestedAt, village: v.id, reason, text: note, source: 'habit' });
    this.eventsSince.set(v.id, []);
  }

  private journal(e: JournalEntry): void { this.journals.push(e); this.o.onJournal?.(e); }

  async deliberate(w: World, v: Village, reason: string): Promise<void> {
    const requestedAt = w.tick;
    if (this.inFlight.has(v.id)) { const s = this.pendingReasons.get(v.id) ?? new Set(); reason.split(', ').forEach(r => s.add(r)); this.pendingReasons.set(v.id, s); return; }
    const tier = this.tier(); const dclass = classify(reason, { sites: 0, pop: v.people.length, hungry: v.hungryWeek > 0 });
    const modelClass = dclass === 'impactful' ? tier.impactful : tier.routine;
    if (modelClass === 'habit' || !this.useModel(v, w)) { this.habit(w, v, reason, requestedAt, this.overBudget(v, w) ? 'The chief acted on habit this season; the year had used up their attention.' : 'The chief acted on habit.'); return; }
    this.inFlight.add(v.id);
    // provisional orders: the village keeps working by habit while the chief thinks; the model's decision replaces them
    if (!v.orders.length || reason.includes('season')) this.queue.push({ type: 'ChiefDecided', village: v.id, orders: this.o.fallback.decide(w, v, reason), requestedAt });
    try {
      const view = buildView(w, v, { events: this.eventsSince.get(v.id) ?? [], capNames: this.o.capNames, pendingSpirit: [...v.inbox], chronicle: renderChronicle(w, v) });
      const decision = await this.callDecision(view, reason, v, w, classify(reason, { sites: view.sites.length, pop: v.people.length, hungry: v.hungryWeek > 0 }) === 'impactful' ? (tier.impactful === 'habit' ? 'routine' : tier.impactful) : (tier.routine === 'habit' ? 'routine' : tier.routine));
      if (!decision) { this.habit(w, v, reason, requestedAt, 'The chief could not make up their mind and fell back on habit.'); return; }
      const parsed = parseDecision(view, decision);
      const overruled = foodFloor(parsed.orders, view);
      if (overruled) parsed.dropped.push(overruled);
      this.queue.push({ type: 'ChiefDecided', village: v.id, orders: parsed.orders, requestedAt, memoryNotes: parsed.memoryNotes, clearInbox: true });
      if (parsed.verdicts.length) this.queue.push({ type: 'ChiefJudged', village: v.id, verdicts: parsed.verdicts });
      if (parsed.replyToSpirit) this.queue.push({ type: 'Prayer', village: v.id, text: parsed.replyToSpirit });
      this.journal({ tick: w.tick, requestedAt, village: v.id, reason, text: parsed.journal, source: 'model', dropped: parsed.dropped });
      if (parsed.replyToSpirit) this.onPrayer?.(v.id, parsed.replyToSpirit);
      this.eventsSince.set(v.id, []);
    } catch (err) { this.o.onError?.(err, v.id); this.habit(w, v, reason, requestedAt, 'The chief acted on habit; the spirit world was silent.'); }
    finally { this.inFlight.delete(v.id); const pend = this.pendingReasons.get(v.id); if (pend && pend.size) { this.pendingReasons.delete(v.id); void this.deliberate(w, v, [...pend].join(', ')); } }
  }

  onPrayer?: (village: number, text: string) => void;

  private async callDecision(view: VillageView, reason: string, v: Village, w: World, modelClass: 'cheapest' | 'cheap' | 'routine' | 'capable' | 'premium' = 'routine'): Promise<ChiefDecisionJson | undefined> {
    const system = systemPrompt(view); const user = statePrompt(view, reason);
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.o.client.generate({ class: modelClass, system, messages: [{ role: 'user', text: user }], schema: DECISION_SCHEMA, maxOutputTokens: 6000, temperature: 0.7, thinkingLevel: 'low', cacheKey: `chief:${w.seed}:${v.id}` });
      this.spent.set(this.key(v, w), (this.spent.get(this.key(v, w)) ?? 0) + res.usage.input + res.usage.output);
      const json = (res.json ?? safeJson(res.text)) as ChiefDecisionJson | undefined;
      if (json && Array.isArray(json.orders)) return json;
    }
    return undefined;
  }

  async visitor(w: World, host: Village, party: number, from: number, mandate: Mandate): Promise<void> {
    const guest = w.villages[from]; const requestedAt = w.tick;
    if (!this.useModel(host, w)) { this.queue.push({ type: 'HostDecided', village: host.id, party, answer: this.o.fallback.host(w, host, mandate, guest), requestedAt }); return; }
    try {
      const view = buildView(w, host, { events: this.eventsSince.get(host.id) ?? [], capNames: this.o.capNames, chronicle: renderChronicle(w, host) });
      const p = w.parties.find(x => x.id === party); const m: Mandate = p ? { ...mandate, offer: cargoOf(p) } : mandate;
      const user = visitorPrompt(view, guest?.name ?? 'strangers', m, id => commodityById(w, id)?.name ?? id, id => recipeById(w, id)?.name ?? id);
      const tier = this.tier(); const hostClass = tier.impactful === 'habit' ? 'capable' : tier.impactful;
      const res = await this.o.client.generate({ class: hostClass, system: systemPrompt(view), messages: [{ role: 'user', text: user }], schema: HOST_SCHEMA, maxOutputTokens: 4000, temperature: 0.7, thinkingLevel: 'low' });
      this.spent.set(this.key(host, w), (this.spent.get(this.key(host, w)) ?? 0) + res.usage.input + res.usage.output);
      const json = (res.json ?? safeJson(res.text)) as HostDecisionJson | undefined;
      const parsed = json ? parseHostDecision(view, json) : { answer: this.o.fallback.host(w, host, mandate, guest), journal: 'The chief judged the visitors by habit.', dropped: [] as string[] };
      this.queue.push({ type: 'HostDecided', village: host.id, party, answer: parsed.answer, requestedAt });
      this.journal({ tick: w.tick, requestedAt, village: host.id, reason: 'visitors', text: parsed.journal, source: json ? 'model' : 'habit', dropped: parsed.dropped });
    } catch (err) { this.o.onError?.(err, host.id); this.queue.push({ type: 'HostDecided', village: host.id, party, answer: this.o.fallback.host(w, host, mandate, guest), requestedAt }); }
  }

  /** Tokens spent per village-year, for cost reporting. */
  spending(): Record<string, number> { return Object.fromEntries(this.spent); }
}

/**
 * The village will not starve on an order: if stores do not cover the season and the decision leaves too few hands on food,
 * pull workers from non-food tasks onto foraging (or hunting/fishing in winter) until at least a third are on food.
 * Returns a note for the journal when it intervened.
 */
export function foodFloor(orders: Order[], view: VillageView): string | undefined {
  if (view.foodWeeks >= 13) return undefined;
  const isFood = (t: Order['task']) => t === 'forage' || t === 'hunt' || t === 'fish';
  const total = orders.filter(o => o.task !== 'colonize').reduce((a, o) => a + o.workers, 0); if (total === 0) return undefined;
  const floor = Math.ceil(Math.max(0, view.people.workersFree) * 0.34);
  let food = orders.filter(o => isFood(o.task)).reduce((a, o) => a + o.workers, 0);
  if (food >= floor) return undefined;
  let need = floor - food;
  for (const o of orders) { if (need <= 0) break; if (isFood(o.task) || o.task === 'farm' || o.task === 'colonize') continue; const take = Math.min(o.workers, need); o.workers -= take; need -= take; }
  const moved = floor - food - need; if (moved <= 0) return undefined;
  const best = view.yields.fish >= view.yields.forage && view.yields.fish >= view.yields.hunt ? 'fish' : view.yields.hunt > view.yields.forage ? 'hunt' : 'forage';
  const existing = orders.find(o => o.task === best); if (existing) existing.workers += moved; else orders.push({ task: best, workers: moved, params: {}, since: 0 });
  for (let i = orders.length - 1; i >= 0; i--) if (orders[i].workers === 0 && orders[i].task !== 'colonize') orders.splice(i, 1);
  return `the village overruled the chief: ${moved} hands sent to ${best} so the season is fed`;
}

function touches(e: Event, village: number): boolean {
  const any = e as unknown as Record<string, unknown>;
  return any.village === village || any.parent === village || any.attacker === village || any.defender === village || any.guest === village || any.to === village || any.from === village || e.type === 'WeatherRolled';
}
function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { const m = s.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch { return undefined; } } return undefined; } }
