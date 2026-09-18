/** Aggregate out/evals/*.json into a markdown table by category, with cost per case, latency, judge scores, and agreement with a reference model. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { CaseResult } from './run.js';
const dir = 'out/evals'; const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'corpus.json');
const runs = files.map(f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as { model: string; results: CaseResult[] });
const ref = process.argv.includes('--ref') ? process.argv[process.argv.indexOf('--ref') + 1] : 'gemini-3.1-pro-preview';
const cats = ['firstspring', 'routine', 'crisis', 'visitor', 'expansion', 'spirit', 'dream'];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const refRun = runs.find(r => r.model === ref);
const decisionClass = (r: CaseResult) => { try { const j = JSON.parse(r.output); if (j.answer) return j.answer; if (Array.isArray(j.orders)) return j.orders.some((o: { task: string }) => o.task === 'colonize') ? 'colonize' : j.orders.some((o: { task: string }) => o.task === 'raid') ? 'raid' : 'stay'; } catch { /* prose */ } return ''; };
let md = `| model | all | ${cats.join(' | ')} | judge | agree w/ ref | $/case | ms/case | errors |\n|---|---|${cats.map(() => '---').join('|')}|---|---|---|---|---|\n`;
for (const r of runs.sort((a, b) => mean(b.results.map(x => x.score)) - mean(a.results.map(x => x.score)))) {
  const by = cats.map(c => { const xs = r.results.filter(x => x.category === c).map(x => x.score); return xs.length ? mean(xs).toFixed(2) : '–'; });
  const judged = r.results.filter(x => x.judge !== undefined).map(x => x.judge!);
  let agree = '–';
  if (refRun && refRun.model !== r.model) { const pairs = r.results.filter(x => ['visitor', 'expansion'].includes(x.category)).map(x => [decisionClass(x), decisionClass(refRun.results.find(y => y.id === x.id) ?? x)]).filter(p => p[0] && p[1]); if (pairs.length) agree = `${(100 * pairs.filter(p => p[0] === p[1]).length / pairs.length).toFixed(0)}%`; }
  const msAvg = mean(r.results.map(x => x.ms));
  md += `| ${r.model} | ${mean(r.results.map(x => x.score)).toFixed(3)} | ${by.join(' | ')} | ${judged.length ? mean(judged).toFixed(2) : '–'} | ${agree} | ${mean(r.results.map(x => x.cost)).toFixed(4)} | ${Math.round(msAvg)}${msAvg > 10_000 ? ' ✗' : ''} | ${r.results.filter(x => x.error).length} |\n`;
}

/**
 * Cases that separate models. A category average hides a one-in-six failure: the visitor category is ten easy
 * `fair` cases and two `threat-weak`, so a model that pays every bully still scores 0.93 there. Group by the case
 * kind instead (the name between the seed and the tick in the id) and show every kind that some models pass and
 * others fail, so a regression on a discriminating case is visible on its own line.
 */
const kindOf = (id: string) => id.replace(/^eval-[a-z]-/, '').replace(/-\d+-\d+$/, '');
const kinds = [...new Set(runs.flatMap(r => r.results.map(x => kindOf(x.id))))].sort();
const passRate = (r: { results: CaseResult[] }, k: string) => { const xs = r.results.filter(x => kindOf(x.id) === k); return xs.length ? mean(xs.map(x => x.score)) : NaN; };
const splitting = kinds.filter(k => { const rates = runs.map(r => passRate(r, k)).filter(x => !Number.isNaN(x)); if (rates.length < 3) return false; return Math.min(...rates) < 0.9 && Math.max(...rates) > 0.98; });
if (splitting.length) {
  md += `\n\n### Cases that separate models (a category average hides these)\n\n| model | ${splitting.join(' | ')} |\n|---|${splitting.map(() => '---').join('|')}|\n`;
  for (const r of runs.sort((a, b) => mean(b.results.map(x => x.score)) - mean(a.results.map(x => x.score)))) {
    const cells = splitting.map(k => { const v = passRate(r, k); if (Number.isNaN(v)) return '–'; const n = r.results.filter(x => kindOf(x.id) === k).length; return `${v.toFixed(2)}${n < 4 ? ` (${n})` : ''}`; });
    md += `| ${r.model} | ${cells.join(' | ')} |\n`;
  }
  md += `\nA kind is listed when some model scores below 0.90 on it and another scores above 0.98. Counts in brackets are the number of cases behind a figure: fewer than four is a weak signal, and the judgment runner (\`run-judge.ts\`) is the way to get a properly powered answer on one question.\n`;
}

// Cost per chief-century: 13 routine and 4 impactful decisions a year at normal cadence (5 and 2 at fast), measured per-case costs.
const costOf = (r: { results: CaseResult[] }, cats: string[]) => mean(r.results.filter(x => cats.includes(x.category) && !x.error).map(x => x.cost));
md += `\n\n### Projected cost per chief per century (normal cadence: 13 routine + 4 impactful decisions a year; fast: 5 + 2)\n\n| model for everything | normal | fast |\n|---|---|---|\n`;
for (const r of runs) { const ro = costOf(r, ['routine']), im = costOf(r, ['crisis', 'visitor', 'expansion', 'spirit']); md += `| ${r.model} | $${(100 * (13 * ro + 4 * im)).toFixed(2)} | $${(100 * (5 * ro + 2 * im)).toFixed(2)} |\n`; }
const base = runs.find(r => r.model === 'gemini-3.8-flash');
if (base) { md += `\n### Mixed: candidate for routine, Gemini 3.8 Flash for impactful\n\n| routine model | routine score | normal | fast |\n|---|---|---|---|\n`; for (const r of runs) { const ro = costOf(r, ['routine']), im = costOf(base, ['crisis', 'visitor', 'expansion', 'spirit']); md += `| ${r.model} | ${mean(r.results.filter(x => x.category === 'routine').map(x => x.score)).toFixed(3)} | $${(100 * (13 * ro + 4 * im)).toFixed(2)} | $${(100 * (5 * ro + 2 * im)).toFixed(2)} |\n`; } }
writeFileSync(`${dir}/report.md`, md); console.log(md);
