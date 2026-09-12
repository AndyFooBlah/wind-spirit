/**
 * Tech tree: a hand-written skeleton (tiers, slots, category constraints) filled with seeded leaves
 * (concrete inputs, names, numbers, hints). The sim consumes numeric effects; names exist for chiefs and players.
 */
import { Rng, type Capability, type Category, type Commodity, type Recipe, type Terrain } from '@wind-spirit/sim';
import { name as mkName } from './names.js';

// ---------- raw commodities ----------

/** Ubiquitous raw commodities drawn from the five tile stock classes, plus hide as a hunting byproduct and the staple grain. */
export const UBIQUITOUS: Commodity[] = [
  { id: 'plants', name: 'wild plants', category: 'fruit', food: 1000, perish: 4, novelty: 1, weight: 1000, source: 'plants' },
  { id: 'meat', name: 'meat', category: 'meat', food: 1000, perish: 2, novelty: 1, weight: 1000, source: 'game' },
  { id: 'fish', name: 'fish', category: 'fish', food: 1000, perish: 2, novelty: 1, weight: 1000, source: 'fish' },
  { id: 'wood', name: 'wood', category: 'wood', food: 0, perish: 0, novelty: 0, weight: 3000, source: 'timber' },
  { id: 'stone', name: 'stone', category: 'stone', food: 0, perish: 0, novelty: 0, weight: 5000, source: 'stone' },
  { id: 'hide', name: 'hide', category: 'hide', food: 0, perish: 0, novelty: 0, weight: 1500 },
];

/** Regional raw archetypes. Each world picks a subset, names them, and places them in blobs. */
interface Archetype { key: string; category: Category; terrains: Terrain[]; cap: number; food: number; perish: number; novelty: number; morphemes: string[]; required?: boolean; }
const ARCHETYPES: Archetype[] = [
  { key: 'berry', category: 'fruit', terrains: ['forest', 'hills', 'marsh'], cap: 300, food: 1000, perish: 3, novelty: 4, morphemes: ['berry', 'berries', 'plum'] },
  { key: 'nut', category: 'fruit', terrains: ['forest', 'hills'], cap: 250, food: 1200, perish: 26, novelty: 3, morphemes: ['nut', 'nuts', 'kernel'] },
  { key: 'tuber', category: 'root', terrains: ['grass', 'marsh', 'river'], cap: 350, food: 1000, perish: 8, novelty: 2, morphemes: ['root', 'tuber'] },
  { key: 'herb', category: 'herb', terrains: ['hills', 'forest', 'grass'], cap: 150, food: 0, perish: 12, novelty: 2, morphemes: ['leaf', 'herb', 'moss'], required: true },
  { key: 'fiberplant', category: 'fiber', terrains: ['grass', 'river', 'marsh'], cap: 300, food: 0, perish: 0, novelty: 0, morphemes: ['flax', 'grass', 'reed'], required: true },
  { key: 'reed', category: 'fiber', terrains: ['marsh', 'river', 'lake', 'coast'], cap: 400, food: 0, perish: 0, novelty: 0, morphemes: ['reed', 'rush', 'sedge'] },
  { key: 'clay', category: 'clay', terrains: ['river', 'marsh', 'coast', 'lake'], cap: 600, food: 0, perish: 0, novelty: 0, morphemes: ['clay', 'mud'], required: true },
  { key: 'salt', category: 'salt', terrains: ['coast', 'desert', 'oasis'], cap: 400, food: 0, perish: 0, novelty: 1, morphemes: ['salt'], required: true },
  { key: 'flint', category: 'stone', terrains: ['hills', 'coast', 'grass'], cap: 300, food: 0, perish: 0, novelty: 0, morphemes: ['flint', 'chert'] },
  { key: 'copper', category: 'ore', terrains: ['hills', 'mountain'], cap: 500, food: 0, perish: 0, novelty: 0, morphemes: ['ore'], required: true },
  { key: 'tin', category: 'ore', terrains: ['hills', 'mountain'], cap: 300, food: 0, perish: 0, novelty: 0, morphemes: ['ore', 'grit'], required: true },
  { key: 'dye', category: 'herb', terrains: ['forest', 'marsh'], cap: 150, food: 0, perish: 20, novelty: 3, morphemes: ['bloom', 'lichen'] },
  { key: 'shellfish', category: 'fish', terrains: ['coast'], cap: 400, food: 1000, perish: 1, novelty: 3, morphemes: ['clam', 'shell', 'mussel'] },
  { key: 'honey', category: 'food', terrains: ['forest', 'grass'], cap: 100, food: 1500, perish: 0, novelty: 6, morphemes: ['honey', 'nectar'] },
];

// ---------- skeleton ----------

type Cat = Category | `cap:${Capability}`;
interface Slot {
  key: string; tier: 1 | 2 | 3 | 4;
  inputs: { cat: Category[]; qty: number }[];       // each input: pick one commodity among these categories
  requires?: Capability;
  labor: number;
  out: { kind: 'capability'; cap: Capability } | { kind: 'structure'; shelter: number; quality: number; storage: number; defense?: number; watch?: boolean; morphemes: string[] }
     | { kind: 'commodity'; category: Category; food: number; perish: number; novelty: number; qty: number; morphemes: string[] }
     | { kind: 'crop'; yieldK: number; novelty: number; perish: number; morphemes: string[] };
  hints: string[];        // templates with {0},{1} for input names
  optional?: boolean;     // skipped if no commodity fits
}

const S = (key: string, tier: 1 | 2 | 3 | 4, inputs: Slot['inputs'], out: Slot['out'], labor: number, hints: string[], requires?: Capability, optional = false): Slot =>
  ({ key, tier, inputs, out, labor, hints, requires, optional });

export const SKELETON: Slot[] = [
  // tier 1: stone-age basics
  S('fire', 1, [{ cat: ['stone'], qty: 2000 }, { cat: ['wood'], qty: 2000 }], { kind: 'capability', cap: 'fire' }, 2, ['Struck {0} throws sparks onto dry {1}', 'Sparks from {0} catch in shredded {1}']),
  S('stonetools', 1, [{ cat: ['stone'], qty: 3000 }, { cat: ['wood'], qty: 1000 }], { kind: 'capability', cap: 'stonetools' }, 3, ['{0} flakes into an edge when struck just so', 'A {0} edge lashed to {1} bites deeper']),
  S('spear', 1, [{ cat: ['wood'], qty: 2000 }, { cat: ['stone'], qty: 1000 }], { kind: 'capability', cap: 'spear' }, 2, ['A hardened {0} tip goes further than a thrown stone', 'Fish hold still for a {0} point'], 'stonetools'),
  S('net', 1, [{ cat: ['fiber', 'hide'], qty: 4000 }], { kind: 'capability', cap: 'net' }, 4, ['Knotted {0} holds what water carries', 'Strips of {0} twist into cord']),
  S('paddle', 1, [{ cat: ['wood'], qty: 6000 }], { kind: 'capability', cap: 'paddle' }, 6, ['A hollowed {0} trunk floats a person', 'Burned-out {0} carries more than it weighs'], 'stonetools'),
  S('cookplant', 1, [{ cat: ['fruit', 'root', 'grain'], qty: 2000 }], { kind: 'commodity', category: 'food', food: 1200, perish: 2, novelty: 3, qty: 2000, morphemes: ['mash', 'porridge', 'cake'] }, 1, ['{0} softens in heat', 'Warmed {0} tastes sweeter'], 'fire'),
  S('roastmeat', 1, [{ cat: ['meat'], qty: 2000 }], { kind: 'commodity', category: 'food', food: 1200, perish: 3, novelty: 3, qty: 2000, morphemes: ['roast', 'sear', 'char'] }, 1, ['{0} over flame keeps a day longer'], 'fire'),
  S('cookfish', 1, [{ cat: ['fish'], qty: 2000 }], { kind: 'commodity', category: 'food', food: 1200, perish: 3, novelty: 3, qty: 2000, morphemes: ['bake', 'smoke', 'grill'] }, 1, ['{0} over embers firms and keeps'], 'fire'),
  S('hidecloak', 1, [{ cat: ['hide'], qty: 3000 }], { kind: 'commodity', category: 'cloth', food: 0, perish: 104, novelty: 3, qty: 1000, morphemes: ['cloak', 'wrap', 'mantle'] }, 2, ['Scraped {0} keeps the cold off']),
  // tier 2: settled life
  S('drying', 2, [{ cat: ['wood'], qty: 4000 }, { cat: ['fiber', 'hide'], qty: 2000 }], { kind: 'capability', cap: 'drying' }, 4, ['Food hung on {0} in wind and smoke lasts', '{1} strung between {0} poles holds a catch']),
  S('pottery', 2, [{ cat: ['clay'], qty: 4000 }], { kind: 'capability', cap: 'pottery' }, 4, ['{0} hardens in a hot fire and holds water', 'Shaped {0} keeps its shape once burned'], 'fire'),
  S('weaving', 2, [{ cat: ['fiber'], qty: 3000 }, { cat: ['wood'], qty: 2000 }], { kind: 'capability', cap: 'weaving' }, 4, ['{0} crossed over and under makes a sheet', 'A {1} frame holds {0} taut']),
  S('bread', 2, [{ cat: ['grain'], qty: 3000 }], { kind: 'commodity', category: 'food', food: 1300, perish: 8, novelty: 4, qty: 3000, morphemes: ['bread', 'loaf', 'flat'] }, 1, ['Ground {0} and water bake into something that keeps', 'Crushed {0} swells in a pot'], 'pottery'),
  S('curefish', 2, [{ cat: ['fish'], qty: 3000 }, { cat: ['salt'], qty: 500 }], { kind: 'commodity', category: 'food', food: 1000, perish: 40, novelty: 3, qty: 3000, morphemes: ['salt-fish', 'cure', 'stockfish'] }, 1, ['{1} draws the water from {0}', '{0} packed in {1} does not turn']),
  S('curemeat', 2, [{ cat: ['meat'], qty: 3000 }, { cat: ['salt'], qty: 500 }], { kind: 'commodity', category: 'food', food: 1000, perish: 40, novelty: 3, qty: 3000, morphemes: ['jerky', 'saltmeat', 'strip'] }, 1, ['{1} keeps {0} through a winter']),
  S('preserve', 2, [{ cat: ['fruit'], qty: 3000 }], { kind: 'commodity', category: 'food', food: 1100, perish: 30, novelty: 5, qty: 2500, morphemes: ['preserve', 'paste', 'jam'] }, 1, ['{0} cooked down thick keeps in a sealed pot'], 'pottery'),
  S('cloth', 2, [{ cat: ['fiber'], qty: 3000 }], { kind: 'commodity', category: 'cloth', food: 0, perish: 156, novelty: 4, qty: 1000, morphemes: ['cloth', 'weave', 'shawl'] }, 2, ['Woven {0} is lighter than hide and warmer than nothing'], 'weaving'),
  S('cart', 2, [{ cat: ['wood'], qty: 10_000 }], { kind: 'capability', cap: 'cart' }, 8, ['A {0} disc rolls where a sledge drags', 'Two {0} discs on a pole carry a load'], 'stonetools'),
  S('hull', 2, [{ cat: ['wood'], qty: 12_000 }, { cat: ['fiber', 'hide'], qty: 2000 }], { kind: 'capability', cap: 'hull' }, 10, ['{0} planks sewn with {1} make a wider boat'], 'paddle'),
  S('bow', 2, [{ cat: ['wood'], qty: 3000 }, { cat: ['fiber', 'hide'], qty: 2000 }], { kind: 'capability', cap: 'bow' }, 4, ['Bent {0} strung with {1} throws a dart', '{1} cord snaps a {0} stave straight'], 'stonetools'),
  S('medicine', 2, [{ cat: ['herb'], qty: 2000 }], { kind: 'capability', cap: 'medicine' }, 3, ['{0} steeped in hot water eases fever', 'Chewed {0} numbs a wound'], 'fire'),
  S('flute', 2, [{ cat: ['wood'], qty: 1000 }], { kind: 'commodity', category: 'instrument', food: 0, perish: 0, novelty: 6, qty: 1000, morphemes: ['flute', 'pipe', 'whistle'] }, 2, ['Hollow {0} sings when blown across'], 'stonetools'),
  S('drum', 2, [{ cat: ['hide'], qty: 2000 }, { cat: ['wood'], qty: 3000 }], { kind: 'commodity', category: 'instrument', food: 0, perish: 0, novelty: 6, qty: 1000, morphemes: ['drum', 'skin-drum'] }, 2, ['{0} stretched over hollow {1} speaks when struck']),
  S('watch', 2, [{ cat: ['wood'], qty: 15_000 }, { cat: ['stone'], qty: 5000 }], { kind: 'structure', shelter: 0, quality: 0, storage: 1000, watch: true, morphemes: ['watch', 'lookout'] }, 12, ['A {0} platform on {1} footing sees the water a day out']),
  S('palisade', 2, [{ cat: ['wood'], qty: 30_000 }], { kind: 'structure', shelter: 0, quality: 0, storage: 1000, defense: 1500, morphemes: ['palisade', 'stockade'] }, 20, ['Sharpened {0} set upright turns a rush'], 'stonetools'),
  S('domfruit', 2, [{ cat: ['fruit'], qty: 2000 }], { kind: 'crop', yieldK: 45_000, novelty: 4, perish: 6, morphemes: ['orchard', 'grove'] }, 2, ['{0} seeds set near the fields come up in spring'], 'stonetools', true),
  S('domroot', 2, [{ cat: ['root'], qty: 2000 }], { kind: 'crop', yieldK: 60_000, novelty: 3, perish: 10, morphemes: ['bed', 'patch'] }, 2, ['{0} cut and buried sprouts again'], 'stonetools', true),
  // tier 3: specialised
  S('irrigation', 3, [{ cat: ['stone'], qty: 10_000 }, { cat: ['wood'], qty: 10_000 }], { kind: 'capability', cap: 'irrigation' }, 15, ['A {0}-lined ditch carries the river to the fields', 'Fields nearest the water never wilt'], 'stonetools'),
  S('husbandry', 3, [{ cat: ['fiber', 'hide'], qty: 5000 }, { cat: ['wood'], qty: 10_000 }], { kind: 'capability', cap: 'husbandry' }, 12, ['Young game penned behind {1} grows tame', 'Dung from the pens greens the fields'], 'bow'),
  S('sail', 3, [{ cat: ['cloth'], qty: 3000 }, { cat: ['wood'], qty: 4000 }], { kind: 'capability', cap: 'sail' }, 6, ['{0} on a {1} mast pulls the hull without paddles', 'Wind fills a sheet of {0}'], 'hull'),
  S('roadbuilding', 3, [{ cat: ['stone'], qty: 8000 }], { kind: 'capability', cap: 'roadbuilding' }, 6, ['Packed {0} on a worn track stays dry in rain'], 'cart'),
  S('kiln', 3, [{ cat: ['clay'], qty: 8000 }, { cat: ['stone'], qty: 6000 }], { kind: 'capability', cap: 'kiln' }, 10, ['A closed {0} oven burns hotter than any fire', 'Heat trapped in {0} walls glows white'], 'pottery'),
  S('charcoal', 3, [{ cat: ['wood'], qty: 6000 }], { kind: 'commodity', category: 'fuel', food: 0, perish: 0, novelty: 0, qty: 2000, morphemes: ['charcoal', 'blackwood'] }, 2, ['{0} smothered while burning leaves a fuel that burns hotter'], 'kiln'),
  S('smeltcopper', 3, [{ cat: ['ore'], qty: 4000 }, { cat: ['fuel'], qty: 2000 }], { kind: 'commodity', category: 'metal', food: 0, perish: 0, novelty: 2, qty: 1000, morphemes: ['metal', 'red-metal'] }, 3, ['{0} in a {1} fire weeps a bright bead', 'Green {0} turns to something that bends'], 'kiln'),
  S('finecloth', 3, [{ cat: ['cloth'], qty: 1000 }, { cat: ['herb'], qty: 1000 }], { kind: 'commodity', category: 'cloth', food: 0, perish: 156, novelty: 7, qty: 1000, morphemes: ['dyed-cloth', 'colour-weave'] }, 2, ['{1} boiled with {0} leaves a colour that stays'], 'pottery'),
  S('brew', 3, [{ cat: ['grain', 'fruit'], qty: 3000 }], { kind: 'commodity', category: 'drink', food: 600, perish: 20, novelty: 7, qty: 2000, morphemes: ['brew', 'mead', 'ferment'] }, 1, ['{0} left in a sealed pot fizzes and warms the belly'], 'pottery'),
  S('lyre', 3, [{ cat: ['wood'], qty: 2000 }, { cat: ['fiber'], qty: 1000 }], { kind: 'commodity', category: 'instrument', food: 0, perish: 0, novelty: 8, qty: 1000, morphemes: ['lyre', 'harp', 'strings'] }, 3, ['{1} strings over a {0} frame hum when plucked'], 'weaving'),
  // tier 4: bronze and late
  S('bronze', 4, [{ cat: ['metal'], qty: 2000 }, { cat: ['ore'], qty: 1000 }], { kind: 'commodity', category: 'metal', food: 0, perish: 0, novelty: 3, qty: 1000, morphemes: ['bronze', 'hard-metal'] }, 3, ['{0} with a little {1} pours harder than either', 'A pinch of {1} makes {0} ring'], 'kiln'),
  S('metaltools', 4, [{ cat: ['metal'], qty: 3000 }, { cat: ['wood'], qty: 2000 }], { kind: 'capability', cap: 'metaltools' }, 6, ['A {0} edge outlasts a hundred stone ones', 'Cast {0} takes any shape'], 'kiln'),
  S('hook', 4, [{ cat: ['metal'], qty: 1000 }], { kind: 'capability', cap: 'hook' }, 2, ['A barbed {0} point holds what bites'], 'metaltools'),
  S('wagon', 4, [{ cat: ['wood'], qty: 20_000 }, { cat: ['metal'], qty: 2000 }], { kind: 'capability', cap: 'wagon' }, 12, ['Four {0} wheels on {1} pins haul a house'], 'metaltools'),
  S('seagoing', 4, [{ cat: ['wood'], qty: 30_000 }, { cat: ['cloth'], qty: 4000 }, { cat: ['metal'], qty: 2000 }], { kind: 'capability', cap: 'seagoing' }, 20, ['A deep {0} keel under {1} sail holds the open water'], 'sail'),
  S('bronzeweapons', 4, [{ cat: ['metal'], qty: 4000 }], { kind: 'capability', cap: 'bronzeweapons' }, 5, ['A {0} blade goes through hide like water'], 'metaltools'),
  S('plough', 4, [{ cat: ['metal'], qty: 2000 }, { cat: ['wood'], qty: 5000 }], { kind: 'capability', cap: 'plough' }, 6, ['A {0} share on a {1} beam turns the deep soil'], 'metaltools'),
  S('fineinstrument', 4, [{ cat: ['metal'], qty: 1000 }, { cat: ['wood'], qty: 1000 }], { kind: 'commodity', category: 'instrument', food: 0, perish: 0, novelty: 9, qty: 1000, morphemes: ['bell', 'horn', 'chime'] }, 3, ['{0} cast thin rings like nothing else'], 'metaltools'),
];

const CURIO_MORPHEMES = ['charm', 'beads', 'mask', 'figurine', 'dye', 'rattle', 'token', 'paint'];
const CURIO_INPUT_CATS: Category[][] = [['stone', 'fruit'], ['hide', 'herb'], ['wood', 'fiber'], ['clay', 'salt'], ['fish', 'stone'], ['fiber', 'fruit'], ['wood', 'herb'], ['stone', 'hide']];

// ---------- generator ----------

export interface TechTree { commodities: Commodity[]; recipes: Recipe[]; startRecipes: string[]; }

const CAT_MORPHEMES: Partial<Record<Category, string[]>> = { grain: ['wheat', 'millet', 'barley', 'corn'] };

export function generateTech(seed: string): TechTree {
  for (let attempt = 0; attempt < 20; attempt++) {
    const rng = Rng.fromSeed(seed, 'techgen'); for (let i = 0; i < attempt; i++) rng.next();
    const tree = tryGenerate(rng);
    if (tree) return tree;
  }
  throw new Error('tech generation failed to produce a valid tree');
}

function stem(rng: Rng): string { return mkName(rng, rng.chance(300) ? 1 : 2).toLowerCase(); }
function cname(rng: Rng, morphemes: string[]): string { return `${stem(rng)} ${rng.pick(morphemes)}`; }

function tryGenerate(rng: Rng): TechTree | null {
  const commodities: Commodity[] = UBIQUITOUS.map(c => ({ ...c }));
  const usedNames = new Set<string>();
  const uniq = (n: string): string => { let x = n, k = 2; while (usedNames.has(x)) x = `${n} ${k++}`; usedNames.add(x); return x; };
  // staple grain
  commodities.push({ id: 'grain', name: uniq(cname(rng, CAT_MORPHEMES.grain!)), category: 'grain', food: 1000, perish: 52, novelty: 2, weight: 1000, crop: { yield: 50_000 } });
  // regional raw: all required archetypes plus a seeded sample of the rest, ~10 total
  const optional = ARCHETYPES.filter(a => !a.required); const chosen = [...ARCHETYPES.filter(a => a.required)];
  const want = 10 - chosen.length;
  const pool = [...optional]; for (let i = 0; i < want && pool.length; i++) { const k = rng.int(pool.length); chosen.push(pool[k]); pool.splice(k, 1); }
  for (const a of chosen) commodities.push({ id: `r_${a.key}`, name: uniq(cname(rng, a.morphemes)), category: a.category, food: a.food, perish: a.perish, novelty: a.novelty, weight: 1000, regional: { terrains: a.terrains, cap: a.cap * 1000 } });

  const recipes: Recipe[] = [
    { id: 'tent', name: 'hide tent', tier: 1, inputs: [{ c: 'hide', qty: 2000 }], labor: 1, output: { structure: { shelter: 5, quality: 600, storage: 1000 } }, hints: [], curiosity: false, start: true },
    { id: 'hut', name: 'wood hut', tier: 2, inputs: [{ c: 'wood', qty: 8000 }], labor: 6, output: { structure: { shelter: 8, quality: 1000, storage: 1000 } }, hints: [], curiosity: false, start: true },
    { id: 'granary', name: 'granary', tier: 2, inputs: [{ c: 'wood', qty: 12_000 }, { c: 'stone', qty: 4000 }], labor: 10, output: { structure: { shelter: 0, quality: 0, storage: 3000 } }, hints: [], curiosity: false, start: true },
  ];
  const byCat = (cats: Category[]): Commodity[] => commodities.filter(c => cats.includes(c.category));
  const slots = [...SKELETON].sort((a, b) => a.tier - b.tier);
  for (const s of slots) {
    const inputs: { c: string; qty: number }[] = [];
    let ok = true;
    for (const inp of s.inputs) {
      const opts = byCat(inp.cat).filter(c => !inputs.some(i => i.c === c.id));
      if (!opts.length) { ok = false; break; }
      // prefer ubiquitous inputs for tier-1 essentials, seeded choice otherwise
      const pick = s.tier === 1 && opts.some(o => o.source) ? opts.filter(o => o.source)[rng.int(opts.filter(o => o.source).length)] : opts[rng.int(opts.length)];
      inputs.push({ c: pick.id, qty: inp.qty });
    }
    if (!ok) { if (s.optional) continue; return null; }
    const names = inputs.map(i => commodities.find(c => c.id === i.c)!.name);
    const hints = s.hints.map(h => h.replace(/\{(\d)\}/g, (_, d) => names[Number(d)] ?? '?'));
    let output: Recipe['output']; let rname: string;
    if (s.out.kind === 'capability') { output = { capability: s.out.cap }; rname = CAP_NAMES[s.out.cap]; }
    else if (s.out.kind === 'structure') { output = { structure: { shelter: s.out.shelter, quality: s.out.quality, storage: s.out.storage, defense: s.out.defense, watch: s.out.watch } }; rname = uniq(cname(rng, s.out.morphemes)); }
    else if (s.out.kind === 'crop') {
      const base = commodities.find(c => c.id === inputs[0].c)!;
      const crop: Commodity = { id: `crop_${s.key}`, name: uniq(`${base.name.split(' ')[0]} ${rng.pick(s.out.morphemes)}`), category: base.category, food: 1000, perish: s.out.perish, novelty: s.out.novelty, weight: 1000, crop: { yield: s.out.yieldK } };
      commodities.push(crop); output = { crop: crop.id }; rname = `tending ${crop.name}`;
    } else {
      const c: Commodity = { id: `m_${s.key}`, name: uniq(cname(rng, s.out.morphemes)), category: s.out.category, food: s.out.food, perish: s.out.perish, novelty: s.out.novelty, weight: 1000 };
      commodities.push(c); output = { commodity: { c: c.id, qty: s.out.qty } }; rname = c.name;
    }
    recipes.push({ id: s.key, name: rname, tier: s.tier, inputs, requires: s.requires, labor: s.labor, output, hints, curiosity: false });
  }
  // curiosities: novelty goods that lead nowhere
  const nCurio = 6 + rng.int(3);
  for (let i = 0; i < nCurio; i++) {
    const cats = CURIO_INPUT_CATS[rng.int(CURIO_INPUT_CATS.length)];
    const a = byCat([cats[0]]), b = byCat([cats[1]]); if (!a.length || !b.length) continue;
    const ia = a[rng.int(a.length)], ib = b[rng.int(b.length)]; if (ia.id === ib.id) continue;
    const c: Commodity = { id: `curio_${i}`, name: uniq(cname(rng, CURIO_MORPHEMES)), category: 'curio', food: 0, perish: 0, novelty: 4 + rng.int(4), weight: 500 };
    commodities.push(c);
    recipes.push({ id: `curio_${i}`, name: c.name, tier: 1 + rng.int(2), inputs: [{ c: ia.id, qty: 1000 }, { c: ib.id, qty: 1000 }], labor: 1, output: { commodity: { c: c.id, qty: 1000 } }, hints: [`${ia.name} and ${ib.name} together please the eye`], curiosity: true });
  }
  // validate: every capability produced exactly once, every recipe's inputs exist
  for (const cap of CAPABILITY_LIST) if (recipes.filter(r => r.output.capability === cap).length !== 1) return null;
  for (const r of recipes) for (const i of r.inputs) if (!commodities.some(c => c.id === i.c)) return null;
  return { commodities, recipes, startRecipes: recipes.filter(r => r.start).map(r => r.id) };
}

const CAPABILITY_LIST: Capability[] = ['fire', 'stonetools', 'spear', 'net', 'paddle', 'drying', 'pottery', 'weaving', 'cart', 'hull', 'bow', 'medicine', 'irrigation', 'husbandry', 'sail', 'roadbuilding', 'kiln', 'metaltools', 'hook', 'wagon', 'seagoing', 'bronzeweapons', 'plough'];

export const CAP_NAMES: Record<Capability, string> = {
  fire: 'fire making', stonetools: 'stone tools', spear: 'spears', net: 'fishing nets', paddle: 'paddle and dugout', drying: 'drying racks', pottery: 'pottery', weaving: 'weaving',
  cart: 'hand cart', hull: 'planked hull', bow: 'bow and arrow', medicine: 'herbal medicine', irrigation: 'irrigation', husbandry: 'animal husbandry', sail: 'sail and mast', roadbuilding: 'road building',
  kiln: 'kiln', metaltools: 'metal tools', hook: 'metal hooks', wagon: 'wagon', seagoing: 'seagoing boat', bronzeweapons: 'metal weapons', plough: 'plough',
};

export type { Cat };
