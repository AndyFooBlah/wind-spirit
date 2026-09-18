/** Renders a VillageView into the fixed prompt sections. Order is stable so prefix caching works. */
import type { VillageView } from './view.js';
import type { Mandate } from '@wind-spirit/sim';

const TRAITS = ['piety', 'ambition', 'hospitality', 'curiosity'];
function traitWords(t: number[]): string {
  const w = (x: number, lo: string, mid: string, hi: string) => (x < 350 ? lo : x > 650 ? hi : mid);
  return [w(t[0], 'skeptical of spirits', 'open to the spirit world', 'deeply pious'), w(t[1], 'cautious', 'steady', 'ambitious'), w(t[2], 'suspicious of strangers', 'fair with strangers', 'warm to strangers'), w(t[3], 'bound to tradition', 'practical', 'restlessly curious')].join(', ');
}

export function systemPrompt(v: VillageView, mode: 'decide' | 'dream' = 'decide'): string {
  const closing = mode === 'dream' ? 'Tonight a spirit comes to you in a dream. Answer it as yourself, in a few plain sentences, in your own voice. You may ask it questions. You are not obliged to believe it. Speak; never answer with JSON or lists of orders.' : 'Decide standing orders for your adults. Orders persist until you change them. Answer only with the JSON asked for.';
  return `You are ${v.village.name}'s chief, a person of the stone age. You are ${traitWords(v.village.chiefTraits)}. Your village's ways are ${traitWords(v.village.culture)}.
You speak plainly, in clear English with a light old-world cadence. No modern words or ideas. You know only what your people have seen and done.

How the world works, as your people understand it:
- The year has four seasons. Spring is for planting, autumn for harvest, winter is lean. Wild food is scarce in winter; hunting and fishing carry a village through it, and stored food more so.
- Fresh food spoils in weeks. Grain and cured food keep. Buildings and skills help food keep longer.
- Land tires: fields lose strength each harvest and rest recovers it. Plant about half your cleared plots each year.
- Wild plants, game, fish and wood grow back slowly; take too much and yields fall.
- New skills and foods come from trying things: name one ingredient to explore, or two (or an ingredient and a skill) to test an idea. Failed tries still teach.
- Other villages can be visited by envoys to trade or share knowledge, or raided. Raids make enemies and cost lives.
- Sometimes a spirit speaks to you in dreams. Spirits may know things. They may also be wrong.
- The chief does not labour. Children and elders do not labour. Every adult you do not assign forages on their own, poorly.
- You decide once a season, thirteen weeks, unless something forces your hand. Orders stand until then. Stores of N weeks with nobody gathering are gone in N weeks; a season of building with no one on food ends in hunger. Cover the season's food first, then spend what is left.
- Villages that stop trying things fall behind. In good times keep one or two adults researching, crafting a new skill, or exploring; a rumour you have heard is a good place to start.

${closing}`;
}

const list = (xs: string[], empty = 'none') => (xs.length ? xs.map(x => `- ${x}`).join('\n') : `- ${empty}`);

/** What to say when the chief has already made up their mind and only the terms and the telling are left. */
const DECIDED: Record<'accept' | 'counter' | 'refuse', string> = {
  accept: 'You have decided to accept: give what they ask and take what they offer. Write what you give and take, and your journal.',
  counter: 'You have decided to counter rather than accept or refuse. Say what you will give and what you will take from their offer, keeping enough food for your own people, and write your journal.',
  refuse: 'You have decided to refuse and send them away with nothing. Say plainly why, and write your journal.',
};

export function statePrompt(v: VillageView, reason: string, withMenu = true): string {
  const p = v.people;
  const sections: string[] = [];
  sections.push(`# Now: year ${v.year}, ${v.season}, week ${v.week} of the season. Reason for deciding: ${reason}.`);
  sections.push(`# People: ${p.total} (${p.children} children, ${p.adults} adults, ${p.elders} elders). Adults free to assign: ${p.workersFree}. Hungry this week: ${p.hungryNow}. Deaths this season: ${p.deathsRecent}. Mood: ${p.happiness}. Shelter: ${p.shelterWords}.`);
  sections.push(`# Stores (units; one unit feeds one person for a week). Food for about ${v.foodWeeks} weeks${v.foodWeeks < 13 ? ', which is less than a season: the rest must be gathered' : ''}; ${v.storageWords}.\n${list(v.stores.map(s => `${s.units} ${s.name} (${s.category}${s.food ? ', food' : ''}; ${s.keeps})`), 'empty')}`);
  sections.push(`# Food arithmetic this season: the village eats ${v.yields.need} units a week. One worker brings in about ${v.yields.forage} units a week foraging, ${v.yields.hunt} hunting, ${v.yields.fish} fishing, at today's stocks. Farming pays at harvest, not now.`);
  sections.push(`# Land: ${v.plots.cleared} cleared plots (${v.plots.planted} planted, ${v.plots.free} free). Buildings: ${v.plots.structures.join(', ') || 'tents only'}. Around us: ${v.surroundings}.`);
  sections.push(`# Skills we have: ${v.capabilities.join(', ') || 'none beyond bare hands'}.`);
  sections.push(`# Recipes we know:\n${list(v.recipes.map(r => `${r.name}: needs ${r.inputs}${r.requires ? ` and the skill ${r.requires}` : ''}; makes ${r.makes}${r.held ? ' (we have it)' : r.canMakeNow ? ' (we could make it now)' : ''}`))}`);
  sections.push(`# Things people have noticed but not worked out:\n${list(v.rumors, 'nothing new')}`);
  sections.push(`# Things we know of, and where:\n${list(v.commodities.map(c => `${c.name} (${c.category}): ${c.where}`))}\nCrops we can plant: ${v.crops.join(', ')}.`);
  sections.push(`# Other villages we know:\n${list(v.villages.map(x => `${x.name}: ${x.days} days to the ${x.direction}; about ${x.sizeSeen} people when last seen ${x.lastSeenYearsAgo} years ago; ${x.kin ? (x.kin === 'colony' ? 'our colony, our kin; ' : 'our parent village, our kin; ') : ''}trades ${x.trades}, raids ${x.raids}; grudge ${x.grudge}`), 'none yet')}`);
  sections.push(`# Sites for a new village (pick by number):\n${list(v.sites.map(s => `${s.index}: ${s.days} days ${s.direction}, ${s.terrain}, food ${s.food}${s.water ? ', water' : ''}`), 'none known; explore')}`);
  if (v.roadSites.length) sections.push(`# Worn tracks that could be roads (pick by number):\n${list(v.roadSites.map(s => `${s.index}: to the ${s.direction}`))}`);
  sections.push(`# Parties away:\n${list(v.parties.map(x => `${x.size} on a ${x.kind} to ${x.destination}, ${x.status}`), 'none')}`);
  sections.push(`# Current orders:\n${list(v.orders, 'none')}`);
  sections.push(`# Since you last decided:\n${list(v.events, 'quiet')}`);
  sections.push(`# The spirit: ${v.spirit.attitude}.${v.spirit.chronicle.length ? '\nWhat the spirit has said and what came of it:\n' + list(v.spirit.chronicle) : ''}${v.spirit.pending.length ? '\nThe spirit speaks now:\n' + list(v.spirit.pending.map(m => `"${m}"`)) : ''}`);
  sections.push(`# Your notes to yourself:\n${list(v.memory, 'none')}`);
  if (withMenu) sections.push(`# Orders you may give (workers are adults; keep the sum within ${p.workersFree}):
- forage / hunt / fish: workers. Winter favours hunting and fishing. Unless stores cover the whole season, keep enough hands on food to cover the weeks they do not; the village will overrule an order that starves it.
- gather: workers, commodity (wood, stone, or anything listed as within a day). expedition: workers, commodity, weeks (go to where something far is known to be, collect, and come back).
- clear: workers (about 4 worker-weeks per plot).
- farm: workers, plots, crop. Spring plants, autumn harvests. A farmer handles 3 plots a week.
- build: workers, recipe (a building recipe). craft: workers, recipe, quantity (0 to keep going). Skills are crafted once.
- research: workers, ingredients (1 or 2 names, may include a skill).
- explore: workers, direction, days. envoy: workers, village, offer, want, floor, transfer, threat, message.
- colonize: site, share (0.2 to 0.6 of the village); a grave step taken once in a generation, never while a settler party is already out. raid: workers, village (never kin). road: workers, roadSite. rest: workers.
- abandon: village. The last resort when the village cannot be saved: everyone walks, with what they can carry, to that village and asks to be taken in. Nothing is left but the buildings. Give no other orders with it.
Answer with JSON: { "orders": [...], "journal": "...", "memoryNotes": [...], "replyToSpirit": "..." }.`);
  return sections.join('\n\n');
}

/**
 * `decided` is set when a judge has already answered (see judge/). The chief then writes the terms and the
 * journal for a decision they have made, rather than making it again: asking twice invites the prose and the
 * decision to disagree.
 */
export function visitorPrompt(v: VillageView, from: string, mandate: Mandate, cname: (id: string) => string, rname: (id: string) => string, decided?: 'accept' | 'counter' | 'refuse'): string {
  const goods = (g: Record<string, number>) => Object.entries(g).map(([c, q]) => `${Math.round(q / 1000)} ${cname(c)}`).join(', ') || 'nothing';
  return `${statePrompt(v, 'envoys have arrived')}

# ${mandate.refuge ? 'The people at your edge' : 'The envoys'}
${mandate.refuge ? `People from ${from} stand at the edge of your village.` : `Envoys from ${from} stand before you.`} ${mandate.threat ? `They demand tribute: ${goods(mandate.want)}, and say their warriors will come and take it, and more, if you refuse. They offer nothing in return${Object.keys(mandate.offer).length ? ` beyond ${goods(mandate.offer)}` : ''}.` : `They offer: ${goods(mandate.offer)}. They ask for: ${goods(mandate.want)}.`}${mandate.transfer ? ` They offer to teach us ${rname(mandate.transfer)}.` : ''}${mandate.message ? ` Their chief says: "${mandate.message}"` : ''}
${mandate.refuge ? `These are not envoys but ${mandate.refuge} people with everything they own on their backs, asking to be taken in as your own. What they carry: ${goods(mandate.offer)}. If you accept they join your village for good, mouths and hands alike, with what they carry. If you refuse they walk on to the next village, or die on the road.\n` : ''}${decided ? DECIDED[decided] : 'Answer: accept (give what they ask, take what they offer), counter (say what you give and what you take from their offer), or refuse. Keep enough food for your people. Give generously to friends, carefully to strangers, and never to those who have wronged you without cause. A demand backed by threat is a different matter from an offer: weigh how strong they are against how strong you are, and what paying once teaches them.'}
Answer with JSON: { "answer": ${decided ? `"${decided}"` : '"accept"|"counter"|"refuse"'}, "give": {name: units}, "take": {name: units}, "reason": "...", "journal": "..." }.`;
}
