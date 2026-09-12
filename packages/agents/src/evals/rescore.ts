/** Recompute checks for every stored run from its saved outputs, with the current parser and checkers. No model calls. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parseDecision, parseHostDecision } from '../parse.js';
import { scoreDecision, scoreDream, scoreHost, checksScore } from './score.js';
import type { EvalCase } from './corpus.js';
import type { CaseResult } from './run.js';
const corpus = JSON.parse(readFileSync('out/evals/corpus.json', 'utf8')) as EvalCase[]; const byId = new Map(corpus.map(c => [c.id, c]));
for (const f of readdirSync('out/evals').filter(f => f.endsWith('.json') && f !== 'corpus.json')) {
  const path = `out/evals/${f}`; const d = JSON.parse(readFileSync(path, 'utf8')) as { model: string; results: CaseResult[] }; let changed = 0;
  for (const r of d.results) {
    const c = byId.get(r.id); if (!c || r.error) continue; const before = r.score;
    try {
      if (c.kind === 'dream') r.checks = scoreDream(c, r.output);
      else { const j = JSON.parse(r.output); if (c.kind === 'host') { const p = parseHostDecision(c.view, j); r.checks = scoreHost(c, p.answer, p.journal); } else { const p = parseDecision(c.view, j); r.checks = scoreDecision(c, p); } }
      r.score = checksScore(r.checks); if (r.score !== before) changed++;
    } catch { /* truncated output: keep the original score */ }
  }
  writeFileSync(path, JSON.stringify(d, null, 1)); console.log(`${d.model.slice(0, 40).padEnd(40)} rescored, ${changed} changed, mean ${(d.results.reduce((a, r) => a + r.score, 0) / d.results.length).toFixed(3)}`);
}
