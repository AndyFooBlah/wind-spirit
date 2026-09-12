import { readFileSync, readdirSync } from 'node:fs';
import { parseDecision } from '../parse.js';
import type { EvalCase } from './corpus.js';
import type { CaseResult } from './run.js';
const corpus = JSON.parse(readFileSync('out/evals/corpus.json', 'utf8')) as EvalCase[]; const byId = new Map(corpus.map(c => [c.id, c]));
for (const f of readdirSync('out/evals').filter(f => f.endsWith('.json') && f !== 'corpus.json')) {
  const d = JSON.parse(readFileSync(`out/evals/${f}`, 'utf8')) as { model: string; results: CaseResult[] }; const reasons: Record<string, number> = {}; let n = 0;
  for (const r of d.results) { if (r.category === 'visitor' || r.category === 'dream' || r.error) continue; const c = byId.get(r.id); if (!c) continue; let j; try { j = JSON.parse(r.output); } catch { continue; } if (!Array.isArray(j.orders)) continue; const p = parseDecision(c.view, j); for (const dr of p.dropped) { const k = dr.replace(/"[^"]*"/g, '"…"').slice(0, 60); reasons[k] = (reasons[k] ?? 0) + 1; n++; } }
  console.log(`${d.model.slice(0, 40).padEnd(40)} dropped=${n}  ${Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(' | ')}`);
}
