/** Aggregate out/evals/*.json into a markdown table by category, with cost per case, latency, judge scores, and agreement with a reference model. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { CaseResult } from './run.js';
const dir = 'out/evals'; const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'corpus.json');
const runs = files.map(f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as { model: string; results: CaseResult[] });
const ref = process.argv.includes('--ref') ? process.argv[process.argv.indexOf('--ref') + 1] : 'gemini-3.1-pro-preview';
const cats = ['routine', 'crisis', 'visitor', 'expansion', 'spirit', 'dream'];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const refRun = runs.find(r => r.model === ref);
const decisionClass = (r: CaseResult) => { try { const j = JSON.parse(r.output); if (j.answer) return j.answer; if (Array.isArray(j.orders)) return j.orders.some((o: { task: string }) => o.task === 'colonize') ? 'colonize' : j.orders.some((o: { task: string }) => o.task === 'raid') ? 'raid' : 'stay'; } catch { /* prose */ } return ''; };
let md = `| model | all | ${cats.join(' | ')} | judge | agree w/ ref | $/case | ms/case | errors |\n|---|---|${cats.map(() => '---').join('|')}|---|---|---|---|---|\n`;
for (const r of runs.sort((a, b) => mean(b.results.map(x => x.score)) - mean(a.results.map(x => x.score)))) {
  const by = cats.map(c => { const xs = r.results.filter(x => x.category === c).map(x => x.score); return xs.length ? mean(xs).toFixed(2) : '–'; });
  const judged = r.results.filter(x => x.judge !== undefined).map(x => x.judge!);
  let agree = '–';
  if (refRun && refRun.model !== r.model) { const pairs = r.results.filter(x => ['visitor', 'expansion'].includes(x.category)).map(x => [decisionClass(x), decisionClass(refRun.results.find(y => y.id === x.id) ?? x)]).filter(p => p[0] && p[1]); if (pairs.length) agree = `${(100 * pairs.filter(p => p[0] === p[1]).length / pairs.length).toFixed(0)}%`; }
  md += `| ${r.model} | ${mean(r.results.map(x => x.score)).toFixed(3)} | ${by.join(' | ')} | ${judged.length ? mean(judged).toFixed(2) : '–'} | ${agree} | ${mean(r.results.map(x => x.cost)).toFixed(4)} | ${Math.round(mean(r.results.map(x => x.ms)))} | ${r.results.filter(x => x.error).length} |\n`;
}
writeFileSync(`${dir}/report.md`, md); console.log(md);
