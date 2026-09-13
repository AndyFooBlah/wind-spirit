/**
 * The sun spirit: a second omniscient voice, one the player can question. It sees the whole world (every village's
 * state as its chief sees it, plus what the chiefs cannot see: trust, traits, relations, the full tech tree) and
 * answers on the capable model. Runs in the sim worker, where the World lives.
 */
import { seasonOf, yearOf, storesWeeks, popCounts, recipeById, commodityById, type Event, type World } from '@wind-spirit/sim';
import { CAP_NAMES } from '@wind-spirit/gen';
import { buildView, renderChronicle, renderEvents, statePrompt, type LlmClient } from '@wind-spirit/agents';

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/** Everything, in prose the model can read: one section per village, then the world's tech tree and its goods. */
export function worldDigest(w: World, recent: (village: number) => Event[]): string {
  const cname = (c: string) => commodityById(w, c)?.name ?? c;
  const rname = (r: string) => recipeById(w, r)?.name ?? r;
  const capName = (c: string) => (CAP_NAMES as Record<string, string>)[c] ?? c;
  const out: string[] = [];
  out.push(`# The world now: year ${yearOf(w.tick)}, ${SEASONS[seasonOf(w.tick)]}, week ${(w.tick % 13) + 1}. Map ${w.width} × ${w.height} tiles. ${w.villages.filter(v => v.alive).length} living villages, ${w.villages.reduce((a, v) => a + (v.alive ? v.people.length : 0), 0)} people. Breath left to the wind spirit (the player): ${Math.round(w.breath / 1000)}.`);
  for (const v of w.villages) {
    if (!v.alive) { out.push(`\n# ${v.name} (village ${v.id}): dead. Founded year ${yearOf(v.founded)}${v.parent >= 0 ? ` by settlers from ${w.villages[v.parent]?.name}` : ''}.`); continue; }
    const view = buildView(w, v, { events: [], capNames: CAP_NAMES, pendingSpirit: [...v.inbox], chronicle: renderChronicle(w, v) });
    const counts = popCounts(v, w.tick);
    out.push(`\n# ${v.name} (village ${v.id}), founded year ${yearOf(v.founded)}${v.parent >= 0 ? ` by settlers from ${w.villages[v.parent]?.name}` : ''}, at tile ${v.tile} (${v.tile % w.width}, ${Math.floor(v.tile / w.width)}).`);
    out.push(`What the chief cannot put into words but is true: trust in the wind spirit ${v.trust} of 1000 (${view.spirit.attitude}); happiness ${v.happiness} of 1000; hardship (recent food shortfall) ${v.hardship} of 1000; stores cover ${storesWeeks(w, v)} weeks; ${counts.adults} adults, ${counts.children} children, ${counts.elders} elders; chief traits [${v.chiefTraits.join(', ')}] of 1000 (first: how readily the chief believes a spirit; the rest: caution, ambition, warmth); culture [${v.culture.join(', ')}].`);
    const rel = Object.entries(v.relations).map(([id, r]) => `${w.villages[Number(id)]?.name ?? id}: grudge ${r.grudge}, trades ${r.trades}, raids ${r.raids}, last contact year ${yearOf(r.lastContact)}`);
    if (rel.length) out.push(`Relations: ${rel.join('; ')}.`);
    out.push(`## As the chief sees it\n${statePrompt(view, 'season', false)}`);
    const ev = renderEvents(w, v, recent(v.id).slice(-80), cname, rname, capName);
    if (ev.length) out.push(`## Recent events\n${ev.map(l => `- ${l}`).join('\n')}`);
    if (v.chronicle.length) out.push(`## What the wind spirit claimed here, and what came of it\n${renderChronicle(w, v).map(l => `- ${l}`).join('\n')}`);
  }
  if (w.parties.length) out.push(`\n# Parties abroad\n${w.parties.map(p => `- ${p.kind} from ${w.villages[p.home]?.name}, ${p.members.length} people, at tile ${p.at}, ${p.route.length} tiles to go${p.returning ? ', returning' : ''}${p.targetVillage !== undefined ? `, bound for ${w.villages[p.targetVillage]?.name}` : ''}`).join('\n')}`);
  out.push(`\n# Weather: this season ${w.rolls[Math.floor(w.tick / 13)]}, next ${w.rolls.slice(Math.floor(w.tick / 13) + 1, Math.floor(w.tick / 13) + 4).join(', ')}.`);
  // The tech tree, which no chief sees whole. Names are the world's own; the categories say what things are for.
  const holders = (rid: string) => w.villages.filter(v => v.alive && v.recipes.includes(rid)).map(v => v.name);
  out.push(`\n# The tech tree (every recipe in this world; chiefs know only what they hold or have heard hinted)`);
  for (const r of [...w.recipes].sort((a, b) => a.tier - b.tier)) {
    const o = r.output; const makes = o.capability ? `the skill ${capName(o.capability)}` : o.structure ? `a building (shelter ${o.structure.shelter}, storage ${o.structure.storage}${o.structure.defense ? `, defence ${o.structure.defense}` : ''}${o.structure.watch ? ', a lookout' : ''})` : o.crop ? `the crop ${cname(o.crop)}` : o.commodity ? `${o.commodity.qty / 1000} ${cname(o.commodity.c)}` : 'nothing';
    const h = holders(r.id);
    out.push(`- ${r.name} (tier ${r.tier}${r.start ? ', known from the start' : ''}): ${r.inputs.map(i => `${i.qty / 1000} ${cname(i.c)}`).join(' + ') || 'no inputs'}${r.requires ? `, needs ${capName(r.requires)}` : ''} → ${makes}; ${r.labor} worker-weeks. Held by: ${h.length ? h.join(', ') : 'nobody'}. Hints: ${r.hints.join(' / ') || 'none'}`);
  }
  out.push(`\n# Goods\n${w.commodities.map(c => `- ${c.name}: ${c.category}${c.food ? `, food ${c.food / 1000} person-weeks a unit` : ''}${c.perish ? `, keeps ${c.perish} weeks` : ', keeps'}${c.source ? `, gathered from ${c.source}` : ''}${c.regional ? `, found on ${c.regional.terrains.join('/')}` : ''}${c.crop ? `, a crop yielding ${c.crop.yield / 1000} a plot` : ''}`).join('\n')}`);
  return out.join('\n');
}

const SYSTEM = `You are the sun spirit of this world. You look down on all of it and see everything: every village, every person, every store and order, the whole tree of recipes, and the past. You cannot act. The one asking you is the wind spirit, a lesser spirit who can only speak to chiefs in dreams and whispers and spend a little breath on the weather, and is judged by how far the chiefs come to trust it.

Answer the question as well as the world allows, plainly and specifically, in a few short paragraphs at most. Name villages and chiefs' reasons. Where the answer is a chain of causes (a bad harvest, a raid, a claim that failed), lay out the chain in order with the years. Where the world does not say, say so rather than invent. You may tell the wind spirit things the chiefs do not know, including what a recipe makes. Speak in an even, unhurried voice; no headings, no lists longer than a few items, no modern words.`;

export interface SunTurn { question: string; answer: string; tick: number; }

/** Ask the sun spirit one question. Streams the answer through onText and returns the whole of it. */
export async function askSun(w: World, question: string, before: SunTurn[], recent: (village: number) => Event[], client: LlmClient, onText: (t: string) => void): Promise<string> {
  const digest = worldDigest(w, recent);
  const messages: { role: 'user' | 'model'; text: string }[] = [];
  for (const t of before.slice(-4)) { messages.push({ role: 'user', text: `(asked in year ${yearOf(t.tick)}) ${t.question}` }); messages.push({ role: 'model', text: t.answer }); }
  messages.push({ role: 'user', text: question });
  const req = { class: 'capable' as const, system: `${SYSTEM}\n\n${digest}`, messages, temperature: 0.6, maxOutputTokens: 6000, thinkingLevel: 'medium' as const };
  if (client.stream) { const r = await client.stream(req, onText); return r.text; }
  const r = await client.generate(req); onText(r.text); return r.text;
}
