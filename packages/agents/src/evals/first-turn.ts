/** Reproduce the first-spring decision on fresh small worlds: how often does a model leave the village with (almost) nobody gathering food? */
import { Sim, popCounts, storesWeeks } from '@wind-spirit/sim';
import { generateWorld, CAP_NAMES } from '@wind-spirit/gen';
import { HttpLlmClient, buildView, statePrompt, systemPrompt, parseDecision, DECISION_SCHEMA, type ChiefDecisionJson } from '../index.js';
import { anonToken } from './token.js';
const PROXY = process.env.PROXY_URL ?? 'https://llm-proxy-406179055859.us-central1.run.app';
const tok = await anonToken(PROXY);
const client = new HttpLlmClient(PROXY, async () => tok);
const models = (process.argv[2] ?? 'gemini-3.5-flash-lite,gemini-3.8-flash').split(','); const seeds = ['chief-models-post', 'first-a', 'first-b']; const reps = Number(process.argv[3] ?? 3);
for (const model of models) {
  let n = 0, lowFood = 0, zeroFood = 0; const examples: string[] = [];
  for (const seed of seeds) {
    const w = generateWorld({ seed }); const sim = new Sim(w); const ev = sim.tick(); const v = w.villages[0];
    const view = buildView(w, v, { events: ev, capNames: CAP_NAMES }); const c = popCounts(v, w.tick);
    for (let r = 0; r < reps; r++) {
      const res = await client.generate({ class: 'routine', model, system: systemPrompt(view), messages: [{ role: 'user', text: statePrompt(view, 'season') }], schema: DECISION_SCHEMA, maxOutputTokens: 6000, temperature: 0.7, thinkingLevel: 'low' });
      const j = res.json as ChiefDecisionJson; const p = parseDecision(view, j);
      const food = p.orders.filter(o => ['forage', 'hunt', 'fish', 'farm'].includes(o.task)).reduce((a, o) => a + o.workers, 0); const assigned = p.orders.filter(o => o.task !== 'colonize').reduce((a, o) => a + o.workers, 0);
      n++; if (food === 0) zeroFood++; if (food < Math.ceil((c.adults - 1) * 0.3)) lowFood++;
      if (food < Math.ceil((c.adults - 1) * 0.3) && examples.length < 2) examples.push(`${seed}: stores ${storesWeeks(w, v)}w, adults ${c.adults}; orders ${p.orders.map(o => `${o.task}${o.workers}`).join(' ')} (${assigned} assigned); journal: ${p.journal.slice(0, 220)}`);
    }
  }
  console.log(`${model}: ${n} first-spring decisions, ${lowFood} with under 30% on food, ${zeroFood} with none on food`); for (const e of examples) console.log('  ', e);
}
