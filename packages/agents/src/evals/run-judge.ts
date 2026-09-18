/**
 * Judgment eval: put the three adapter questions to Jev or to an LLM over the same corpus states and score them
 * against ground truth taken from the corpus, not from an opinion about good prose.
 *
 * Usage: TYPESAFE_API_KEY=... tsx src/evals/run-judge.ts --judge jev [--tasks credibility,host,verdict] [--repeat 3]
 *        tsx src/evals/run-judge.ts --judge llm --model gemini-3.8-flash
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { HttpLlmClient } from '../client.js';
import { LlmJudge } from '../judge/llm.js';
import { JevJudge } from '../judge/jev.js';
import { SdkSystemOne } from '../judge/transport-sdk.js';
import { ProxySystemOne } from '../judge/transport.js';
import type { Judge, VerdictValue } from '../judge/types.js';
import type { EvalCase } from './corpus.js';
import { anonToken } from './token.js';

const argv = process.argv.slice(2).filter(a => a !== '--');
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const proxy = process.env.PROXY_URL ?? 'https://llm-proxy-406179055859.us-central1.run.app';

export interface JudgeResult { id: string; task: string; kind: string; expected: string; got: string; correct: boolean; p: number; confidence: number; distribution?: Record<string, number>; ms: number; error?: string }

/** Which spirit whispers a chief should act on. The question cases make no claim, so they are not scored here. */
function credibilityTruth(id: string): boolean | undefined {
  if (id.includes('false-fallow')) return false;      // "plant nothing, the soil is cursed" — a lie that costs a harvest
  if (id.includes('true-rumor')) return true;         // "try what your cooks have noticed" — cheap and sound
  return undefined;                                   // "what do your people fear?" — a question, not a claim
}

/**
 * Verdict probe. The corpus has no verdict cases, so claims are paired with village states whose own facts settle
 * them: a claim about deaths is judged by the deaths the view records, one about stores by the weeks of food.
 * A claim about somewhere the village cannot see is unverifiable whatever happened.
 */
const VERDICT_CLAIMS: { key: string; claim: string; truth: (c: EvalCase) => VerdictValue }[] = [
  { key: 'deaths', claim: 'Before this season turns, death will visit your village.', truth: c => (c.view.people.deathsRecent > 0 ? 'fulfilled' : 'failed') },
  { key: 'hunger', claim: 'Your stores will not carry you to the next harvest.', truth: c => (c.view.foodWeeks < 13 ? 'fulfilled' : 'failed') },
  { key: 'faraway', claim: 'Beyond the mountains you have never crossed, a great herd is moving north.', truth: () => 'unverifiable' },
];

async function main() {
  const which = arg('judge', 'jev'); const tasks = arg('tasks', 'credibility').split(',').filter(Boolean);
  const repeat = Number(arg('repeat', '1'));
  const corpusPath = arg('corpus', 'docs/evals/corpus-2026-09-13.json');
  if (!existsSync(corpusPath)) throw new Error(`no corpus at ${corpusPath}`);
  const cases = JSON.parse(readFileSync(corpusPath, 'utf8')) as EvalCase[];

  // --judge jev goes straight to the SDK; --judge jev-proxy exercises the path the browser uses.
  let judge: Judge;
  if (which === 'jev') judge = new JevJudge({ transport: new SdkSystemOne(), model: arg('model', 'jev-latest') });
  else if (which === 'jev-proxy') { const token = await anonToken(proxy); judge = new JevJudge({ transport: new ProxySystemOne(proxy, async () => token), model: arg('model', 'jev-latest') }); }
  else { const token = await anonToken(proxy); judge = new LlmJudge({ client: new HttpLlmClient(proxy, async () => token), model: arg('model', 'gemini-3.8-flash'), modelClass: 'routine' }); }

  const results: JudgeResult[] = [];
  const run = async (id: string, task: string, kind: string, expected: string, fn: () => Promise<{ value: unknown; p: number; confidence: number; distribution?: Record<string, number> }>) => {
    const t0 = Date.now();
    try { const j = await fn(); const got = String(j.value); results.push({ id, task, kind, expected, got, correct: got === expected, p: j.p, confidence: j.confidence, distribution: j.distribution, ms: Date.now() - t0 }); }
    catch (e) { results.push({ id, task, kind, expected, got: 'ERROR', correct: false, p: 0, confidence: 0, ms: Date.now() - t0, error: (e as Error).message.slice(0, 200) }); }
    const r = results[results.length - 1];
    process.stdout.write(`${judge.name} ${task} ${r.kind.padEnd(12)} ${r.correct ? 'ok ' : 'MISS'} want=${expected} got=${r.got} p=${r.p.toFixed(3)}${r.error ? ` ERR ${r.error}` : ''} ${r.ms}ms\n`);
  };

  for (let pass = 0; pass < repeat; pass++) {
    if (tasks.includes('credibility')) {
      for (const c of cases.filter(x => x.category === 'spirit')) {
        const truth = credibilityTruth(c.id); if (truth === undefined) continue;
        const kind = c.id.includes('false-fallow') ? 'false-fallow' : 'true-rumor';
        await run(`${c.id}#${pass}`, 'credibility', kind, String(truth), () => judge.credible({ view: c.view, whisper: c.spiritMessage! }));
      }
    }
    if (tasks.includes('verdict')) {
      for (const c of cases.filter(x => x.category === 'spirit')) {
        for (const v of VERDICT_CLAIMS) await run(`${c.id}-${v.key}#${pass}`, 'verdict', v.key, v.truth(c), () => judge.verdict({ view: c.view, claim: v.claim, since: c.view.events }));
      }
    }
    if (tasks.includes('host')) {
      for (const c of cases.filter(x => x.kind === 'host')) {
        const allowed = String(c.expect.answer ?? '').split('|');
        const kind = c.id.match(/-visitor-(.+?)-\d+-\d+$/)?.[1] ?? 'visitor';
        const cname = (id: string) => Object.entries(c.view.names.commodities).find(([, v]) => v === id)?.[0] ?? id;
        const rname = (id: string) => Object.entries(c.view.names.recipes).find(([, v]) => v === id)?.[0] ?? id;
        const t0 = Date.now();
        try {
          const j = await judge.hostAnswer({ view: c.view, from: c.guestName ?? 'strangers', mandate: c.mandate!, cname, rname });
          const got = String(j.value);
          results.push({ id: `${c.id}#${pass}`, task: 'host', kind, expected: allowed.join('|'), got, correct: allowed.includes(got), p: j.p, confidence: j.confidence, distribution: j.distribution, ms: Date.now() - t0 });
        } catch (e) { results.push({ id: `${c.id}#${pass}`, task: 'host', kind, expected: allowed.join('|'), got: 'ERROR', correct: false, p: 0, confidence: 0, ms: Date.now() - t0, error: (e as Error).message.slice(0, 200) }); }
        const r = results[results.length - 1];
        process.stdout.write(`${judge.name} host ${r.kind.padEnd(12)} ${r.correct ? 'ok ' : 'MISS'} want=${r.expected} got=${r.got} p=${r.p.toFixed(3)} ${r.ms}ms\n`);
      }
    }
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  console.log(`\n== ${judge.name} ==`);
  for (const task of tasks) {
    const rs = results.filter(r => r.task === task); if (!rs.length) continue;
    const kinds = [...new Set(rs.map(r => r.kind))];
    console.log(`${task}: ${rs.filter(r => r.correct).length}/${rs.length} correct (${(mean(rs.map(r => (r.correct ? 1 : 0))) * 100).toFixed(0)}%), mean p ${mean(rs.map(r => r.p)).toFixed(3)}, ${Math.round(mean(rs.map(r => r.ms)))}ms`);
    for (const k of kinds) { const ks = rs.filter(r => r.kind === k); console.log(`   ${k.padEnd(14)} ${ks.filter(r => r.correct).length}/${ks.length}  mean p ${mean(ks.map(r => r.p)).toFixed(3)}`); }
  }
  console.log(`spend: ${judge.spent.calls} calls, ${judge.spent.input.toLocaleString()} in / ${judge.spent.output.toLocaleString()} out, $${judge.spent.cost.toFixed(4)}`);
  mkdirSync('out/evals', { recursive: true });
  const file = `out/evals/judge-${judge.name.replace(/[^a-z0-9.-]/gi, '_')}.json`;
  writeFileSync(file, JSON.stringify({ judge: judge.name, when: new Date().toISOString(), corpus: corpusPath, repeat, spent: judge.spent, results }, null, 1));
  console.log(`wrote ${file}`);
}

main().catch(e => { console.error(e); process.exit(1); });
