/** Turn a chief's JSON into valid sim orders. Invalid orders are dropped with a reason, never repaired silently. */
import { K, type HostAnswer, type Order, type Task } from '@wind-spirit/sim';
import { DIRS, type VillageView } from './view.js';
import type { ChiefDecisionJson, HostDecisionJson } from './schema.js';

export interface Parsed { orders: Order[]; dropped: string[]; journal: string; memoryNotes: string[]; replyToSpirit?: string; verdicts: { claim: number; verdict: 'fulfilled' | 'failed' | 'unverifiable' }[]; }

const TASKS: Task[] = ['forage', 'hunt', 'fish', 'gather', 'clear', 'farm', 'build', 'craft', 'research', 'road', 'explore', 'colonize', 'envoy', 'raid', 'rest'];

function lookup(map: Record<string, string>, name: string | undefined): string | undefined {
  if (!name) return undefined; const k = name.trim().toLowerCase(); if (map[k]) return map[k];
  // tolerate partial matches like "wheat" for "vaikan wheat"
  const hit = Object.keys(map).filter(n => n.includes(k) || k.includes(n)); return hit.length === 1 ? map[hit[0]] : undefined;
}
function goodsToIds(map: Record<string, string>, g: Record<string, number> | undefined, dropped: string[]): string {
  if (!g) return ''; const parts: string[] = [];
  for (const [n, q] of Object.entries(g)) { const id = lookup(map, n); if (!id) { dropped.push(`unknown goods "${n}"`); continue; } if (q > 0) parts.push(`${id}:${Math.trunc(q * K)}`); }
  return parts.join(',');
}

export function parseDecision(view: VillageView, json: ChiefDecisionJson): Parsed {
  const dropped: string[] = []; const orders: Order[] = [];
  let budget = view.people.workersFree;
  const names = view.names;
  for (const o of json.orders ?? []) {
    const task = String(o.task) as Task;
    if (!TASKS.includes(task)) { dropped.push(`unknown task ${o.task}`); continue; }
    let workers = Math.max(0, Math.trunc(Number(o.workers) || 0));
    if (task !== 'colonize' && workers === 0) { dropped.push(`${task}: no workers`); continue; }
    if (workers > budget) { workers = budget; if (workers === 0) { dropped.push(`${task}: no adults left to assign`); continue; } }
    const params: Record<string, number | string> = {};
    switch (task) {
      case 'gather': { const id = lookup(names.commodities, o.commodity); if (!id) { dropped.push(`gather: unknown commodity "${o.commodity}"`); continue; } params.c = id; break; }
      case 'build': case 'craft': { const id = lookup(names.recipes, o.recipe); if (!id || !view.recipes.some(r => r.id === id)) { dropped.push(`${task}: unknown recipe "${o.recipe}"`); continue; } params.recipe = id; if (task === 'craft') params.qty = Math.max(0, Math.trunc((Number(o.quantity) || 0) * K)); break; }
      case 'research': { const ings = (o.ingredients ?? []).map(n => lookup(names.commodities, n) ?? lookup(names.capabilities, n)).filter((x): x is string => !!x); if (!ings.length) { dropped.push(`research: no known ingredients in ${JSON.stringify(o.ingredients)}`); continue; } params.ingredients = ings.slice(0, 3).join(','); break; }
      case 'farm': { params.plots = Math.max(0, Math.trunc(Number(o.plots) || 0)); const crop = lookup(names.commodities, o.crop) ?? 'grain'; params.crop = crop; break; }
      case 'explore': { const d = DIRS.find(x => x[0] === String(o.direction ?? '').toLowerCase()); if (!d) { dropped.push(`explore: unknown direction "${o.direction}"`); continue; } params.dx = d[1]; params.dy = d[2]; params.dist = Math.max(1, Math.min(20, Math.trunc((Number(o.days) || 4) * 3))); break; }
      case 'colonize': { const site = view.sites.find(s => s.index === Number(o.site)); if (!site) { dropped.push(`colonize: no site ${o.site}`); continue; } params.tile = site.tile; params.share = Math.trunc(Math.max(0.2, Math.min(0.6, Number(o.share) || 0.4)) * K); break; }
      case 'road': { const site = view.roadSites.find(s => s.index === Number(o.roadSite)); if (!site) { dropped.push(`road: no site ${o.roadSite}`); continue; } params.tile = site.tile; break; }
      case 'envoy': case 'raid': {
        const vid = names.villages[String(o.village ?? '').trim().toLowerCase()]; if (vid === undefined || !view.villages.some(x => x.id === vid)) { dropped.push(`${task}: unknown village "${o.village}"`); continue; }
        params.target = vid;
        if (task === 'envoy') { params.offer = goodsToIds(names.commodities, o.offer, dropped); params.want = goodsToIds(names.commodities, o.want, dropped); params.floor = Math.trunc(Math.max(0, Math.min(1, Number(o.floor) || 0.7)) * K); const tr = lookup(names.recipes, o.transfer); if (tr) params.transfer = tr; if (o.threat) params.threat = 1; if (o.message) params.message = String(o.message).slice(0, 300); }
        break;
      }
      default: break;
    }
    if (task !== 'colonize') budget -= workers;
    orders.push({ task, workers, params, since: 0 });
  }
  return { orders, dropped, journal: String(json.journal ?? '').slice(0, 1200), memoryNotes: (json.memoryNotes ?? []).map(s => String(s).slice(0, 200)).slice(0, 12), replyToSpirit: json.replyToSpirit ? String(json.replyToSpirit).slice(0, 600) : undefined, verdicts: (json.verdicts ?? []).filter(x => x && Number.isInteger(x.claim) && ['fulfilled', 'failed', 'unverifiable'].includes(x.verdict)).slice(0, 10) };
}

export function parseHostDecision(view: VillageView, json: HostDecisionJson): { answer: HostAnswer; journal: string; dropped: string[] } {
  const dropped: string[] = []; const toGoods = (g?: Record<string, number>) => { const out: Record<string, number> = {}; for (const [n, q] of Object.entries(g ?? {})) { const id = lookup(view.names.commodities, n); if (!id) { dropped.push(`unknown goods "${n}"`); continue; } if (q > 0) out[id] = Math.trunc(q * K); } return out; };
  const journal = String(json.journal ?? '').slice(0, 800);
  if (json.answer === 'accept') return { answer: { kind: 'accept' }, journal, dropped };
  if (json.answer === 'counter') return { answer: { kind: 'counter', give: toGoods(json.give), take: toGoods(json.take) }, journal, dropped };
  return { answer: { kind: 'refuse', reason: String(json.reason ?? '').slice(0, 200) }, journal, dropped };
}
