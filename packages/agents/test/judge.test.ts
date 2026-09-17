import { describe, expect, it } from 'vitest';
import { generateWorld, CAP_NAMES } from '@wind-spirit/gen';
import { buildView, MockLlmClient } from '../src/index.js';
import { LlmJudge, binaryConfidence, credibilityState, hostState, verdictState } from '../src/judge/index.js';
import type { Mandate } from '@wind-spirit/sim';

const view = () => { const w = generateWorld({ seed: 'judge' }); return buildView(w, w.villages[0], { events: [], capNames: CAP_NAMES }); };
const mandate = (o: Partial<Mandate> = {}): Mandate => ({ offer: {}, want: {}, ...o } as Mandate);

describe('judgment state', () => {
  it('carries the facts a credibility judgment turns on, and not the order menu', () => {
    const s = credibilityState({ view: view(), whisper: 'Plant nothing.' });
    expect(s.whisper).toBe('Plant nothing.');
    expect(s).toHaveProperty('what_the_spirit_said_before_and_what_came_of_it');
    expect(s).toHaveProperty('land');
    // far smaller than statePrompt: a narrow question does not pay for the gazetteer
    expect(JSON.stringify(s).length).toBeLessThan(4000);
  });
  it('gives the verdict question the claim and what happened since', () => {
    const s = verdictState({ view: view(), claim: 'Rain will come.', since: ['year 3, spring: no rain'] });
    expect(s.the_claim).toBe('Rain will come.');
    expect(s.what_happened_since).toEqual(['year 3, spring: no rain']);
  });
  it('tells the host question who is asking and what for', () => {
    const s = hostState({ view: view(), from: 'strangers', mandate: mandate({ threat: true }), cname: id => id, rname: id => id });
    expect(s.they_back_the_ask_with_a_threat_of_war).toBe(true);
    expect(s.them_as_we_know_them).toBe('strangers we have no dealings with');
  });
});

describe('LlmJudge', () => {
  it('composes credibility from the two judgments rather than asking for a verdict', async () => {
    const j = new LlmJudge({ client: new MockLlmClient(() => ({ consistent: 0.8, harmful: 0.25 })) });
    const r = await j.credible({ view: view(), whisper: 'The winter will be hard.' });
    expect(r.p).toBeCloseTo(0.6, 5);           // 0.8 * (1 - 0.25)
    expect(r.value).toBe(true);
    expect(r.distribution).toEqual({ consistent: 0.8, harmful: 0.25 });
  });
  it('a consistent whisper that would cost a harvest is still not worth acting on', async () => {
    const j = new LlmJudge({ client: new MockLlmClient(() => ({ consistent: 0.9, harmful: 0.9 })) });
    const r = await j.credible({ view: view(), whisper: 'Plant nothing.' });
    expect(r.value).toBe(false);
  });
  it('clamps probabilities a model invents outside 0 to 1', async () => {
    const j = new LlmJudge({ client: new MockLlmClient(() => ({ consistent: 7, harmful: -2 })) });
    const r = await j.credible({ view: view(), whisper: 'anything' });
    expect(r.p).toBe(1);
  });
  it('reports the chosen label for verdicts and host answers, and bills the call', async () => {
    const j = new LlmJudge({ client: new MockLlmClient(req => (String(req.schema).includes('x') ? {} : { verdict: 'failed', probability: 0.7, answer: 'refuse' })) });
    const v = await j.verdict({ view: view(), claim: 'Rain.', since: [] });
    expect(v.value).toBe('failed'); expect(v.p).toBeCloseTo(0.7, 5);
    const h = await j.hostAnswer({ view: view(), from: 'them', mandate: mandate(), cname: id => id, rname: id => id });
    expect(h.value).toBe('refuse');
    expect(j.spent.calls).toBe(2);
  });
});

describe('binaryConfidence', () => {
  it('is nothing at a coin flip and everything at certainty', () => {
    expect(binaryConfidence(0.5)).toBe(0); expect(binaryConfidence(1)).toBe(1); expect(binaryConfidence(0)).toBe(1);
  });
});
