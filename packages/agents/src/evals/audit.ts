/** Golden-answer audit: which (case, check) pairs do the strong models fail together? Those are suspects for a wrong check, not a wrong model. */
import { readFileSync, readdirSync } from 'node:fs';
import type { CaseResult } from './run.js';
import type { EvalCase } from './corpus.js';
const dir = 'out/evals'; const corpus = JSON.parse(readFileSync(`${dir}/corpus.json`, 'utf8')) as EvalCase[]; const byId = new Map(corpus.map(c => [c.id, c]));
const runs = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'corpus.json').map(f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as { model: string; results: CaseResult[] });
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const strong = runs.filter(r => r.results.filter(x => x.error).length === 0).sort((a, b) => mean(b.results.map(x => x.score)) - mean(a.results.map(x => x.score))).slice(0, 12).map(r => r.model); // the top twelve clean runs
console.log('strong models:', strong.join(', '));
const fails: Record<string, { n: number; models: string[] }> = {};
for (const r of runs) if (strong.includes(r.model)) for (const x of r.results) for (const [k, ok] of Object.entries(x.checks)) if (!ok) { const key = `${x.id} :: ${k}`; (fails[key] ??= { n: 0, models: [] }); fails[key].n++; fails[key].models.push(r.model); }
const suspects = Object.entries(fails).filter(([, v]) => v.n >= Math.ceil(strong.length / 2)).sort((a, b) => b[1].n - a[1].n);
console.log(`\n${suspects.length} (case, check) pairs failed by at least half of the ${strong.length} strong models:`);
for (const [key, v] of suspects) { const [id, check] = key.split(' :: '); const c = byId.get(id); if (!c) continue; console.log(`- ${key}: ${v.n}/${strong.length}; season ${c.facts.season}, pop ${c.facts.pop}, adults ${c.facts.adults}, food ${c.facts.foodWeeks}w, hungry ${c.facts.hungry}, sites ${c.facts.sites}, expect ${JSON.stringify(c.expect)}`); }
// also: checks failed by everyone (all runs)
const all: Record<string, number> = {}; for (const r of runs) for (const x of r.results) for (const [k, ok] of Object.entries(x.checks)) if (!ok) all[`${x.id} :: ${k}`] = (all[`${x.id} :: ${k}`] ?? 0) + 1;
console.log(`\nfailed by ≥ 80% of all ${runs.length} runs:`); for (const [k, n] of Object.entries(all).filter(([, n]) => n >= runs.length * 0.8).sort((a, b) => b[1] - a[1])) console.log(`- ${k}: ${n}/${runs.length}`);
