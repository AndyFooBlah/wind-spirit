import { describe, expect, it } from 'vitest';
import { inviteProblem, normalizeCode } from '../src/invites.js';

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
