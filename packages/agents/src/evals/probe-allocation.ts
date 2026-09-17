/**
 * Side experiment: can a System One model allocate labour, given that it cannot emit a variable list of orders?
 *
 * The shape under test. Ask one comparable Score per candidate task — "what share of the village's hands belongs
 * here this season" — plus one Choice for the season's purpose, all in a single request over the same state.
 * Code, not the model, owns consistency: it normalises the score vector onto the adult budget, so the sum is
 * right by construction and no order can exceed it. Arguments are not generated here; that is a second step.
 *
 * Usage: TYPESAFE_API_KEY=... tsx src/evals/probe-allocation.ts [--limit 8] [--corpus path]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { Order, Task } from '@wind-spirit/sim';
import { TypeSafeClient, type ChoiceResponse, type ScoreResponse } from '@typesafe-ai/sdk';
import type { EvalCase } from './corpus.js';
import type { VillageView } from '../view.js';
import type { JsonObject } from '../judge/state.js';

const argv = process.argv.slice(2).filter(a => a !== '--');
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

/** Tasks that need no argument to allocate against. Ventures and anything needing a target are a separate decision. */
const CANDIDATES: { task: Task; what: string }[] = [
  { task: 'forage', what: 'gathering wild plants and roots nearby' },
  { task: 'hunt', what: 'hunting game' },
  { task: 'fish', what: 'fishing' },
  { task: 'farm', what: 'working the cleared plots: planting in spring, harvesting in autumn' },
  { task: 'gather', what: 'carrying in wood, stone or other raw material' },
  { task: 'clear', what: 'clearing new ground for planting' },
  { task: 'build', what: 'raising a building' },
  { task: 'craft', what: 'making goods or a new skill from what we have' },
  { task: 'research', what: 'trying things out to learn something new' },
  { task: 'rest', what: 'resting, doing nothing in particular' },
];

const LEVELS = [
  'Nobody at all. Other work matters more this season, or there is nothing here to do.',
  'One or two hands, no more. Worth a little attention, not a share of the village.',
  'A good share of the hands, alongside other work.',
  'Most of the village. This is what the season is for.',
] as const;

/** Turn a score per task into whole workers that sum to the budget: proportional, then largest remainder. */
export function allocate(scores: Record<string, number>, budget: number): Order[] {
  const live = Object.entries(scores).filter(([, s]) => s > 0.5);
  const total = live.reduce((a, [, s]) => a + s, 0);
  if (!live.length || total <= 0 || budget <= 0) return [];
  const raw = live.map(([task, s]) => ({ task: task as Task, exact: (s / total) * budget }));
  const out = raw.map(r => ({ ...r, workers: Math.floor(r.exact) }));
  let left = budget - out.reduce((a, r) => a + r.workers, 0);
  for (const r of [...out].sort((a, b) => (b.exact - b.workers) - (a.exact - a.workers))) { if (left <= 0) break; r.workers++; left--; }
  return out.filter(r => r.workers > 0).map(r => ({ task: r.task, workers: r.workers, params: {}, since: 0 }));
}

function stateOf(v: VillageView): JsonObject {
  return {
    village: v.village.name,
    now: { year: v.year, season: v.season, week_of_season: v.week },
    hands_free_to_assign: v.people.workersFree,
    people: { total: v.people.total, adults: v.people.adults, hungry_now: v.people.hungryNow, deaths_this_season: v.people.deathsRecent, mood: v.people.happiness, shelter: v.people.shelterWords },
    food: { weeks_of_stores: v.foodWeeks, eaten_per_week: v.yields.need, per_worker_week: { foraging: v.yields.forage, hunting: v.yields.hunt, fishing: v.yields.fish } },
    land: { cleared_plots: v.plots.cleared, planted_plots: v.plots.planted, free_plots: v.plots.free, buildings: v.plots.structures },
    stores: v.stores.map(s => `${s.units} ${s.name}${s.food ? ' (food)' : ''}`),
    skills_we_have: v.capabilities,
    things_we_could_make_now: v.recipes.filter(r => r.canMakeNow && !r.held).map(r => r.name),
    things_noticed_but_not_worked_out: v.rumors,
    standing_orders: v.orders,
    since_we_last_decided: v.events,
  };
}

async function main() {
  const corpus = JSON.parse(readFileSync(arg('corpus', 'docs/evals/corpus-2026-09-13.json'), 'utf8')) as EvalCase[];
  const cases = corpus.filter(c => c.category === 'routine').slice(0, Number(arg('limit', '8')));
  const client = new TypeSafeClient({ defaultModel: 'jev-latest', timeout: 20000 });
  const rows: Record<string, unknown>[] = [];
  let inTokens = 0;

  for (const c of cases) {
    const v = c.view; const budget = v.people.workersFree;
    const questions: Record<string, unknown> = {
      purpose: { type: 'choice', instructions: 'What is this season chiefly for, in this village, as things stand?', criteria: { feeding: 'Getting enough food in to carry the village through.', growing: 'Clearing and planting to grow what the village can feed.', building: 'Raising shelter and the things that make work easier.', learning: 'Trying things out and making new skills.', resting: 'There is little pressing; the village can take it easy.' } },
    };
    for (const t of CANDIDATES) questions[t.task] = { type: 'score', instructions: `Of this village's ${budget} free hands, what share belongs on ${t.what} this season?`, criteria: LEVELS };

    const t0 = Date.now();
    const res = await client.systemOne({ state: stateOf(v), questions: questions as never });
    const ms = Date.now() - t0; inTokens += res.usage.input_tokens;
    const answers = res.answers as Record<string, ScoreResponse | ChoiceResponse>;
    const scores: Record<string, number> = {};
    for (const t of CANDIDATES) scores[t.task] = (answers[t.task] as ScoreResponse).score;
    const orders = allocate(scores, budget);

    const assigned = orders.reduce((a, o) => a + o.workers, 0);
    const food = orders.filter(o => ['forage', 'hunt', 'fish', 'farm'].includes(o.task)).reduce((a, o) => a + o.workers, 0);
    const winter = c.facts.season === 3;
    const checks = {
      withinBudget: assigned <= budget,
      usesMostAdults: assigned >= Math.floor(budget * 0.7),
      feedsFirst: c.facts.foodWeeks >= 52 || food >= Math.ceil(assigned * (winter ? 0.5 : 0.3)),
      plantsInSpring: c.facts.season !== 0 || v.plots.cleared === 0 || orders.some(o => o.task === 'farm'),
      harvestsInAutumn: c.facts.season !== 2 || v.plots.planted === 0 || orders.some(o => o.task === 'farm'),
    };
    const ok = Object.values(checks).filter(Boolean).length / Object.values(checks).length;
    rows.push({ id: c.id, season: ['spring', 'summer', 'autumn', 'winter'][c.facts.season], budget, purpose: (answers.purpose as ChoiceResponse).choice, scores, orders: orders.map(o => `${o.task}:${o.workers}`), checks, score: ok, ms });
    console.log(`${c.id.padEnd(28)} ${String(rows[rows.length - 1].season).padEnd(7)} budget=${String(budget).padStart(2)} purpose=${String(rows[rows.length - 1].purpose).padEnd(9)} ${(orders.map(o => `${o.task}:${o.workers}`).join(' ')).padEnd(52)} ${ok.toFixed(2)} ${Object.entries(checks).filter(([, b]) => !b).map(([k]) => '✗' + k).join(' ')} ${ms}ms`);
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  console.log(`\nallocation probe: ${cases.length} routine states, mean ${mean(rows.map(r => Number(r.score))).toFixed(3)}, ${Math.round(mean(rows.map(r => Number(r.ms))))}ms, ${inTokens.toLocaleString()} input tokens, $${(inTokens * 42 / 1e9).toFixed(5)}`);
  mkdirSync('out/evals', { recursive: true });
  writeFileSync('out/evals/probe-allocation.json', JSON.stringify({ when: new Date().toISOString(), rows }, null, 1));
}

main().catch(e => { console.error(e); process.exit(1); });
