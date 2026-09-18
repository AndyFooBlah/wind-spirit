import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, inviteProblem, mintCode, normalizeCode, UninvitedCap } from '../src/invites.js';

describe('normalizeCode', () => {
  it('forgives case, spaces and underscores', () => {
    expect(normalizeCode('  Amber Heron 42 ')).toBe('amber-heron-42');
    expect(normalizeCode('amber_heron--42')).toBe('amber-heron-42');
  });
  it('rejects junk', () => {
    expect(normalizeCode('')).toBeUndefined();
    expect(normalizeCode('a/b')).toBeUndefined();
    expect(normalizeCode(42)).toBeUndefined();
    expect(normalizeCode('x'.repeat(65))).toBeUndefined();
  });
});

describe('inviteProblem', () => {
  const now = new Date('2026-09-12T12:00:00Z');
  const base = { label: 'friends', maxUses: 3, uses: 0 };
  it('accepts a live code', () => { expect(inviteProblem(base, now)).toBeUndefined(); });
  it('unknown code is a 404', () => { expect(inviteProblem(undefined, now)?.status).toBe(404); });
  it('disabled, expired and exhausted are 410 with distinct codes', () => {
    expect(inviteProblem({ ...base, disabled: true }, now)?.code).toBe('code_disabled');
    expect(inviteProblem({ ...base, expiresAt: '2026-09-11T00:00:00Z' }, now)?.code).toBe('code_expired');
    expect(inviteProblem({ ...base, expiresAt: '2026-09-13T00:00:00Z' }, now)).toBeUndefined();
    expect(inviteProblem({ ...base, uses: 3 }, now)?.code).toBe('code_exhausted');
  });
});

describe('mintCode', () => {
  it('is ten unambiguous base32 characters in two groups, and normalises to itself', () => {
    for (let i = 0; i < 200; i++) {
      const c = mintCode();
      expect(c).toMatch(/^[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}$/);
      expect(normalizeCode(c)).toBe(c);
      expect(normalizeCode(c.toUpperCase().replace('-', ' '))).toBe(c);
    }
  });
  it('has at least 2^40 possibilities and does not repeat in practice', () => {
    expect(Math.pow(CODE_ALPHABET.length, 10)).toBeGreaterThanOrEqual(2 ** 40);
    expect(CODE_ALPHABET.length).toBe(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    for (const ch of 'ilou') expect(CODE_ALPHABET).not.toContain(ch);
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(mintCode());
    expect(seen.size).toBe(5000);
  });
  it('still accepts the old word-word-NN shape', () => {
    expect(normalizeCode('amber-heron-42')).toBe('amber-heron-42');
  });
});

describe('UninvitedCap', () => {
  const T0 = 1_000_000;
  it('lets a uid through until the cap, then blocks for the rest of the window', () => {
    const cap = new UninvitedCap(3, 60_000);
    expect(cap.blockedFor('u', T0)).toBeUndefined();
    cap.strike('u', T0); cap.strike('u', T0 + 1); cap.strike('u', T0 + 2);
    expect(cap.blockedFor('u', T0 + 3)).toBe(60_000 - 3);
    expect(cap.blockedFor('v', T0 + 3)).toBeUndefined();
    expect(cap.blockedFor('u', T0 + 60_000)).toBeUndefined();
  });
  it('a redeemed seat clears the strikes', () => {
    const cap = new UninvitedCap(1, 60_000);
    cap.strike('u', T0);
    expect(cap.blockedFor('u', T0 + 1)).toBeDefined();
    cap.clear('u');
    expect(cap.blockedFor('u', T0 + 1)).toBeUndefined();
  });
});
