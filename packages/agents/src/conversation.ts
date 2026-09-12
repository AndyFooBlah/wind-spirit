/**
 * Conversation mode: the spirit talks with a chief while the game is paused. The chief answers in character from the
 * same village view. On close, one extraction call turns the spirit's claims into chronicle entries the sim can score.
 */
import { WEEKS_PER_SEASON, seasonIndex, type Claim, type Village, type World, type SeasonRoll } from '@wind-spirit/sim';
import type { GenerateRequest, LlmClient } from './client.js';
import { statePrompt, systemPrompt } from './prompt.js';
import { buildView } from './view.js';

export interface Turn { role: 'spirit' | 'chief'; text: string; }
export interface ConversationOptions { client: LlmClient; capNames: Record<string, string>; onError?: (e: unknown) => void; }

const CLAIMS_SCHEMA = {
  type: 'object',
  properties: {
    claims: { type: 'array', items: { type: 'object', properties: {
      text: { type: 'string', description: 'the spirit\'s claim, in one sentence' },
      seasonsAhead: { type: 'integer', description: 'when it can be checked: 0 = this season, 1 = next season, ...; up to 8' },
      weather: { type: 'string', enum: ['none', 'drought', 'normal', 'wet', 'hard', 'storm'], description: 'if the claim is about a coming season\'s weather, which' },
      checkable: { type: 'boolean', description: 'true if the chief could later tell whether it came true' },
    }, required: ['text', 'seasonsAhead', 'weather', 'checkable'] } },
    memoryNotes: { type: 'array', items: { type: 'string' }, description: 'up to 12 notes the chief keeps after this dream; replaces old notes' },
  },
  required: ['claims', 'memoryNotes'],
} as const;

export class Conversation {
  readonly turns: Turn[] = [];
  private system: string; private state: string;
  constructor(private w: World, private v: Village, private o: ConversationOptions) {
    const view = buildView(w, v, { events: [], capNames: o.capNames, pendingSpirit: [], chronicle: renderChronicle(w, v) });
    this.system = systemPrompt(view, 'dream');
    this.state = statePrompt(view, 'a dream', false);
  }
  /** Send the spirit's words; streams the chief's reply through onText and returns the full reply. */
  async send(text: string, onText?: (t: string) => void): Promise<string> {
    this.turns.push({ role: 'spirit', text });
    const messages: GenerateRequest['messages'] = [{ role: 'user', text: this.state + '\n\n(The dream begins.)' }];
    for (const t of this.turns) messages.push({ role: t.role === 'spirit' ? 'user' : 'model', text: t.role === 'spirit' ? `The spirit says: "${t.text}"` : t.text });
    const req: GenerateRequest = { class: 'capable', system: this.system, messages, maxOutputTokens: 3000, temperature: 0.9, thinkingLevel: 'low' };
    const res = this.o.client.stream && onText ? await this.o.client.stream(req, onText) : await this.o.client.generate(req);
    const reply = res.text.trim(); this.turns.push({ role: 'chief', text: reply });
    return reply;
  }
  /** End the dream: extract claims for the chronicle and the chief's notes. */
  async close(): Promise<{ claims: { text: string; due: number; check: Claim['check'] }[]; memoryNotes: string[] }> {
    if (!this.turns.length) return { claims: [], memoryNotes: this.v.memory };
    const transcript = this.turns.map(t => `${t.role === 'spirit' ? 'Spirit' : 'Chief'}: ${t.text}`).join('\n');
    try {
      const res = await this.o.client.generate({ class: 'routine', system: 'You extract structured notes from a conversation. Answer only with JSON.', messages: [{ role: 'user', text: `Here is a dream in which a spirit spoke to a village chief.\n\n${transcript}\n\nList every prediction, promise or factual claim the spirit made that could later prove true or false, with when it could be checked. Then write the chief's notes to self after this dream (existing notes: ${JSON.stringify(this.v.memory)}).` }], schema: CLAIMS_SCHEMA, maxOutputTokens: 3000, thinkingLevel: 'low' });
      const json = res.json as { claims: { text: string; seasonsAhead: number; weather: string; checkable: boolean }[]; memoryNotes: string[] } | undefined;
      if (!json) return { claims: [], memoryNotes: this.v.memory };
      const cur = seasonIndex(this.w.tick);
      const claims = (json.claims ?? []).slice(0, 5).map(c => {
        const ahead = Math.max(0, Math.min(8, Math.trunc(c.seasonsAhead || 0))); const season = cur + ahead;
        const due = (season + 1) * WEEKS_PER_SEASON;                                   // check when that season has ended
        const check: Claim['check'] = c.weather && c.weather !== 'none' ? { kind: 'weather', season, roll: c.weather as SeasonRoll } : c.checkable ? { kind: 'judged' } : { kind: 'none' };
        return { text: c.text, due, check };
      });
      return { claims, memoryNotes: (json.memoryNotes ?? this.v.memory).slice(0, 12) };
    } catch (e) { this.o.onError?.(e); return { claims: [], memoryNotes: this.v.memory }; }
  }
}

export const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'];
/** Chronicle lines for prompts: what the spirit said and what came of it. */
export function renderChronicle(w: World, v: Village): string[] {
  const cur = seasonIndex(w.tick);
  return v.chronicle.slice(-10).map(c => {
    const when = seasonIndex(c.tick); const ago = cur - when;
    const said = `${ago === 0 ? 'this season' : ago === 1 ? 'last season' : `${ago} seasons ago`} the spirit said: "${c.text}"`;
    const came = c.outcome === 'fulfilled' ? 'It came true.' : c.outcome === 'failed' ? 'It did not come true.' : c.outcome === 'unverifiable' ? 'No one can say.' : c.due <= w.tick ? `You must judge now whether it came true (claim ${c.id}).` : 'Time will tell.';
    return `${said} ${came}`;
  });
}
