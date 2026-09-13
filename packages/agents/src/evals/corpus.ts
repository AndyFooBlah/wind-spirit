/**
 * Eval corpus: ~100 situations a chief must handle, sampled from real scripted runs and constructed on top of them.
 * Each case stores the village view (what the prompt is built from) plus the facts the checkers need, so evals run
 * without the sim. Categories: routine, crisis, visitor, expansion, spirit, dream.
 */
import { Rng, Sim, WEEKS_PER_YEAR, popCounts, seasonOf, storesWeeks, addStore, storeQty, relation, type Event, type Input, type Mandate, type Village, type World } from '@wind-spirit/sim';
import { generateWorld, CAP_NAMES } from '@wind-spirit/gen';
import { POLICIES, hostAnswer } from '@wind-spirit/harness';
import { buildView, type VillageView } from '../view.js';
import { renderChronicle, type Turn } from '../conversation.js';

export type Category = 'routine' | 'crisis' | 'visitor' | 'expansion' | 'spirit' | 'dream' | 'firstspring';
export interface Facts { pop: number; adults: number; free: number; season: number; year: number; foodWeeks: number; hungry: number; hardship: number; trust: number; sites: number; knownVillages: number; canInvest: boolean; storesGrain: number; }
export interface EvalCase {
  id: string; category: Category; kind: 'decision' | 'host' | 'dream';
  seed: string; tick: number; village: number; reason: string;
  view: VillageView; facts: Facts;
  /** what a good answer looks like, category-specific */
  expect: Record<string, string | number | boolean | undefined>;
  mandate?: Mandate; guestName?: string; guestSize?: number;
  spiritMessage?: string; dreamTurns?: Turn[]; dreamLine?: string;
  /** the scripted policy's own answer, as the habit baseline */
  habit?: unknown;
}

const SAMPLE_TICKS = [110, 270, 430, 600, 810, 1040, 1300, 1570, 1830, 2100, 2340, 2610, 2870, 3120, 3400, 3650, 3900, 4160, 4420, 4680, 4940, 5200];

function facts(w: World, v: Village, view: VillageView): Facts {
  const c = popCounts(v, w.tick);
  return { pop: c.total, adults: c.adults, free: Math.max(0, c.adults - 1), season: seasonOf(w.tick), year: Math.floor(w.tick / WEEKS_PER_YEAR), foodWeeks: storesWeeks(w, v), hungry: v.hungryWeek, hardship: v.hardship, trust: v.trust, sites: view.sites.length, knownVillages: view.villages.length, canInvest: view.recipes.some(r => r.canMakeNow && !r.held), storesGrain: storeQty(v, 'grain') };
}

export function buildCorpus(seeds = ['eval-a', 'eval-b', 'eval-c']): EvalCase[] {
  const cases: EvalCase[] = [];
  for (const seed of seeds) {
    const w = generateWorld({ seed }); const sim = new Sim(w); const rng = Rng.fromSeed(seed, 'work'); const mem: Record<number, Record<string, number>> = {};
    const recent: Event[] = []; const ticks = new Set(SAMPLE_TICKS); const crisisSeen = new Set<string>();
    for (let t = 0; t < 5201; t++) {
      const ev = sim.tick(); recent.push(...ev); if (recent.length > 3000) recent.splice(0, recent.length - 3000);
      // the very first spring: fresh village, a few weeks of food, nothing built. Missed by the first corpus, found in play.
      if (t === 0) for (const v0 of w.villages.slice(0, 2)) { const view0 = mk(w, v0, ev, 'season'); cases.push({ id: `${seed}-firstspring-${v0.id}`, category: 'firstspring', kind: 'decision', seed, tick: t, village: v0.id, reason: 'season', view: view0, facts: facts(w, v0, view0), expect: { foodShare: 0.34 }, habit: POLICIES.sensible({ w, v: v0, reason: 'season', rng, mem: (mem[v0.id] ??= {}) }) }); }
      const q: Input[] = [];
      for (const e of ev) {
        if (e.type === 'DeliberationRequested') { const v = w.villages[e.village]; if (v.alive) q.push({ type: 'ChiefDecided', village: v.id, orders: POLICIES.sensible({ w, v, reason: e.reason, rng, mem: (mem[v.id] ??= {}) }), requestedAt: e.t }); }
        if (e.type === 'VisitorArrived') { const h = w.villages[e.village]; q.push({ type: 'HostDecided', village: h.id, party: e.party, answer: hostAnswer({ w, v: h, reason: 'visitor', rng, mem: (mem[h.id] ??= {}) }, e.mandate, w.villages[e.from]), requestedAt: e.t }); }
      }
      for (const i of q) sim.queue(i);
      const alive = w.villages.filter(v => v.alive);
      // crises as they happen: first famine per village per decade, hard winter ahead in autumn
      for (const v of alive.slice(0, 4)) {
        const key = `${v.id}:${Math.floor(t / 520)}`;
        if (v.hungryWeek > 0 && v.people.length >= 12 && !crisisSeen.has(key) && t % 4 === 0 && cases.filter(c => c.id.includes('-crisis-')).length < 4 * seeds.length) {
          crisisSeen.add(key); const view = mk(w, v, recent, 'famine'); cases.push({ id: `${seed}-crisis-${t}-${v.id}`, category: 'crisis', kind: 'decision', seed, tick: t, village: v.id, reason: 'famine', view, facts: facts(w, v, view), expect: { foodShare: 0.6, noVentures: true }, habit: POLICIES.sensible({ w, v, reason: 'famine', rng, mem: (mem[v.id] ??= {}) }) });
        }
      }
      if (!ticks.has(t)) continue;
      const v = alive[(t / 7) % alive.length | 0] ?? alive[0]; if (!v) continue;
      const season = seasonOf(t);
      const view = mk(w, v, recent, 'season'); const f = facts(w, v, view);
      const habit = POLICIES.sensible({ w, v, reason: 'season', rng, mem: (mem[v.id] ??= {}) });
      if ((SAMPLE_TICKS.indexOf(t) + seeds.indexOf(seed)) % 2 === 0) cases.push({ id: `${seed}-routine-${t}-${v.id}`, category: 'routine', kind: 'decision', seed, tick: t, village: v.id, reason: 'season', view, facts: f, expect: { season }, habit });
      // low food going into winter is a crisis in waiting
      if (season === 3 && f.foodWeeks < 3 && f.pop >= 12 && cases.filter(c => c.id.includes('-lean-')).length < 3 * seeds.length) cases.push({ id: `${seed}-lean-${t}-${v.id}`, category: 'crisis', kind: 'decision', seed, tick: t, village: v.id, reason: 'low-food', view, facts: f, expect: { foodShare: 0.6, noVentures: true }, habit });
      // hard winter ahead: autumn deliberation with a 'hard' roll next season
      if (season === 2 && cases.filter(c => c.id.includes('-hardwinter-')).length < 2 * seeds.length) {
        const w2 = cloneWorld(w); const s = Math.floor(t / 13) + 1; w2.rolls[s] = 'hard'; const v2 = w2.villages[v.id]; const view2 = mk(w2, v2, recent, 'season');
        cases.push({ id: `${seed}-hardwinter-${t}-${v.id}`, category: 'crisis', kind: 'decision', seed, tick: t, village: v.id, reason: 'season', view: view2, facts: facts(w2, v2, view2), expect: { winterPrep: true } });
      }
      // visitors: constructed mandates on this state
      if (f.knownVillages > 0 || w.villages.length > 1) {
        const guest = w.villages.find(x => x.alive && x.id !== v.id)!; const gsize = guest.people.length;
        const spareable = Object.entries({ grain: storeQty(v, 'grain'), wood: storeQty(v, 'wood') }).sort((a, b) => b[1] - a[1])[0];
        const kinds = [
          { name: 'fair', mandate: { offer: { hide: 6000 }, want: { [spareable[0]]: Math.min(6000, Math.trunc(spareable[1] / 4)) }, floor: 500 } as Mandate, expect: { answer: 'accept|counter' } },
          { name: 'greedy', mandate: { offer: { stone: 1000 }, want: { grain: Math.max(20_000, storeQty(v, 'grain')) }, floor: 900 } as Mandate, expect: { answer: 'refuse|counter', keepsReserve: true } },
          { name: 'threat-weak', mandate: { offer: {}, want: { grain: 8000 }, floor: 500, threat: true } as Mandate, guestSize: Math.max(5, Math.trunc(v.people.length / 3)), expect: { answer: 'refuse' } },
          { name: 'threat-strong', mandate: { offer: {}, want: { grain: 6000 }, floor: 500, threat: true } as Mandate, guestSize: v.people.length * 3, expect: { answer: 'accept|counter' } },
        ];
        const k = kinds[(t / 13) % kinds.length | 0];
        if (cases.filter(c => c.category === 'visitor').length < 5 * seeds.length) {
          const w2 = cloneWorld(w); const v2 = w2.villages[v.id]; relation(v2, guest.id).sizeSeen = k.guestSize ?? gsize; if (!v2.knowledge.villages.includes(guest.id)) v2.knowledge.villages.push(guest.id);
          const view2 = mk(w2, v2, recent, 'envoys have arrived');
          cases.push({ id: `${seed}-visitor-${k.name}-${t}-${v.id}`, category: 'visitor', kind: 'host', seed, tick: t, village: v.id, reason: 'visitor', view: view2, facts: facts(w2, v2, view2), expect: k.expect, mandate: k.mandate, guestName: guest.name, guestSize: k.guestSize ?? gsize, habit: hostAnswer({ w: w2, v: v2, reason: 'visitor', rng, mem: {} }, k.mandate, guest) });
        }
      }
      // expansion: crowded village with sites (should colonize) vs comfortable small village (should not)
      if (cases.filter(c => c.category === 'expansion').length < 4 * seeds.length && view.sites.length > 0 && season === 0) {
        const crowded = f.pop >= 40 && (f.foodWeeks < 6 || f.hardship > 150);
        cases.push({ id: `${seed}-expand-${crowded ? 'crowded' : 'easy'}-${t}-${v.id}`, category: 'expansion', kind: 'decision', seed, tick: t, village: v.id, reason: 'season', view, facts: f, expect: { colonize: crowded ? 'yes' : f.pop < 30 ? 'no' : 'either' }, habit });
      }
      // spirit: true advice, false advice, a question
      if (cases.filter(c => c.category === 'spirit').length < 5 * seeds.length) {
        const variants = [
          { name: 'true-winter', msg: 'The coming winter will be bitter. Dry fish and meat now, cut wood, and keep your people close.', expect: { winterPrep: true, replies: true } },
          { name: 'false-fallow', msg: 'Plant nothing this spring. The soil is cursed and the seed will rot.', expect: { stillPlants: true } },
          { name: 'question', msg: 'Tell me, chief: what do your people fear most this year?', expect: { replies: true } },
          { name: 'true-rumor', msg: (() => { const r = view.rumors[0]; return r ? `Listen to the one who noticed that ${r.toLowerCase()}. Have someone try it.` : 'Have someone try what your cooks have noticed.'; })(), expect: { researches: true } },
        ];
        const k = variants[(t / 13 + 1) % variants.length | 0];
        const w2 = cloneWorld(w); const v2 = w2.villages[v.id]; v2.inbox = [k.msg]; v2.trust = 500; const view2 = mk(w2, v2, recent, 'spirit');
        cases.push({ id: `${seed}-spirit-${k.name}-${t}-${v.id}`, category: 'spirit', kind: 'decision', seed, tick: t, village: v.id, reason: 'spirit', view: view2, facts: facts(w2, v2, view2), expect: k.expect, spiritMessage: k.msg });
      }
      // dream: a conversation turn
      if (cases.filter(c => c.category === 'dream').length < 5 * seeds.length) {
        const lines = [
          { turns: [] as Turn[], line: 'I am the wind that moves over your roofs. Do you know me?', expect: { answersQuestion: true } },
          { turns: [{ role: 'spirit', text: 'Rain will come with the summer. Plant now.' }, { role: 'chief', text: 'We have heard such promises before. Why should I trust the wind?' }] as Turn[], line: 'Because I have watched your fields since before your grandmother was born. Which of your stores worries you most?', expect: { answersQuestion: true, mentionsFact: true } },
          { turns: [] as Turn[], line: `Your neighbours at ${w.villages.find(x => x.id !== v.id)?.name ?? 'the river'} are hungry this year. Would you send them grain?`, expect: { answersQuestion: true } },
        ];
        const k = lines[(t / 13) % lines.length | 0];
        cases.push({ id: `${seed}-dream-${t}-${v.id}`, category: 'dream', kind: 'dream', seed, tick: t, village: v.id, reason: 'a dream', view, facts: f, expect: k.expect, dreamTurns: k.turns, dreamLine: k.line });
      }
    }
  }
  return cases;
}

function mk(w: World, v: Village, events: Event[], reason: string): VillageView {
  void reason;
  return buildView(w, v, { events: events.slice(-400), capNames: CAP_NAMES, pendingSpirit: [...v.inbox], chronicle: renderChronicle(w, v) });
}
function cloneWorld(w: World): World { return JSON.parse(JSON.stringify(w)) as World; }
export { addStore };
