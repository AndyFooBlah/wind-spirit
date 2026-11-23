import { describe, expect, it } from 'vitest';
import { fromMicroUsd, nextUtcMidnight, quotaDocId, quotaProblem, toMicroUsd, utcDay } from '../src/quota.js';
import { estimateCost, ZERO_USAGE } from '../src/models.js';

describe('micro-dollars', () => {
  it('round-trips a price to the millionth', () => {
    expect(toMicroUsd(3)).toBe(3_000_000);
    expect(fromMicroUsd(3_000_000)).toBe(3);
    expect(fromMicroUsd(toMicroUsd(0.000123))).toBe(0.000123);
  });
  it('treats absent, negative and non-finite costs as nothing spent', () => {
    expect(toMicroUsd(0)).toBe(0);
    expect(toMicroUsd(-1)).toBe(0);
    expect(toMicroUsd(Number.NaN)).toBe(0);
    expect(toMicroUsd(Number.POSITIVE_INFINITY)).toBe(0);
  });
  it('accumulates exactly, where a float would drift', () => {
    // Ten thousand calls at a tenth of a cent each is exactly $10.
    let micro = 0;
    for (let i = 0; i < 10_000; i++) micro += toMicroUsd(0.001);
    expect(micro).toBe(10_000_000);
    expect(fromMicroUsd(micro)).toBe(10);
  });
});

describe('quotaProblem', () => {
  const LIMIT_USD = 3;
  const LIMIT_TOKENS = 2_000_000;
  it('lets a principal under both ceilings through', () => {
    expect(quotaProblem(2_999_999, 1_999_999, LIMIT_USD, LIMIT_TOKENS)).toBeUndefined();
  });
  it('stops on spend at exactly the limit', () => {
    expect(quotaProblem(3_000_000, 0, LIMIT_USD, LIMIT_TOKENS)?.message).toBe('daily spend limit of $3.00 reached');
  });
  it('stops on tokens even when spend is nil, which is the unpriced-model case', () => {
    // A model absent from the catalog estimates at $0, so only the token backstop can stop it.
    expect(estimateCost('not-a-model', { ...ZERO_USAGE, input: 1e9, output: 1e9 })).toBe(0);
    expect(quotaProblem(0, LIMIT_TOKENS, LIMIT_USD, LIMIT_TOKENS)?.message).toBe('daily token quota exhausted');
  });
  it('reports spend rather than tokens when both are exhausted', () => {
    expect(quotaProblem(9_000_000, 9_000_000, LIMIT_USD, LIMIT_TOKENS)?.message).toMatch(/spend limit/);
  });
  it('a limit of zero or less means no ceiling of that kind', () => {
    expect(quotaProblem(9_000_000, 0, 0, LIMIT_TOKENS)).toBeUndefined();
    expect(quotaProblem(0, 9_000_000, LIMIT_USD, 0)).toBeUndefined();
  });
  it('formats the figure as money, not as a float', () => {
    expect(quotaProblem(1, 0, 0.000001, 0)?.message).toBe('daily spend limit of $0.00 reached');
    expect(quotaProblem(2_500_000, 0, 2.5, 0)?.message).toBe('daily spend limit of $2.50 reached');
  });
});

describe('the ceiling against real catalog prices', () => {
  // The point of pricing in dollars: the same token count is a very different bill by class.
  const million = { ...ZERO_USAGE, input: 500_000, output: 500_000 };
  it('spans an order of magnitude across the classes the game uses', () => {
    const cheapest = estimateCost('gemini-2.5-flash-lite', million);
    const routine = estimateCost('gemini-3.8-flash', million);
    const capable = estimateCost('gemini-3.1-pro-preview', million);
    expect(cheapest).toBeGreaterThan(0);
    expect(routine / cheapest).toBeGreaterThan(10);
    expect(capable).toBeGreaterThan(routine);
  });
  it('a $3 day buys far more of the cheapest class than of the dearest', () => {
    const budget = 3;
    const callsAt = (model: string) => budget / estimateCost(model, { ...ZERO_USAGE, input: 2_000, output: 500 });
    expect(callsAt('gemini-2.5-flash-lite')).toBeGreaterThan(callsAt('gemini-3.1-pro-preview') * 10);
  });
});

describe('day keys', () => {
  it('keys on the UTC day and resets at the next UTC midnight', () => {
    const t = new Date('2026-11-22T23:59:59Z');
    expect(utcDay(t)).toBe('2026-11-22');
    expect(nextUtcMidnight(t).toISOString()).toBe('2026-11-23T00:00:00.000Z');
  });
  it('a document id survives a principal id containing slashes', () => {
    expect(quotaDocId({ kind: 'user', id: 'a/b/c' }, '2026-11-22')).toBe('2026-11-22_user_a_b_c');
  });
});
