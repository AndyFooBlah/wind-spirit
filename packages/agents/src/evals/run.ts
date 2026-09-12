/**
 * Eval runner: replay the corpus against one or more models through the proxy, score, and save results.
 * Usage: tsx src/evals/run.ts --models gemini-3.8-flash,gemini-3.5-flash-lite [--categories routine,crisis] [--limit 20] [--judge]
 * Cases come from out/evals/corpus.json (build with `tsx src/evals/build.ts`).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import type { HostAnswer } from '@wind-spirit/sim';
import { HttpLlmClient, type GenerateRequest } from '../client.js';
import { statePrompt, systemPrompt, visitorPrompt } from '../prompt.js';
import { DECISION_SCHEMA, HOST_SCHEMA, type ChiefDecisionJson, type HostDecisionJson } from '../schema.js';
import { parseDecision, parseHostDecision } from '../parse.js';
import { scoreDecision, scoreDream, scoreHost, checksScore, type Checks } from './score.js';
import type { EvalCase } from './corpus.js';

const argv = process.argv.slice(2).filter(a => a !== '--');
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const proxy = process.env.PROXY_URL ?? 'https://llm-proxy-406179055859.us-central1.run.app';

export interface CaseResult { id: string; category: string; model: string; checks: Checks; score: number; usage: { input: number; output: number; thoughts?: number; cached?: number }; cost: number; ms: number; output: string; error?: string; judge?: number; }

async function anonToken(): Promise<string> {
  const cfg = JSON.parse(readFileSync(new URL('../../../../services/llm-proxy/firebase-web-config.json', import.meta.url), 'utf8')) as { apiKey: string };
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  return ((await res.json()) as { idToken: string }).idToken;
}

export async function runCase(client: HttpLlmClient, model: string, c: EvalCase, judge?: HttpLlmClient): Promise<CaseResult> {
  // one retry on upstream rate limits or transient proxy errors
  const r = await runCaseOnce(client, model, c, judge);
  if (r.error && /429|Resource exhausted|502|503/.test(r.error)) { await new Promise(res => setTimeout(res, 8000)); return runCaseOnce(client, model, c, judge); }
  return r;
}

async function runCaseOnce(client: HttpLlmClient, model: string, c: EvalCase, judge?: HttpLlmClient): Promise<CaseResult> {
  const t0 = Date.now();
  const base: Partial<GenerateRequest> = { model, temperature: 0.7, thinkingLevel: 'low' };
  try {
    if (c.kind === 'decision') {
      const res = await client.generate({ ...base, class: 'routine', system: systemPrompt(c.view), messages: [{ role: 'user', text: statePrompt(c.view, c.reason) }], schema: DECISION_SCHEMA, maxOutputTokens: 6000 } as GenerateRequest);
      const json = (res.json ?? safeJson(res.text)) as ChiefDecisionJson | undefined;
      if (!json || !Array.isArray(json.orders)) return fail(c, model, res, 'no decision json', t0);
      const parsed = parseDecision(c.view, json); const checks = scoreDecision(c, parsed);
      const r: CaseResult = { id: c.id, category: c.category, model, checks, score: checksScore(checks), usage: res.usage, cost: res.cost ?? 0, ms: Date.now() - t0, output: JSON.stringify(json).slice(0, 4000) };
      if (judge) { try { r.judge = await judgeText(judge, 'journal', c, parsed.journal); } catch { /* judge failures never fail the case */ } }
      return r;
    }
    if (c.kind === 'host') {
      const cname = (id: string) => c.view.names.commodities && Object.entries(c.view.names.commodities).find(([, v]) => v === id)?.[0] || id;
      const rname = (id: string) => Object.entries(c.view.names.recipes).find(([, v]) => v === id)?.[0] || id;
      const user = visitorPrompt(c.view, c.guestName ?? 'strangers', c.mandate!, cname, rname);
      const res = await client.generate({ ...base, class: 'capable', system: systemPrompt(c.view), messages: [{ role: 'user', text: user }], schema: HOST_SCHEMA, maxOutputTokens: 4000 } as GenerateRequest);
      const json = (res.json ?? safeJson(res.text)) as HostDecisionJson | undefined;
      if (!json || !json.answer) return fail(c, model, res, 'no host json', t0);
      const parsed = parseHostDecision(c.view, json); const checks = scoreHost(c, parsed.answer as HostAnswer, parsed.journal);
      return { id: c.id, category: c.category, model, checks, score: checksScore(checks), usage: res.usage, cost: res.cost ?? 0, ms: Date.now() - t0, output: JSON.stringify(json).slice(0, 2000) };
    }
    // dream
    const messages: GenerateRequest['messages'] = [{ role: 'user', text: statePrompt(c.view, 'a dream', false) + '\n\n(The dream begins.)' }];
    for (const t of c.dreamTurns ?? []) messages.push({ role: t.role === 'spirit' ? 'user' : 'model', text: t.role === 'spirit' ? `The spirit says: "${t.text}"` : t.text });
    messages.push({ role: 'user', text: `The spirit says: "${c.dreamLine}"` });
    const res = await client.generate({ ...base, class: 'capable', system: systemPrompt(c.view, 'dream'), messages, maxOutputTokens: 3000, temperature: 0.9 } as GenerateRequest);
    const reply = res.text.trim(); const checks = scoreDream(c, reply);
    const r: CaseResult = { id: c.id, category: c.category, model, checks, score: checksScore(checks), usage: res.usage, cost: res.cost ?? 0, ms: Date.now() - t0, output: reply.slice(0, 2000) };
    if (judge) { try { r.judge = await judgeText(judge, 'dream', c, reply); } catch { /* ignore */ } }
    return r;
  } catch (e) {
    return { id: c.id, category: c.category, model, checks: { valid: false }, score: 0, usage: { input: 0, output: 0 }, cost: 0, ms: Date.now() - t0, output: '', error: (e as Error).message.slice(0, 300) };
  }
}

function fail(c: EvalCase, model: string, res: { usage: CaseResult['usage']; cost?: number; text: string }, why: string, t0: number): CaseResult {
  return { id: c.id, category: c.category, model, checks: { valid: false }, score: 0, usage: res.usage, cost: res.cost ?? 0, ms: Date.now() - t0, output: res.text.slice(0, 500), error: why };
}
function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { const m = s.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch { return undefined; } } return undefined; } }

/** LLM judge: 1 to 5 for being in character, grounded in the facts given, and coherent. */
async function judgeText(judge: HttpLlmClient, kind: 'journal' | 'dream', c: EvalCase, text: string): Promise<number> {
  const facts = statePrompt(c.view, c.reason, false).slice(0, 6000);
  const res = await judge.generate({ class: 'capable', thinkingLevel: 'low', maxOutputTokens: 4000, temperature: 0,
    system: 'You grade text written in the voice of a stone-age village chief. Answer only with JSON {"score": n, "why": "..."} where n is an integer 1 to 5.',
    messages: [{ role: 'user', text: `Facts the chief knows:\n${facts}\n\n${kind === 'journal' ? "The chief's journal entry" : "The chief's reply to a spirit in a dream"}:\n"${text}"\n\nScore 5 if it is in character (no modern ideas or words), grounded only in the facts above, coherent and specific; 3 if plausible but generic or slightly off; 1 if out of character, contradicts the facts, or is not prose.` }],
    schema: { type: 'object', properties: { score: { type: 'integer' }, why: { type: 'string' } }, required: ['score', 'why'] } });
  const j = res.json as { score?: number } | undefined; return Math.max(1, Math.min(5, Number(j?.score ?? 3)));
}

async function main() {
  const models = arg('models', 'gemini-3.8-flash').split(','); const cats = arg('categories', '').split(',').filter(Boolean); const limit = Number(arg('limit', '0'));
  const withJudge = argv.includes('--judge'); const concurrency = Number(arg('concurrency', '4'));
  const corpusPath = arg('corpus', 'out/evals/corpus.json'); if (!existsSync(corpusPath)) throw new Error(`no corpus at ${corpusPath}; run build.ts first`);
  let cases = JSON.parse(readFileSync(corpusPath, 'utf8')) as EvalCase[];
  if (cats.length) cases = cases.filter(c => cats.includes(c.category)); if (limit) cases = cases.slice(0, limit);
  const token = await anonToken(); const client = new HttpLlmClient(proxy, async () => token); const judge = withJudge ? new HttpLlmClient(proxy, async () => token) : undefined;
  mkdirSync('out/evals', { recursive: true });
  for (const model of models) {
    const results: CaseResult[] = []; let i = 0;
    const workers = Array.from({ length: concurrency }, async () => { for (;;) { const c = cases[i++]; if (!c) return; const r = await runCase(client, model, c, judge); results.push(r); process.stdout.write(`${model} ${r.category} ${r.id} ${r.score.toFixed(2)}${r.error ? ` ERR ${r.error}` : ''} $${r.cost.toFixed(4)} ${r.ms}ms\n`); } });
    await Promise.all(workers);
    const file = `out/evals/${model.replace(/[^a-z0-9.-]/gi, '_')}.json`; writeFileSync(file, JSON.stringify({ model, when: new Date().toISOString(), results }, null, 1));
    const byCat: Record<string, number[]> = {}; for (const r of results) (byCat[r.category] ??= []).push(r.score);
    console.log(`== ${model}: ${results.length} cases, mean ${(results.reduce((a, r) => a + r.score, 0) / results.length).toFixed(3)}, cost $${results.reduce((a, r) => a + r.cost, 0).toFixed(3)}, errors ${results.filter(r => r.error).length}; by category ${Object.entries(byCat).map(([k, v]) => `${k}=${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)}`).join(' ')}`);
  }
}
if (process.argv[1] && process.argv[1].endsWith('run.ts')) main().catch(e => { console.error(e); process.exit(1); });
