import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/errors.js';
import { admit, InviteThrottle, ipKey, MemoryAttemptStore, settle, type AttemptStore, type Limits } from '../src/throttle.js';

const L: Limits = { windowMs: 15 * 60_000, maxAttempts: 5, lockoutFailures: 10, lockoutMs: 24 * 3_600_000 };
const T0 = Date.parse('2026-09-18T12:00:00Z');

describe('admit (pure)', () => {
  it('counts attempts within a window and refuses the one over the limit with a retry hint', () => {
    let s = admit(undefined, L, T0);
    expect(s.ok).toBe(true);
    for (let i = 1; i < 5; i++) { s = admit(s.state, L, T0 + i * 1000); expect(s.ok).toBe(true); }
    const sixth = admit(s.state, L, T0 + 6000);
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) { expect(sixth.reason).toBe('window'); expect(sixth.retryAfterMs).toBe(L.windowMs - 6000); }
  });
  it('opens a fresh window once the old one has elapsed', () => {
    const full = { count: 5, windowStart: T0, failures: 3 };
    expect(admit(full, L, T0 + L.windowMs - 1).ok).toBe(false);
    const v = admit(full, L, T0 + L.windowMs);
    expect(v.ok).toBe(true);
    if (v.ok) { expect(v.state.count).toBe(1); expect(v.state.failures).toBe(3); }
  });
  it('honours a lockout, then starts clean after it', () => {
    const locked = { count: 1, windowStart: T0, failures: 10, lockedUntil: T0 + 3600_000 };
    const v = admit(locked, L, T0 + 10);
    expect(v.ok).toBe(false);
    if (!v.ok) { expect(v.reason).toBe('locked'); expect(v.retryAfterMs).toBe(3600_000 - 10); }
    const after = admit(locked, L, T0 + 3600_000);
    expect(after.ok).toBe(true);
    if (after.ok) { expect(after.state.failures).toBe(0); expect(after.state.lockedUntil).toBeUndefined(); }
  });
});

describe('settle (pure)', () => {
  it('a success clears the failure run', () => {
    const r = settle({ count: 2, windowStart: T0, failures: 9 }, true, L, T0);
    expect(r.state.failures).toBe(0); expect(r.lockedNow).toBe(false);
  });
  it('the Nth consecutive failure locks the key out once', () => {
    const r = settle({ count: 2, windowStart: T0, failures: 9 }, false, L, T0);
    expect(r.lockedNow).toBe(true); expect(r.state.lockedUntil).toBe(T0 + L.lockoutMs);
    const again = settle(r.state, false, L, T0 + 1);
    expect(again.lockedNow).toBe(false); expect(again.state.lockedUntil).toBe(T0 + L.lockoutMs);
  });
});

describe('InviteThrottle', () => {
  const limits = { uid: L, ip: { ...L, maxAttempts: 20, lockoutFailures: 40 } };
  function make(store: AttemptStore = new MemoryAttemptStore()) {
    let now = T0;
    const t = new InviteThrottle(store, limits, () => now);
    return { t, tick: (ms: number) => { now += ms; } };
  }
  it('admits five attempts for a uid, then answers 429 with Retry-After', async () => {
    const { t } = make();
    for (let i = 0; i < 5; i++) await (await t.admit('user_a', '1.2.3.4'))(false);
    const err = await t.admit('user_a', '1.2.3.4').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    const h = err as HttpError;
    expect(h.status).toBe(429); expect(h.code).toBe('too_many_attempts');
    expect(h.headers['Retry-After']).toBe(String(15 * 60));
    expect(h.body()).toMatchObject({ retryAfterSeconds: 15 * 60 });
  });
  it('a different uid from the same IP is still admitted (IP limit is looser)', async () => {
    const { t } = make();
    for (let i = 0; i < 5; i++) await (await t.admit('user_a', '1.2.3.4'))(false);
    await expect(t.admit('user_b', '1.2.3.4')).resolves.toBeTypeOf('function');
  });
  it('the IP window bites across many uids, even when every attempt succeeded', async () => {
    const { t } = make();
    for (let i = 0; i < 20; i++) await (await t.admit(`user_${i}`, '9.9.9.9'))(true);
    const err = (await t.admit('user_new', '9.9.9.9').catch((e: unknown) => e)) as HttpError;
    expect(err.status).toBe(429); expect(err.message).toMatch(/wait a few minutes/);
    await expect(t.admit('user_new', '9.9.9.8')).resolves.toBeTypeOf('function');
  });
  it('an IP locks out only after a long run of failures across windows; ten from one household do not', async () => {
    const { t, tick } = make();
    for (let i = 0; i < 10; i++) await (await t.admit(`user_${i}`, '9.9.9.9'))(false);
    await expect(t.admit('user_11', '9.9.9.9')).resolves.toBeTypeOf('function'); // 11th attempt in the window: no IP lock
    tick(L.windowMs);
    for (let i = 0; i < 20; i++) await (await t.admit(`bot_a_${i}`, '9.9.9.9'))(false); // 30 consecutive failures
    tick(L.windowMs);
    for (let i = 0; i < 10; i++) await (await t.admit(`bot_b_${i}`, '9.9.9.9'))(false); // 40th failure locks the IP
    const err = (await t.admit('bot_final', '9.9.9.9').catch((e: unknown) => e)) as HttpError;
    expect(err.status).toBe(429); expect(err.message).toMatch(/wrong invitation codes/);
    await expect(t.admit('bot_final', '9.9.9.8')).resolves.toBeTypeOf('function'); // other IPs unaffected
  });
  it('a success in the run resets the lockout counter', async () => {
    const { t, tick } = make();
    for (let i = 0; i < 4; i++) await (await t.admit('user_a', '1.2.3.4'))(false);
    await (await t.admit('user_a', '1.2.3.4'))(true);
    tick(L.windowMs);
    for (let i = 0; i < 5; i++) await (await t.admit('user_a', '1.2.3.4'))(false);
    tick(L.windowMs);
    await expect(t.admit('user_a', '1.2.3.4')).resolves.toBeTypeOf('function'); // 9 failures, no lock
  });
  it('a refused attempt is not written (does not extend the window)', async () => {
    const store = new MemoryAttemptStore(); const { t } = make(store);
    for (let i = 0; i < 5; i++) await (await t.admit('user_a', '1.2.3.4'))(false);
    const before = { ...store.map.get('uid_user_a')! };
    await t.admit('user_a', '1.2.3.4').catch(() => undefined);
    expect(store.map.get('uid_user_a')).toEqual(before);
  });
  it('fails closed when the store is unreachable', async () => {
    const broken: AttemptStore = { transact: async () => { throw new Error('firestore down'); } };
    const { t } = make(broken);
    await expect(t.admit('user_a', '1.2.3.4')).rejects.toMatchObject({ status: 503, code: 'invite_unavailable' });
  });
  it('hashes IPs into keys and tolerates slashes in uids', async () => {
    expect(ipKey('1.2.3.4')).toMatch(/^ip_[0-9a-f]{24}$/);
    expect(ipKey('1.2.3.4')).not.toContain('1.2.3.4');
    const store = new MemoryAttemptStore(); const { t } = make(store);
    await t.admit('user_a/b', '::1');
    expect([...store.map.keys()]).toEqual(['uid_user_a_b', ipKey('::1')]);
  });
});
