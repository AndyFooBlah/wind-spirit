import { describe, expect, it } from 'vitest';
import { generateWorld, CAP_NAMES } from '@wind-spirit/gen';
import { ChiefScheduler, buildView, credibilityLine, credulityThreshold, statePrompt, MockLlmClient } from '../src/index.js';
import { LlmJudge, binaryConfidence, credibilityState, hostState, verdictState } from '../src/judge/index.js';
import type { Judge, HostValue, Judgment } from '../src/judge/types.js';
import type { HostAnswer, Mandate } from '@wind-spirit/sim';

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

describe('the scheduler with a judge', () => {
  const setup = (judgeAnswer: HostValue | Error, modelAnswer: 'accept' | 'counter' | 'refuse') => {
    const w = generateWorld({ seed: 'judge-sched' });
    const host = w.villages[0]; const guest = w.villages[1] ?? w.villages[0];
    const prompts: string[] = [];
    const client = new MockLlmClient(req => { prompts.push(req.messages[req.messages.length - 1].text); return { answer: modelAnswer, give: {}, take: {}, journal: 'They came and we spoke.' }; });
    const judge: Judge = {
      name: 'stub',
      spent: { calls: 0, input: 0, output: 0, cost: 0 },
      credible: async () => ({ value: true, p: 1, confidence: 1 }),
      verdict: async () => ({ value: 'unverifiable' as const, p: 1, confidence: 1 }),
      hostAnswer: async () => { if (judgeAnswer instanceof Error) throw judgeAnswer; return { value: judgeAnswer, p: 0.9, confidence: 0.9 }; },
    };
    const answers: HostAnswer[] = [];
    const sched = new ChiefScheduler({
      client, capNames: CAP_NAMES, judge: () => judge,
      fallback: { decide: () => [], host: () => ({ kind: 'refuse', reason: 'habit' }) },
    });
    return { w, host, guest, sched, prompts, answers };
  };

  it('uses the judge answer, not the model field, and tells the model what was decided', async () => {
    const { w, host, guest, sched, prompts } = setup('refuse', 'accept');
    await sched.visitor(w, host, 0, guest.id, { offer: {}, want: {}, threat: true } as Mandate);
    const queued = sched.drain().find(i => i.type === 'HostDecided') as { answer: HostAnswer } | undefined;
    expect(queued?.answer.kind).toBe('refuse');                    // the judge's answer, not the model's 'accept'
    expect(prompts[0]).toContain('You have decided to refuse');    // and the prose was written for it
  });

  it('falls back to the model deciding when the judge throws', async () => {
    const { w, host, guest, sched, prompts } = setup(new Error('judge down'), 'accept');
    await sched.visitor(w, host, 0, guest.id, { offer: {}, want: {} } as Mandate);
    const queued = sched.drain().find(i => i.type === 'HostDecided') as { answer: HostAnswer } | undefined;
    expect(queued?.answer.kind).toBe('accept');                    // the model's own answer stands
    expect(prompts[0]).not.toContain('You have decided');
    expect(prompts[0]).toContain('Answer: accept');
  });

  it('decides with the model when no judge is configured', async () => {
    const w = generateWorld({ seed: 'judge-sched-2' });
    const client = new MockLlmClient(() => ({ answer: 'counter', give: {}, take: {}, journal: 'We bargained.' }));
    const sched = new ChiefScheduler({ client, capNames: CAP_NAMES, fallback: { decide: () => [], host: () => ({ kind: 'refuse', reason: 'habit' }) } });
    await sched.visitor(w, w.villages[0], 0, (w.villages[1] ?? w.villages[0]).id, { offer: {}, want: {} } as Mandate);
    const queued = sched.drain().find(i => i.type === 'HostDecided') as { answer: HostAnswer } | undefined;
    expect(queued?.answer.kind).toBe('counter');
  });
});

describe('credibility in the decision prompt', () => {
  const traits = (piety: number) => [piety, 500, 500, 500];
  const j = (consistent: number, harmful: number): Judgment<boolean> => {
    const p = consistent * (1 - harmful);
    return { value: p >= 0.5, p, confidence: Math.abs(p - 0.5) * 2, distribution: { consistent, harmful } };
  };

  it('says both things separately: how it squares, and what obeying costs', () => {
    const line = credibilityLine(j(0.05, 0.9), traits(500));
    expect(line).toContain('sits ill with what your people have seen');
    expect(line).toContain('cost you dearly');
    expect(line).toContain('trust your own eyes');
  });

  it('a whisper that fits and costs little is one to heed', () => {
    const line = credibilityLine(j(0.9, 0.05), traits(500));
    expect(line).toContain('sits well');
    expect(line).toContain('cost you little');
    expect(line).toContain('minded to heed it');
  });

  it('piety moves the line at which a chief acts, not the evidence', () => {
    expect(credulityThreshold(traits(1000))).toBeCloseTo(0.2, 5);
    expect(credulityThreshold(traits(500))).toBeCloseTo(0.4, 5);
    expect(credulityThreshold(traits(0))).toBeCloseTo(0.6, 5);
    const middling = j(0.7, 0.3);                                  // p = 0.49
    expect(credibilityLine(middling, traits(1000))).toContain('minded to heed it');
    expect(credibilityLine(middling, traits(0))).toContain('own eyes');
  });

  it('adds nothing at all to a prompt with no judgement, so old runs stay comparable', () => {
    const v = view();
    expect(statePrompt(v, 'season', true, {})).toBe(statePrompt(v, 'season'));
  });

  it('puts the line and the verdict note in the spirit section when there is one', () => {
    const v = view();
    const p = statePrompt(v, 'spirit', true, { credibility: 'What your own sense makes of it: nonsense.', verdictsJudged: true });
    expect(p).toContain('What your own sense makes of it: nonsense.');
    expect(p).toContain('do not rule on them again');
  });
});

describe('the scheduler with a judge, deliberating', () => {
  const stubJudge = (over: Partial<Judge> = {}): Judge => ({
    name: 'stub', spent: { calls: 0, input: 0, output: 0, cost: 0 },
    credible: async () => ({ value: false, p: 0.03, confidence: 0.94, distribution: { consistent: 0.05, harmful: 0.4 } }),
    verdict: async () => ({ value: 'failed' as const, p: 0.9, confidence: 0.9 }),
    hostAnswer: async () => ({ value: 'refuse' as const, p: 0.9, confidence: 0.9 }),
    ...over,
  });

  const withSpirit = () => {
    const w = generateWorld({ seed: 'deliberate' });
    const v = w.villages[0];
    v.inbox = ['Plant nothing this spring. The soil is cursed.'];
    v.chronicle = [{ id: 7, tick: 0, text: 'Rain will come before the harvest.', due: w.tick, check: { kind: 'judged' }, outcome: 'pending' }];
    return { w, v };
  };

  const build = (w: ReturnType<typeof generateWorld>, judge?: Judge) => {
    const prompts: string[] = [];
    const client = new MockLlmClient(req => { prompts.push(req.messages[req.messages.length - 1].text); return { orders: [{ task: 'forage', workers: 3 }], journal: 'We ate and we watched.', memoryNotes: [], verdicts: [{ claim: 7, verdict: 'fulfilled' }] }; });
    const sched = new ChiefScheduler({ client, capNames: CAP_NAMES, judge: judge ? () => judge : undefined, fallback: { decide: () => [], host: () => ({ kind: 'refuse', reason: 'habit' }) } });
    return { sched, prompts };
  };

  it('hands the chief the judge reading of the whisper before they decide', async () => {
    const { w, v } = withSpirit();
    const { sched, prompts } = build(w, stubJudge());
    await sched.deliberate(w, v, 'spirit');
    expect(prompts[0]).toContain('What your own sense makes of it');
    expect(prompts[0]).toContain('sits ill with what your people have seen');
  });

  it('rules on a due claim itself and ignores the verdict the model volunteered', async () => {
    const { w, v } = withSpirit();
    const { sched, prompts } = build(w, stubJudge());
    await sched.deliberate(w, v, 'spirit');
    const judgedInput = sched.drain().find(i => i.type === 'ChiefJudged') as { verdicts: { claim: number; verdict: string }[] } | undefined;
    expect(judgedInput?.verdicts).toEqual([{ claim: 7, verdict: 'failed' }]);   // the judge's, not the model's 'fulfilled'
    expect(prompts[0]).toContain('do not rule on them again');
  });

  it('leaves the decision exactly as it was when there is no judge', async () => {
    const { w, v } = withSpirit();
    const { sched, prompts } = build(w);
    await sched.deliberate(w, v, 'spirit');
    expect(prompts[0]).not.toContain('What your own sense makes of it');
    const judgedInput = sched.drain().find(i => i.type === 'ChiefJudged') as { verdicts: { claim: number; verdict: string }[] } | undefined;
    expect(judgedInput?.verdicts).toEqual([{ claim: 7, verdict: 'fulfilled' }]);   // the model's own
  });

  it('falls back to the model when the judge throws mid-deliberation', async () => {
    const { w, v } = withSpirit();
    const { sched, prompts } = build(w, stubJudge({ credible: async () => { throw new Error('judge down'); } }));
    await sched.deliberate(w, v, 'spirit');
    expect(prompts[0]).not.toContain('What your own sense makes of it');
    const judgedInput = sched.drain().find(i => i.type === 'ChiefJudged') as { verdicts: { claim: number; verdict: string }[] } | undefined;
    expect(judgedInput?.verdicts).toEqual([{ claim: 7, verdict: 'fulfilled' }]);
  });
});
