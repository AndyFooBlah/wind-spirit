import { mkdirSync, writeFileSync } from 'node:fs';
import { buildCorpus } from './corpus.js';
const cases = buildCorpus();
mkdirSync('out/evals', { recursive: true }); writeFileSync('out/evals/corpus.json', JSON.stringify(cases));
const by: Record<string, number> = {}; for (const c of cases) by[c.category] = (by[c.category] ?? 0) + 1;
console.log(cases.length, 'cases', by);
