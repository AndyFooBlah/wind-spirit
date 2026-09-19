import { mkdirSync, writeFileSync } from 'node:fs';
import { playtest } from './playtest.js';
import { join } from 'node:path';
import { runOne, toCsv } from './run.js';
import { buildReport } from './report.js';
import { runSuite } from './assert.js';
import type { PolicyName } from './policies.js';

const argv = process.argv.slice(2).filter(a => a !== '--');
function arg(name: string, def: string): string { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; }
const cmd = argv[0] ?? 'run';
const out = join(process.env.INIT_CWD ?? process.cwd(), arg('out', 'out/latest')); mkdirSync(out, { recursive: true });

if (cmd === 'playtest') {
  const seeds = Number(arg('seeds', '4')); const years = Number(arg('years', '300'));
  playtest(Array.from({ length: seeds }, (_, i) => `play-${i}`), years);
} else if (cmd === 'run') {
  const n = Number(arg('seeds', '10')), years = Number(arg('years', '200')), policy = arg('policy', 'sensible') as PolicyName;
  const startPop = Number(arg('pop', '20')); const prefix = arg('prefix', 'run'); const size = Number(arg('size', '64')); const villages = Number(arg('villages', '4'));
  const results = [];
  for (let i = 0; i < n; i++) { const r = runOne({ seed: `${prefix}-${i}`, years, policy, startPop, villages, size, replayCheck: i === 0 }); results.push(r); console.log(`${r.seed}: villages ${r.finalVillages} pop ${r.finalPop} peak ${r.peakPop} founded ${r.villagesFounded} paths ${r.pathTiles} trades ${r.trades} raids ${r.raids} transfers ${r.transfers} (${r.ms} ms)`); }
  writeFileSync(join(out, 'rows.csv'), toCsv(results.flatMap(r => r.rows)));
  writeFileSync(join(out, 'report.html'), buildReport(results, [], `Wind Spirit harness: ${policy}, ${n} seeds × ${years} years`));
  console.log(`wrote ${out}/report.html`);
} else if (cmd === 'assert') {
  const n = Number(arg('seeds', '10')); const only = arg('only', '');
  const suite = runSuite(n, s => console.log(`… ${s}`), only || undefined);
  for (const c of suite.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  (${c.detail})`);
  for (const [k, rs] of Object.entries(suite.results)) {
    writeFileSync(join(out, `${k}.csv`), toCsv(rs.flatMap(r => r.rows)));
    writeFileSync(join(out, `${k}.html`), buildReport(rs, k === 'sensible' ? suite.checks : [], `Wind Spirit balance: ${k}`));
  }
  console.log(`wrote ${out}/*.html`);
  if (suite.checks.some(c => !c.pass)) process.exit(1);
} else { console.error('usage: harness run|assert [--seeds N] [--years Y] [--policy forager|farmer|sensible] [--pop N] [--out DIR]'); process.exit(2); }
