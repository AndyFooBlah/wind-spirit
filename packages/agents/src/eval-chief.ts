/**
 * Prompt eval: sample village states from a scripted run, ask the model chief to decide, and score the decisions
 * with simple checkers (validity, workers within budget, feeding first in winter, investing when able, journal in character).
 * Usage: tsx src/eval-chief.ts [seed] [samples]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { anonToken } from './evals/token.js';
import { Rng, Sim, WEEKS_PER_YEAR, seasonOf, popCounts, type Input } from '@wind-spirit/sim';
import { generateWorld, CAP_NAMES } from '@wind-spirit/gen';
import { POLICIES } from '@wind-spirit/harness';
import { HttpLlmClient, buildView, statePrompt, systemPrompt, parseDecision, DECISION_SCHEMA, type ChiefDecisionJson } from './index.js';

const [seed = 'eval-0', samplesArg = '8'] = process.argv.slice(2).filter(a => a !== '--');
const proxy = process.env.PROXY_URL ?? 'https://llm-proxy-406179055859.us-central1.run.app';
const MODERN = /\b(computer|internet|percent|%|technology|economy|strategy|optimi[sz]e|data|algorithm|resource management|kpi|metric)\b/i;


async function main() {
  const token = await anonToken(proxy); const client = new HttpLlmClient(proxy, async () => token);
  const w = generateWorld({ seed }); const sim = new Sim(w); const rng = Rng.fromSeed(seed, 'work'); const mem: Record<number, Record<string, number>> = {};
  const sampleTicks = new Set([2, 20, 40, 105, 260, 520, 1040, 1560, 2080, 2600].slice(0, Number(samplesArg)));
  const results: { tick: number; village: number; season: number; checks: Record<string, boolean>; dropped: string[]; journal: string; ms: number }[] = [];
  for (let t = 0; t < 2601; t++) {
    const ev = sim.tick(); const q: Input[] = [];
    for (const e of ev) if (e.type === 'DeliberationRequested') { const v = w.villages[e.village]; if (v.alive) q.push({ type: 'ChiefDecided', village: v.id, orders: POLICIES.sensible({ w, v, reason: e.reason, rng, mem: (mem[v.id] ??= {}) }), requestedAt: e.t }); }
    for (const i of q) sim.queue(i);
    if (!sampleTicks.has(w.tick)) continue;
    const v = w.villages.find(x => x.alive)!; const view = buildView(w, v, { events: ev, capNames: CAP_NAMES });
    const t0 = Date.now();
    const res = await client.generate({ class: 'routine', system: systemPrompt(view), messages: [{ role: 'user', text: statePrompt(view, 'season') }], schema: DECISION_SCHEMA, maxOutputTokens: 6000, temperature: 0.7, thinkingLevel: 'low' });
    const json = res.json as ChiefDecisionJson; const parsed = parseDecision(view, json);
    const counts = popCounts(v, w.tick); const free = Math.max(0, counts.adults - 1);
    const assigned = parsed.orders.filter(o => o.task !== 'colonize').reduce((a, o) => a + o.workers, 0);
    const food = parsed.orders.filter(o => ['forage', 'hunt', 'fish', 'farm'].includes(o.task)).reduce((a, o) => a + o.workers, 0);
    const season = seasonOf(w.tick);
    const canInvest = view.recipes.some(r => r.canMakeNow && !r.held) || view.people.workersFree >= 6;
    const invests = parsed.orders.some(o => ['craft', 'build', 'research', 'clear', 'explore', 'envoy'].includes(o.task));
    const checks: Record<string, boolean> = {
      valid: parsed.dropped.length === 0,
      withinBudget: assigned <= free,
      usesMostAdults: assigned >= Math.floor(free * 0.7),
      feedsFirst: season === 3 ? food >= Math.ceil(assigned * 0.5) : food >= Math.ceil(assigned * 0.3),
      investsWhenAble: !canInvest || invests || view.people.hungryNow > 0,
      journalInCharacter: parsed.journal.length >= 60 && !MODERN.test(parsed.journal),
      keepsNotes: parsed.memoryNotes.length > 0,
    };
    results.push({ tick: w.tick, village: v.id, season, checks, dropped: parsed.dropped, journal: parsed.journal, ms: Date.now() - t0 });
    console.log(`t${w.tick} y${Math.floor(w.tick / WEEKS_PER_YEAR)} s${season} ${Object.entries(checks).map(([k, ok]) => `${ok ? '✓' : '✗'}${k}`).join(' ')}${parsed.dropped.length ? ` dropped: ${parsed.dropped.join(' | ')}` : ''}`);
  }
  const names = Object.keys(results[0]?.checks ?? {});
  const score = Object.fromEntries(names.map(n => [n, results.filter(r => r.checks[n]).length / results.length]));
  console.log(JSON.stringify({ seed, samples: results.length, score, meanMs: Math.round(results.reduce((a, r) => a + r.ms, 0) / results.length) }, null, 2));
  mkdirSync('out', { recursive: true }); writeFileSync(`out/eval-${seed}.json`, JSON.stringify({ score, results }, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
