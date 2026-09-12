/** Narrative synthesis: a span of a village's history, rendered as prose by the capable model. */
import { WEEKS_PER_YEAR, yearOf, type Event, type Village, type World } from '@wind-spirit/sim';
import type { LlmClient } from './client.js';
import { renderEvents } from './view.js';
import type { JournalEntry } from './scheduler.js';

export interface NarrativeOptions { client: LlmClient; capNames: Record<string, string>; fromTick: number; toTick: number; style?: 'chronicle' | 'saga' | 'plain'; }

export async function narrate(w: World, v: Village, events: Event[], journals: JournalEntry[], o: NarrativeOptions): Promise<string> {
  const cname = (id: string) => w.commodities.find(c => c.id === id)?.name ?? id;
  const rname = (id: string) => w.recipes.find(r => r.id === id)?.name ?? id;
  const capName = (c: string) => o.capNames[c] ?? c;
  const span = events.filter(e => e.t >= o.fromTick && e.t < o.toTick);
  const lines = renderEvents(w, v, span, cname, rname, capName);
  const js = journals.filter(j => j.village === v.id && j.tick >= o.fromTick && j.tick < o.toTick && j.source === 'model').slice(-20).map(j => `year ${yearOf(j.tick)}: "${j.text}"`);
  const years = Math.max(1, Math.round((o.toTick - o.fromTick) / WEEKS_PER_YEAR));
  const style = o.style ?? 'chronicle';
  const res = await o.client.generate({
    class: 'capable', temperature: 0.8, maxOutputTokens: 4000, thinkingLevel: 'low',
    system: `You write the history of a stone-age village as ${style === 'saga' ? 'a saga told aloud by its people' : style === 'plain' ? 'a plain factual summary' : 'a chronicle, in the voice of a later scribe'}. Use only the facts given. No modern words. No invented names beyond those given. 200 to 500 words.`,
    messages: [{ role: 'user', text: `Village: ${v.name}, founded in year ${yearOf(v.founded)}. Span: years ${yearOf(o.fromTick)} to ${yearOf(o.toTick)} (${years} years).\n\nEvents:\n${lines.map(l => `- ${l}`).join('\n') || '- a quiet time'}\n\nFrom the chiefs' own words:\n${js.map(l => `- ${l}`).join('\n') || '- none recorded'}` }],
  });
  return res.text.trim();
}
