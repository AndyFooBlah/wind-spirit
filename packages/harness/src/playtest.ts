/**
 * A long unattended watch over a whole world, looking for the things a balance assertion cannot see: mechanics that
 * fire but never resolve, parties that never arrive, kin that raid each other, refugees who walk for ever.
 *
 *   pnpm harness -- playtest --seeds 4 --years 300
 *
 * Scripted chiefs, so it is free and fast. The point is structural: do abandonment, refuge and kinship behave over
 * centuries, and does anything get stuck. A separate short run with real chiefs checks judgement rather than plumbing.
 */
import { Rng, Sim, WEEKS_PER_YEAR, popCounts, seasonOf, storesWeeks, type Event, type World } from '@wind-spirit/sim';
import { generateWorld } from '@wind-spirit/gen';
import { POLICIES, hostAnswer } from './policies.js';

export interface Finding { seed: string; tick: number; what: string; detail: string }

export interface Watch {
  seed: string;
  years: number;
  founded: number; died: number; abandoned: number;
  refugeesAdmitted: number; refugeesTurnedAway: number; refugeePartiesLost: number;
  raids: number; kinRaids: number; trades: number;
  finalVillages: number; finalPop: number;
  longestRefugeeWalkWeeks: number;
  longestIdleStarvingWeeks: number;
  findings: Finding[];
}

/** One world, watched week by week. */
export function watchWorld(seed: string, years: number): Watch {
  const w: World = generateWorld({ seed });
  const sim = new Sim(w); const rng = Rng.fromSeed(seed, 'work');
  const mem: Record<number, Record<string, number>> = {};
  const wat: Watch = { seed, years, founded: 0, died: 0, abandoned: 0, refugeesAdmitted: 0, refugeesTurnedAway: 0, refugeePartiesLost: 0, raids: 0, kinRaids: 0, trades: 0, finalVillages: 0, finalPop: 0, longestRefugeeWalkWeeks: 0, longestIdleStarvingWeeks: 0, findings: [] };
  const say = (tick: number, what: string, detail: string) => { if (wat.findings.length < 40) wat.findings.push({ seed, tick, what, detail }); };
  /** When each refugee party started walking, so a party that never finds a home is visible. */
  const walking = new Map<number, number>();
  /** consecutive weeks a village has been idle with no food */
  const idle = new Map<number, number>();

  for (let t = 0; t < years * WEEKS_PER_YEAR; t++) {
    const ev: Event[] = sim.tick();
    for (const e of ev) {
      switch (e.type) {
        case 'VillageFounded': wat.founded++; break;
        case 'VillageDied': wat.died++; break;
        case 'VillageAbandoned': {
          wat.abandoned++;
          const to = w.villages[e.to];
          if (!to || !to.alive) say(e.t, 'abandoned toward a dead village', `${w.villages[e.village]?.name} set out for ${to?.name ?? e.to}, which is not alive`);
          break;
        }
        case 'RefugeesAdmitted': wat.refugeesAdmitted++; break;
        case 'RefugeesTurnedAway': wat.refugeesTurnedAway++; break;
        case 'PartyLost': if (w.parties.find(p => p.id === e.party)?.kind === 'refugee') wat.refugeePartiesLost++; break;
        case 'RaidResolved': {
          wat.raids++;
          if (w.villages[e.attacker]?.relations[e.defender]?.kin) { wat.kinRaids++; say(e.t, 'kin raided kin', `${w.villages[e.attacker]?.name} raided ${w.villages[e.defender]?.name}, who are kin`); }
          break;
        }
        case 'TradeCompleted': wat.trades++; break;
        default: break;
      }
    }
    // Scripted chiefs answer whatever the sim asks of them.
    for (const e of ev) {
      if (e.type === 'DeliberationRequested') { const v = w.villages[e.village]; if (v?.alive) sim.queue({ type: 'ChiefDecided', village: v.id, orders: POLICIES.sensible({ w, v, reason: e.reason, rng, mem: (mem[v.id] ??= {}) }), requestedAt: e.t }); }
      if (e.type === 'VisitorArrived') { const h = w.villages[e.village]; if (h?.alive) sim.queue({ type: 'HostDecided', village: h.id, party: e.party, answer: hostAnswer({ w, v: h, reason: 'visitor', rng, mem: (mem[h.id] ??= {}) }, e.mandate, w.villages[e.from]), requestedAt: e.t }); }
    }
    // Refugees who have been walking a very long time are stuck, not travelling.
    for (const p of w.parties) {
      if (p.kind !== 'refugee') continue;
      if (!walking.has(p.id)) walking.set(p.id, t);
      const weeks = t - walking.get(p.id)!;
      wat.longestRefugeeWalkWeeks = Math.max(wat.longestRefugeeWalkWeeks, weeks);
      if (weeks === 260) say(t, 'refugees walking five years', `party ${p.id} from ${w.villages[p.home]?.name}, ${p.members.length} people, still looking for a home`);
    }
    for (const id of [...walking.keys()]) if (!w.parties.some(p => p.id === id)) walking.delete(id);

    // A village idle and starving for one week is a snapshot; for two months it is a stalled chief. Count the run.
    for (const v of w.villages) {
      const starving = v.alive && v.people.length > 0 && !v.orders.length && storesWeeks(w, v) < 2 && popCounts(v, w.tick).adults > 0;
      const runLen = starving ? (idle.get(v.id) ?? 0) + 1 : 0;
      if (starving) idle.set(v.id, runLen); else idle.delete(v.id);
      if (runLen === 8) say(t, 'village idle and starving for two months', `${v.name}: ${v.people.length} people, no standing orders, ${storesWeeks(w, v)} weeks of food`);
      wat.longestIdleStarvingWeeks = Math.max(wat.longestIdleStarvingWeeks, runLen);
    }
  }
  wat.finalVillages = w.villages.filter(v => v.alive).length;
  wat.finalPop = w.villages.reduce((a, v) => a + (v.alive ? v.people.length : 0), 0);
  if (wat.abandoned > 0 && wat.refugeesAdmitted + wat.refugeesTurnedAway === 0) say(years * WEEKS_PER_YEAR, 'villages abandoned but nobody ever asked', `${wat.abandoned} abandonments, no refugee ever reached a village`);
  return wat;
}

export function playtest(seeds: string[], years: number): void {
  const all = seeds.map(s => watchWorld(s, years));
  const sum = (f: (w: Watch) => number) => all.reduce((a, w) => a + f(w), 0);
  console.log(`\n${seeds.length} worlds × ${years} years, scripted chiefs\n`);
  console.log('| seed | villages | people | founded | died | abandoned | taken in | turned away | lost on the road | raids | kin raids | trades |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const w of all) console.log(`| ${w.seed} | ${w.finalVillages} | ${w.finalPop} | ${w.founded} | ${w.died} | ${w.abandoned} | ${w.refugeesAdmitted} | ${w.refugeesTurnedAway} | ${w.refugeePartiesLost} | ${w.raids} | ${w.kinRaids} | ${w.trades} |`);
  console.log(`\nlongest a refugee party walked: ${Math.max(...all.map(w => w.longestRefugeeWalkWeeks))} weeks; longest a village sat idle with no food: ${Math.max(...all.map(w => w.longestIdleStarvingWeeks))} weeks`);
  const findings = all.flatMap(w => w.findings);
  if (!findings.length) { console.log('no findings'); return; }
  console.log(`\n${findings.length} findings:`);
  const byWhat = new Map<string, Finding[]>();
  for (const f of findings) { const k = f.what; byWhat.set(k, [...(byWhat.get(k) ?? []), f]); }
  for (const [what, fs] of byWhat) {
    console.log(`\n  ${what} (${fs.length})`);
    for (const f of fs.slice(0, 3)) console.log(`    ${f.seed} year ${Math.floor(f.tick / WEEKS_PER_YEAR)}: ${f.detail}`);
  }
  void sum; void seasonOf;
}
