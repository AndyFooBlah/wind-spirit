/**
 * The village view: everything a chief is allowed to know, in prompt-ready form.
 * Built only from the village's own knowledge. Nothing about tiers, budgets, or unseen tiles leaks.
 */
import {
  K, P, TERRAIN, TILE_MILES, WEEKS_PER_YEAR, commodityById, hasCap, isPath, neighbors, popCounts, recipeById, seasonOf, shelter, stageOf, storeQty, storesWeeks, structures, tileDistance, xy, yearOf, storageMult,
  type Event, type Recipe, type Village, type World, type Commodity,
} from '@wind-spirit/sim';

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const DIRS: [string, number, number][] = [['north', 0, -1], ['northeast', 1, -1], ['east', 1, 0], ['southeast', 1, 1], ['south', 0, 1], ['southwest', -1, 1], ['west', -1, 0], ['northwest', -1, -1]];

export function directionOf(w: World, from: number, to: number): string {
  const [fx, fy] = xy(w, from), [tx, ty] = xy(w, to); const dx = tx - fx, dy = ty - fy;
  if (dx === 0 && dy === 0) return 'here';
  const a = Math.atan2(dy, dx); const i = Math.round((a / (Math.PI / 4)) + 2) % 8; // 0=north
  return DIRS[(i + 8) % 8][0];
}
const units = (q: number) => Math.round(q / K);

export interface StoreLine { name: string; units: number; category: string; food: boolean; keeps: string; }
export interface RecipeLine { id: string; name: string; inputs: string; requires?: string; makes: string; canMakeNow: boolean; held: boolean; tier?: undefined; }
export interface VillageLine { id: number; name: string; direction: string; days: number; sizeSeen: number; lastSeenYearsAgo: number; trades: number; raids: number; grudge: string; }
export interface SiteLine { index: number; tile: number; direction: string; days: number; terrain: string; food: string; water: boolean; }

export interface VillageView {
  seed: string; tick: number; year: number; season: string; week: number;
  village: { id: number; name: string; founded: number; chiefTraits: number[]; culture: number[] };
  people: { total: number; children: number; adults: number; elders: number; workersFree: number; hungryNow: number; deathsRecent: number; happiness: string; shelterWords: string; calmWeeks: number };
  stores: StoreLine[]; foodWeeks: number; storageWords: string;
  plots: { cleared: number; planted: number; free: number; structures: string[] };
  capabilities: string[];
  recipes: RecipeLine[];
  rumors: string[];                         // hint sentences for recipes not yet known
  commodities: { name: string; category: string; where: string }[];   // known commodities and where to get them
  crops: string[];
  surroundings: string;                     // terrain summary within 2 tiles, by direction
  villages: VillageLine[];
  sites: SiteLine[];
  roadSites: { index: number; tile: number; direction: string }[];
  parties: { kind: string; size: number; weeksOut: number; destination: string; status: string }[];
  orders: string[];
  events: string[];
  memory: string[];
  spirit: { attitude: string; trust: number; pending: string[]; chronicle: string[] };
  names: { commodities: Record<string, string>; recipes: Record<string, string>; villages: Record<string, number>; capabilities: Record<string, string> };   // name -> id maps for the parser
}

export interface ViewOpts { events: Event[]; capNames: Record<string, string>; pendingSpirit?: string[]; chronicle?: string[]; }

export function buildView(w: World, v: Village, o: ViewOpts): VillageView {
  const tick = w.tick; const counts = popCounts(v, tick);
  const capName = (c: string) => o.capNames[c] ?? c;
  const cname = (id: string) => commodityById(w, id)?.name ?? id;
  const rname = (id: string) => recipeById(w, id)?.name ?? id;
  const mult = storageMult(w, v);
  const stores: StoreLine[] = [];
  const byC = new Map<string, number>(); for (const s of v.stores) byC.set(s.c, (byC.get(s.c) ?? 0) + s.qty);
  for (const [c, q] of byC) { const cm = commodityById(w, c); if (!cm || q < 500) continue; const limit = cm.perish === 0 ? 0 : Math.trunc(cm.perish * mult / K); stores.push({ name: cm.name, units: units(q), category: cm.category, food: cm.food > 0, keeps: limit === 0 ? 'keeps' : `about ${limit} weeks` }); }
  stores.sort((a, b) => b.units - a.units);
  let cleared = 0, planted = 0, free = 0; const structs: Record<string, number> = {};
  for (const p of v.plots) { if (p.kind === 'clear' || p.kind === 'field') { cleared++; if (p.planted) planted++; else if (p.recipe === '') free++; } if (p.kind === 'structure') structs[rname(p.recipe)] = (structs[rname(p.recipe)] ?? 0) + 1; }
  const recipes: RecipeLine[] = v.recipes.map(id => recipeById(w, id)).filter((r): r is Recipe => !!r).map(r => ({
    id: r.id, name: r.name, inputs: r.inputs.map(i => `${units(i.qty)} ${cname(i.c)}`).join(', ') || 'nothing',
    requires: r.requires ? capName(r.requires) : undefined,
    makes: r.output.capability ? `the skill: ${capName(r.output.capability)}` : r.output.structure ? 'a building' : r.output.crop ? `a crop to plant: ${cname(r.output.crop)}` : r.output.commodity ? `${units(r.output.commodity.qty)} ${cname(r.output.commodity.c)}` : '',
    canMakeNow: (!r.requires || hasCap(v, r.requires)) && r.inputs.every(i => storeQty(v, i.c) >= i.qty),
    held: !!r.output.capability && hasCap(v, r.output.capability),
    tier: undefined,
  }));
  const rumors: string[] = [];
  for (const r of w.recipes) if (!v.recipes.includes(r.id)) { const k = v.hints[r.id] ?? 0; for (let i = 0; i < k && i < r.hints.length; i++) rumors.push(r.hints[i]); }
  const near = new Set(neighbors(w, v.tile, 2, true));
  const commodities = v.known.map(id => commodityById(w, id)).filter((c): c is Commodity => !!c).map(c => {
    let where = 'made';
    if (c.source) where = c.source === 'fish' ? (neighbors(w, v.tile, 1, true).some(t => w.tiles[t].cap.fish > 0) ? 'nearby water' : 'not here') : 'the land around us';
    else if (c.regional) { const tiles = v.knowledge.tiles.filter(t => w.tiles[t].extra[c.id]); where = tiles.some(t => near.has(t)) ? 'within a day of the village' : tiles.length ? `far: ${directionOf(w, v.tile, tiles[0])}, ${Math.ceil(tileDistance(w, v.tile, tiles[0]) * TILE_MILES / 15)} days` : 'heard of, never seen'; }
    else if (c.id === 'grain' || c.crop) where = 'grown in fields';
    return { name: c.name, category: c.category, where };
  });
  const crops = w.commodities.filter(c => c.crop && (c.id === 'grain' || v.recipes.some(id => recipeById(w, id)?.output.crop === c.id))).map(c => c.name);
  // surroundings by direction
  const dirCounts: Record<string, Record<string, number>> = {};
  for (const t of neighbors(w, v.tile, 2)) { const d = directionOf(w, v.tile, t); (dirCounts[d] ??= {})[w.tiles[t].terrain] = ((dirCounts[d] ??= {})[w.tiles[t].terrain] ?? 0) + 1; }
  const surroundings = DIRS.map(([d]) => { const c = dirCounts[d]; if (!c) return ''; return `${d}: ${Object.entries(c).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}${n > 1 ? ` ×${n}` : ''}`).join(', ')}`; }).filter(Boolean).join('; ');
  const villages: VillageLine[] = v.knowledge.villages.filter(id => id !== v.id).map(id => { const o2 = w.villages[id]; const r = v.relations[id]; if (!o2) return null; const d = tileDistance(w, v.tile, o2.tile); return { id, name: o2.name, direction: directionOf(w, v.tile, o2.tile), days: Math.max(1, Math.ceil(d * TILE_MILES / 15)), sizeSeen: r?.sizeSeen ?? 0, lastSeenYearsAgo: r && r.lastContact >= 0 ? Math.floor((tick - r.lastContact) / WEEKS_PER_YEAR) : 99, trades: r?.trades ?? 0, raids: r?.raids ?? 0, grudge: !r || r.grudge === 0 ? 'none' : r.grudge < 300 ? 'some' : r.grudge < 700 ? 'deep' : 'bitter' }; }).filter((x): x is VillageLine => !!x);
  // colony sites: known, habitable, empty, 6-15 tiles away, best food first
  const sites: SiteLine[] = v.knowledge.tiles.filter(t => { const tile = w.tiles[t]; const info = TERRAIN[tile.terrain]; if (!info.passable || !info.forage || tile.village !== -1 || tile.terrain === 'mountain') return false; const d = tileDistance(w, v.tile, t); if (d < 6 || d > 15) return false; return !w.villages.some(o2 => o2.alive && tileDistance(w, o2.tile, t) < 5); })
    .map(t => { let food = 0; let water = false; for (const nb of neighbors(w, t, 1, true)) { const c = w.tiles[nb].cap; food += c.plants + c.game + c.fish; if (TERRAIN[w.tiles[nb].terrain].water || w.tiles[nb].terrain === 'river' || w.tiles[nb].terrain === 'coast') water = true; } return { t, food, water }; })
    .sort((a, b) => b.food - a.food).slice(0, 5).map((s, i) => ({ index: i + 1, tile: s.t, direction: directionOf(w, v.tile, s.t), days: Math.ceil(tileDistance(w, v.tile, s.t) * TILE_MILES / 15), terrain: w.tiles[s.t].terrain, food: s.food > 4_000_000 ? 'rich' : s.food > 2_500_000 ? 'fair' : 'poor', water: s.water }));
  const roadSites = hasCap(v, 'roadbuilding') ? neighbors(w, v.tile, 3).filter(t => !w.tiles[t].road && w.tiles[t].trodden >= P.roadAt && TERRAIN[w.tiles[t].terrain].passable).slice(0, 5).map((t, i) => ({ index: i + 1, tile: t, direction: directionOf(w, v.tile, t) })) : [];
  const parties = w.parties.filter(p => p.home === v.id).map(p => ({ kind: p.kind, size: p.members.length, weeksOut: 0, destination: p.targetVillage !== undefined ? (w.villages[p.targetVillage]?.name ?? '?') : directionOf(w, v.tile, p.target), status: p.waiting > 0 ? 'waiting for an answer' : p.returning ? 'coming home' : 'travelling' }));
  const orders = v.orders.map(o2 => `${o2.workers} ${o2.task}${Object.keys(o2.params).length ? ' ' + Object.entries(o2.params).filter(([k]) => k !== 'made').map(([k, val]) => `${k}=${k === 'recipe' || k === 'transfer' ? rname(String(val)) : k === 'c' || k === 'crop' ? cname(String(val)) : k === 'target' ? (w.villages[Number(val)]?.name ?? val) : k === 'ingredients' ? String(val).split(',').map(x => o.capNames[x] ?? cname(x)).join(' + ') : val}`).join(' ') : ''}${o2.task === 'research' && tick - o2.since >= 13 ? ` (${Math.floor((tick - o2.since) / 13)} seasons of this with nothing to show; try something else)` : ''}`);
  const sh = shelter(w, v);
  const view: VillageView = {
    seed: w.seed, tick, year: yearOf(tick), season: SEASONS[seasonOf(tick)], week: (tick % 13) + 1,
    village: { id: v.id, name: v.name, founded: yearOf(v.founded), chiefTraits: v.chiefTraits, culture: v.culture },
    people: { total: counts.total, children: counts.children, adults: counts.adults, elders: counts.elders, workersFree: Math.max(0, counts.adults - 1), hungryNow: v.hungryWeek, deathsRecent: v.recentDeaths.reduce((a, b) => a + b, 0), happiness: words(v.happiness, ['wretched', 'unhappy', 'uneasy', 'content', 'glad', 'joyful']), shelterWords: sh.capacity >= counts.total ? (sh.score >= 900 ? 'everyone sleeps warm' : 'everyone has shelter, some of it poor') : `${counts.total - sh.capacity} people have no roof`, calmWeeks: v.calmWeeks },
    stores, foodWeeks: storesWeeks(w, v), storageWords: mult >= 4000 ? 'food keeps well' : mult >= 2000 ? 'food keeps a while' : 'fresh food spoils fast',
    plots: { cleared, planted, free, structures: Object.entries(structs).map(([n, c]) => `${c} ${n}`) },
    capabilities: v.capabilities.map(capName), recipes, rumors, commodities, crops, surroundings, villages, sites, roadSites, parties, orders,
    events: renderEvents(w, v, o.events, cname, rname, capName),
    memory: [...v.memory],
    spirit: { attitude: trustWords(v.trust, v.chiefTraits[0]), trust: v.trust, pending: o.pendingSpirit ?? [], chronicle: o.chronicle ?? [] },
    names: { commodities: Object.fromEntries(w.commodities.map(c => [c.name.toLowerCase(), c.id])), recipes: Object.fromEntries(w.recipes.map(r => [r.name.toLowerCase(), r.id])), villages: Object.fromEntries(w.villages.map(x => [x.name.toLowerCase(), x.id])), capabilities: Object.fromEntries(Object.entries(o.capNames).map(([k, n]) => [n.toLowerCase(), k])) },
  };
  return view;
}

function words(x: number, scale: string[]): string { const i = Math.min(scale.length - 1, Math.floor((x / K) * scale.length)); return scale[Math.max(0, i)]; }
export function trustWords(trust: number, piety: number): string {
  if (trust >= 800) return 'you revere the spirit and act on its word';
  if (trust >= 600) return 'you trust the spirit and weigh its word heavily';
  if (trust >= 400) return piety > 600 ? 'you want to believe the spirit but need proof' : 'you listen to the spirit but judge for yourself';
  if (trust >= 200) return 'you doubt the spirit; its word is one voice among many';
  return piety > 600 ? 'you fear the spirit may be false; you test its words' : 'you dismiss the spirit unless it proves itself';
}

export function renderEvents(w: World, v: Village, events: Event[], cname: (id: string) => string, rname: (id: string) => string, capName: (c: string) => string): string[] {
  const out: string[] = []; const y = (t: number) => `year ${yearOf(t)}, ${SEASONS[seasonOf(t)]}`;
  const agg: Record<string, number> = {};
  for (const e of events) {
    switch (e.type) {
      case 'Born': if (e.village === v.id) agg.births = (agg.births ?? 0) + 1; break;
      case 'Died': if (e.village === v.id) agg[`died-${e.cause}`] = (agg[`died-${e.cause}`] ?? 0) + 1; break;
      case 'Harvested': if (e.village === v.id) out.push(`${y(e.t)}: harvest of ${units(e.qty)} units from ${e.plots} plots`); break;
      case 'Discovered': if (e.village === v.id) out.push(`${y(e.t)}: we learned ${rname(e.recipe)} (${e.how === 'accident' ? 'by chance' : e.how === 'transfer' ? 'from visitors' : 'by trying'})`); break;
      case 'HintRevealed': if (e.village === v.id) out.push(`${y(e.t)}: someone noticed: "${e.hint}"`); break;
      case 'CapabilityGained': if (e.village === v.id) out.push(`${y(e.t)}: we now have ${capName(e.capability)}`); break;
      case 'Built': if (e.village === v.id) out.push(`${y(e.t)}: finished building ${rname(e.recipe)}`); break;
      case 'Crafted': if (e.village === v.id) agg[`made-${e.recipe}`] = (agg[`made-${e.recipe}`] ?? 0) + e.qty; break;
      case 'ChiefSucceeded': if (e.village === v.id) out.push(`${y(e.t)}: a new chief was chosen ${e.reason === 'coup' ? 'after the village lost patience' : 'after a death'}`); break;
      case 'PartyReturned': if (e.village === v.id) out.push(`${y(e.t)}: a party came home having seen ${e.tilesSeen} places`); break;
      case 'PartyLost': if (e.village === v.id) out.push(`${y(e.t)}: a party was lost and never returned`); break;
      case 'VillageFounded': if (e.parent === v.id) out.push(`${y(e.t)}: our people founded ${w.villages[e.village]?.name ?? 'a new village'} to the ${directionOf(w, v.tile, e.tile)}`); break;
      case 'Famine': if (e.village === v.id) out.push(`${y(e.t)}: ${e.hungry} people went hungry`); break;
      case 'VisitorArrived': if (e.village === v.id) out.push(`${y(e.t)}: envoys from ${w.villages[e.from]?.name} arrived`); break;
      case 'TradeCompleted': if (e.village === v.id) out.push(`${y(e.t)}: traded with ${w.villages[e.guest]?.name}: gave ${goods(e.gave, cname)}, got ${goods(e.got, cname)}`); else if (w.villages[e.guest]?.id === v.id) out.push(`${y(e.t)}: our envoys traded with ${w.villages[e.village]?.name}: gave ${goods(e.got, cname)}, got ${goods(e.gave, cname)}`); break;
      case 'TradeRefused': if (e.village === v.id) out.push(`${y(e.t)}: we refused ${w.villages[e.guest]?.name}'s envoys (${e.reason})`); else if (e.guest === v.id) out.push(`${y(e.t)}: ${w.villages[e.village]?.name} refused our envoys (${e.reason})`); break;
      case 'TechTransferred': if (e.village === v.id) out.push(`${y(e.t)}: visitors from ${w.villages[e.from]?.name} taught us ${rname(e.recipe)}`); break;
      case 'TributePaid': if (e.village === v.id) out.push(`${y(e.t)}: we paid tribute to ${w.villages[e.to]?.name}: ${goods(e.goods, cname)}`); else if (e.to === v.id) out.push(`${y(e.t)}: ${w.villages[e.village]?.name} paid us tribute: ${goods(e.goods, cname)}`); break;
      case 'RaidResolved': if (e.defender === v.id) out.push(`${y(e.t)}: raiders from ${w.villages[e.attacker]?.name} ${e.success ? `struck us and took ${goods(e.taken, cname)}` : 'attacked and were driven off'}; we lost ${e.defendersLost}, they lost ${e.attackersLost}`); else if (e.attacker === v.id) out.push(`${y(e.t)}: our raid on ${w.villages[e.defender]?.name} ${e.success ? `succeeded; we took ${goods(e.taken, cname)}` : 'failed'}; we lost ${e.attackersLost}${e.destroyed ? '; the village is no more' : ''}`); break;
      case 'RoadBuilt': if (e.village === v.id) out.push(`${y(e.t)}: a road was laid to the ${directionOf(w, v.tile, e.tile)}`); break;
      case 'WeatherRolled': if (e.roll !== 'normal' && e.season === Math.floor(e.t / 13)) out.push(`${y(e.t)}: the season turned ${e.roll === 'hard' ? 'bitterly cold' : e.roll === 'drought' ? 'dry' : e.roll === 'wet' ? 'wet' : 'stormy'}`); break;
      default: break;
    }
  }
  if (agg.births) out.push(`${agg.births} children were born`);
  for (const [k, n] of Object.entries(agg)) if (k.startsWith('died-')) out.push(`${n} died of ${k.slice(5) === 'age' ? 'age or sickness' : k.slice(5) === 'hunger' ? 'hunger' : k.slice(5) === 'raid' ? 'fighting' : 'the road'}`);
  for (const [k, n] of Object.entries(agg)) if (k.startsWith('made-')) out.push(`we made ${units(n)} ${rname(k.slice(5))}`);
  return out.slice(-30);
}
function goods(g: Record<string, number>, cname: (id: string) => string): string { const parts = Object.entries(g).filter(([, q]) => q > 0).map(([c, q]) => `${units(q)} ${cname(c)}`); return parts.length ? parts.join(', ') : 'nothing'; }
export { isPath, stageOf, structures };
