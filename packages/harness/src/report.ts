import type { RunResult, YearRow } from './run.js';

export interface Check { name: string; pass: boolean; detail: string; }

function median(xs: number[]): number { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
function quantile(xs: number[], q: number): number { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }

/** Per-year aggregate over seeds of a per-seed reducer. */
function series(results: RunResult[], f: (rows: YearRow[]) => number): { median: number[]; lo: number[]; hi: number[] } {
  const years = results[0]?.years ?? 0; const median_: number[] = [], lo: number[] = [], hi: number[] = [];
  for (let y = 0; y < years; y++) {
    const vals = results.map(r => f(r.rows.filter(row => row.year === y)));
    median_.push(median(vals)); lo.push(quantile(vals, 0.1)); hi.push(quantile(vals, 0.9));
  }
  return { median: median_, lo, hi };
}

function svgLines(title: string, seriesList: { name: string; color: string; ys: number[]; band?: { lo: number[]; hi: number[] } }[], w = 720, h = 240): string {
  const pad = 40; const n = Math.max(...seriesList.map(s => s.ys.length), 1);
  const maxY = Math.max(1, ...seriesList.flatMap(s => [...s.ys, ...(s.band?.hi ?? [])]));
  const x = (i: number) => pad + (i * (w - pad - 10)) / Math.max(1, n - 1); const y = (v: number) => h - pad + 10 - (v * (h - pad - 20)) / maxY;
  const parts: string[] = [`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="chart"><text x="${pad}" y="18" class="t">${title}</text>`];
  for (let g = 0; g <= 4; g++) { const v = (maxY * g) / 4; parts.push(`<line x1="${pad}" x2="${w - 10}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${pad - 6}" y="${y(v) + 4}" class="a" text-anchor="end">${Math.round(v)}</text>`); }
  for (let i = 0; i < n; i += Math.max(1, Math.round(n / 6))) parts.push(`<text x="${x(i)}" y="${h - 8}" class="a" text-anchor="middle">${i}</text>`);
  for (const s of seriesList) {
    if (s.band) { const up = s.band.hi.map((v, i) => `${x(i)},${y(v)}`); const down = s.band.lo.map((v, i) => `${x(i)},${y(v)}`).reverse(); parts.push(`<polygon points="${[...up, ...down].join(' ')}" fill="${s.color}" opacity="0.15"/>`); }
    parts.push(`<polyline points="${s.ys.map((v, i) => `${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="1.8"/>`);
  }
  let lx = pad; for (const s of seriesList) { parts.push(`<rect x="${lx}" y="26" width="10" height="10" fill="${s.color}"/><text x="${lx + 14}" y="35" class="a">${s.name}</text>`); lx += 22 + s.name.length * 8; }
  parts.push('</svg>'); return parts.join('');
}

export function buildReport(results: RunResult[], checks: Check[], title: string): string {
  const pop = series(results, rows => rows.reduce((a, r) => a + (r.alive ? r.pop : 0), 0));
  const villages = series(results, rows => rows.filter(r => r.alive).length);
  const src = (k: keyof YearRow, scale = 1) => series(results, rows => rows.reduce((a, r) => a + Number(r[k]), 0) / scale);
  const forage = src('forage', 1000), hunt = src('hunt', 1000), fish = src('fish', 1000), farm = src('farm', 1000), spoiled = src('spoiled', 1000);
  const dAge = src('deathsAge'), dHunger = src('deathsHunger'), dTravel = src('deathsTravel'), dRaid = src('deathsRaid'), births = src('births');
  const happy = series(results, rows => { const a = rows.filter(r => r.alive); return a.length ? a.reduce((s, r) => s + r.happiness, 0) / a.length : 0; });
  const stores = series(results, rows => { const a = rows.filter(r => r.alive); return a.length ? a.reduce((s, r) => s + r.storesWeeks, 0) / a.length : 0; });
  const perSeed = results.map(r => `<tr><td>${r.seed}</td><td>${r.finalVillages}</td><td>${r.finalPop}</td><td>${r.peakPop}</td><td>${r.villagesFounded}</td><td>${r.firstColonyYear < 0 ? '—' : r.firstColonyYear}</td><td>${r.pathTiles}</td><td>${r.hash.slice(0, 10)}</td><td>${r.replayHash ? (r.replayHash === r.hash ? 'ok' : 'MISMATCH') : ''}</td><td>${r.ms}</td></tr>`).join('');
  const checkRows = checks.map(c => `<tr class="${c.pass ? 'ok' : 'fail'}"><td>${c.pass ? 'PASS' : 'FAIL'}</td><td>${c.name}</td><td>${c.detail}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
body{font:15px/1.5 system-ui,sans-serif;margin:24px;color:#1f2a2e;background:#f4f6f5;max-width:1100px}
h1{font-weight:600}h2{font-weight:600;font-size:18px;margin-top:32px}
.chart{background:#fff;border:1px solid #d8dedd;margin:8px 0;display:block}.t{font-size:13px;font-weight:600}.a{font-size:10px;fill:#666}.g{stroke:#e5e9e8}
table{border-collapse:collapse;font-size:13px;background:#fff}td,th{border:1px solid #d8dedd;padding:4px 8px;text-align:left}
tr.ok td:first-child{color:#1d7a3f;font-weight:600}tr.fail td:first-child{color:#b3261e;font-weight:600}
</style></head><body><h1>${title}</h1>
<p>${results.length} seeds × ${results[0]?.years ?? 0} years, policy <b>${results[0]?.policy}</b>. Bands are 10th–90th percentile across seeds; lines are medians. Food in person-weeks per year.</p>
${checks.length ? `<h2>Checks</h2><table><tr><th></th><th>Check</th><th>Detail</th></tr>${checkRows}</table>` : ''}
${svgLines('Total population (all villages)', [{ name: 'population', color: '#2f6f7a', ys: pop.median, band: pop }])}
${svgLines('Villages alive', [{ name: 'villages', color: '#8c5f2a', ys: villages.median, band: villages }])}
${svgLines('Food produced per year by source', [{ name: 'forage', color: '#4c9a2a', ys: forage.median }, { name: 'hunt', color: '#a0522d', ys: hunt.median }, { name: 'fish', color: '#2f6f7a', ys: fish.median }, { name: 'farm', color: '#c9a227', ys: farm.median }, { name: 'spoiled', color: '#999', ys: spoiled.median }])}
${svgLines('Births and deaths per year', [{ name: 'births', color: '#2f6f7a', ys: births.median }, { name: 'age', color: '#777', ys: dAge.median }, { name: 'hunger', color: '#b3261e', ys: dHunger.median }, { name: 'travel', color: '#e08a1e', ys: dTravel.median }, { name: 'raid', color: '#5b3a8c', ys: dRaid.median }])}
${svgLines('Mean happiness (thousandths) and stores (weeks)', [{ name: 'happiness', color: '#2f6f7a', ys: happy.median }, { name: 'stores weeks ×10', color: '#c9a227', ys: stores.median.map(v => v * 10) }])}
<h2>Per seed</h2><table><tr><th>seed</th><th>villages</th><th>final pop</th><th>peak village</th><th>founded</th><th>first colony yr</th><th>path tiles</th><th>hash</th><th>replay</th><th>ms</th></tr>${perSeed}</table>
</body></html>`;
}

export { median, quantile };
