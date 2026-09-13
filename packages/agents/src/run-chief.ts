/**
 * Proof run: one village is run by the real model through the deployed proxy; the rest use the scripted policy.
 * Usage: PROXY_URL=https://... tsx src/run-chief.ts <seed> <years> [villageId]
 * Anonymous Firebase auth is minted with the public web API key in services/llm-proxy/firebase-web-config.json.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { anonToken } from './evals/token.js';
import { Rng, Sim, WEEKS_PER_YEAR, popCounts, storesWeeks, type Input } from '@wind-spirit/sim';
import { generateWorld, CAP_NAMES } from '@wind-spirit/gen';
import { POLICIES, hostAnswer } from '@wind-spirit/harness';
import { ChiefScheduler, HttpLlmClient } from './index.js';

const [seed = 'chief-0', years = '20', vidArg = '0', speedArg = 'normal'] = process.argv.slice(2).filter(a => a !== '--');
const proxy = process.env.PROXY_URL ?? 'https://llm-proxy-406179055859.us-central1.run.app';
const vid = Number(vidArg);


async function main() {
  const token = await anonToken(proxy);
  const client = new HttpLlmClient(proxy, async () => token);
  const w = generateWorld({ seed }); const sim = new Sim(w); const rng = Rng.fromSeed(seed, 'work'); const mem: Record<number, Record<string, number>> = {};
  const out = `out/chief-${seed}`; mkdirSync(out, { recursive: true });
  const log: string[] = []; let calls = 0, errors = 0;
  const sched = new ChiefScheduler({
    client, capNames: CAP_NAMES, modelVillages: id => id === vid, maxInFlight: 2, yearlyBudget: 400_000, speed: () => speedArg as 'normal' | 'fast',
    fallback: { decide: (w2, v, reason) => POLICIES.sensible({ w: w2, v, reason, rng, mem: (mem[v.id] ??= {}) }), host: (w2, v, m, g) => hostAnswer({ w: w2, v, reason: 'visitor', rng, mem: (mem[v.id] ??= {}) }, m, g) },
    onJournal: e => { if (e.village === vid) { const line = `[y${Math.floor(e.tick / WEEKS_PER_YEAR)} w${e.tick % WEEKS_PER_YEAR}] (${e.reason}; ${e.source}${e.dropped?.length ? `; dropped: ${e.dropped.join(' | ')}` : ''}) ${e.text}`; log.push(line); console.log(line); } },
    onError: (err, village) => { errors++; console.error(`village ${village}:`, (err as Error).message); },
  });
  const t0 = Date.now();
  for (let t = 0; t < Number(years) * WEEKS_PER_YEAR; t++) {
    const ev = sim.tick();
    const started = sched.onEvents(w, ev); calls += started.length;
    await Promise.all(started);                                // the proof waits; the game would not
    for (const i of sched.drain() as Input[]) sim.queue(i);
    if (w.tick % WEEKS_PER_YEAR === 0) { const v = w.villages[vid]; const c = popCounts(v, w.tick); console.log(`--- year ${w.tick / WEEKS_PER_YEAR}: ${v.name} pop ${c.total} (${c.adults} adults) food ${storesWeeks(w, v)}w happy ${v.happiness} caps [${v.capabilities.join(',')}] recipes ${v.recipes.length} alive=${v.alive}`); }
    if (!w.villages[vid].alive) { console.log('the village died'); break; }
  }
  const spent = Object.entries(sched.spending()).filter(([k]) => k.startsWith(`${vid}:`)).reduce((a, [, v]) => a + v, 0);
  const summary = { seed, years: Number(years), village: vid, alive: w.villages[vid].alive, pop: w.villages[vid].people.length, capabilities: w.villages[vid].capabilities, recipes: w.villages[vid].recipes.length, modelJournals: sched.journals.filter(j => j.village === vid && j.source === 'model').length, habitJournals: sched.journals.filter(j => j.village === vid && j.source === 'habit').length, tokens: spent, errors, ms: Date.now() - t0 };
  console.log(JSON.stringify(summary, null, 2));
  writeFileSync(`${out}/journal.txt`, log.join('\n')); writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
