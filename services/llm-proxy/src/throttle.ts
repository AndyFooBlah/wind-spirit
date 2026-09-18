/**
 * Brakes on `POST /v1/invite/redeem`. The invitation code space is large (see `mintCode`) but the endpoint is
 * reachable by any anonymous Firebase user, so guessing is metered two ways:
 *
 *  - a fixed window of attempts per uid and per client IP (a real player needs one or two);
 *  - a lockout after a run of consecutive failures on either key.
 *
 * Counters live in Firestore (`inviteAttempts/{key}`), so they survive instance restarts and are shared across
 * instances. The decision functions are pure; `InviteThrottle` wires them to an `AttemptStore`. An unreachable
 * store fails closed (503), the same rule the quota and the gate itself follow.
 */
import { createHash } from 'node:crypto';
import { getFirestore, type Transaction } from 'firebase-admin/firestore';
import { HttpError } from './errors.js';
import { errorFields, log } from './log.js';

export interface AttemptState {
  /** Attempts in the current window. */
  count: number;
  /** Epoch ms when the current window opened. */
  windowStart: number;
  /** Consecutive failed attempts; reset by a success or by an expired lockout. */
  failures: number;
  /** Epoch ms until which the key is locked out. */
  lockedUntil?: number;
}

export interface Limits {
  windowMs: number;
  maxAttempts: number;
  lockoutFailures: number;
  lockoutMs: number;
}

export type Verdict =
  | { ok: true; state: AttemptState }
  | { ok: false; reason: 'locked' | 'window'; retryAfterMs: number; state: AttemptState };

const fresh = (now: number): AttemptState => ({ count: 0, windowStart: now, failures: 0 });

/** Pure: may one more attempt go ahead now? On yes, the returned state already counts it. */
export function admit(state: AttemptState | undefined, limits: Limits, now: number): Verdict {
  let s: AttemptState = state ? { ...state } : fresh(now);
  if (s.lockedUntil !== undefined) {
    if (s.lockedUntil > now) return { ok: false, reason: 'locked', retryAfterMs: s.lockedUntil - now, state: s };
    // The lockout has served its time: start clean rather than re-locking on the very next miss.
    s = fresh(now);
  }
  if (now - s.windowStart >= limits.windowMs) s = { ...s, count: 0, windowStart: now };
  if (s.count >= limits.maxAttempts) {
    return { ok: false, reason: 'window', retryAfterMs: Math.max(1, s.windowStart + limits.windowMs - now), state: s };
  }
  return { ok: true, state: { ...s, count: s.count + 1 } };
}

/** Pure: record how an admitted attempt ended. `lockedNow` is true on the attempt that triggers a lockout. */
export function settle(state: AttemptState | undefined, succeeded: boolean, limits: Limits, now: number): { state: AttemptState; lockedNow: boolean } {
  const s: AttemptState = state ? { ...state } : fresh(now);
  if (succeeded) {
    s.failures = 0;
    delete s.lockedUntil;
    return { state: s, lockedNow: false };
  }
  s.failures += 1;
  if (s.failures >= limits.lockoutFailures && s.lockedUntil === undefined) {
    s.lockedUntil = now + limits.lockoutMs;
    return { state: s, lockedNow: true };
  }
  return { state: s, lockedNow: false };
}

/** Read every key's state atomically, decide, and persist the states the decision returns (null = leave as is). */
export interface AttemptStore {
  transact<T>(keys: string[], decide: (states: (AttemptState | undefined)[]) => { writes: (AttemptState | null)[]; result: T }): Promise<T>;
}

export class MemoryAttemptStore implements AttemptStore {
  readonly map = new Map<string, AttemptState>();
  async transact<T>(keys: string[], decide: (states: (AttemptState | undefined)[]) => { writes: (AttemptState | null)[]; result: T }): Promise<T> {
    const { writes, result } = decide(keys.map((k) => this.map.get(k)));
    writes.forEach((w, i) => { if (w) this.map.set(keys[i]!, w); });
    return result;
  }
}

export class FirestoreAttemptStore implements AttemptStore {
  constructor(private readonly collection: string) {}
  async transact<T>(keys: string[], decide: (states: (AttemptState | undefined)[]) => { writes: (AttemptState | null)[]; result: T }): Promise<T> {
    const db = getFirestore();
    const refs = keys.map((k) => db.collection(this.collection).doc(k));
    return db.runTransaction(async (tx: Transaction) => {
      const snaps = await Promise.all(refs.map((r) => tx.get(r)));
      const states = snaps.map((s) => (s.exists ? (s.data() as AttemptState) : undefined));
      const { writes, result } = decide(states);
      writes.forEach((w, i) => { if (w) tx.set(refs[i]!, { ...w, updatedAt: new Date().toISOString() }); });
      return result;
    });
  }
}

export interface ThrottleLimits {
  uid: Limits;
  ip: Limits;
}

/** Log-safe key for an IP: hashed, like `principalLabel` does for logs. */
export function ipKey(ip: string): string {
  return `ip_${createHash('sha256').update(ip).digest('hex').slice(0, 24)}`;
}

export class InviteThrottle {
  constructor(
    private readonly store: AttemptStore,
    private readonly limits: ThrottleLimits,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /**
   * Admit one redemption attempt for this uid from this IP, counting it against both, or throw 429 with
   * `Retry-After`. Returns the function to call with the outcome once the redemption has been tried.
   */
  async admit(uidKey: string, ip: string): Promise<(succeeded: boolean) => Promise<void>> {
    const keys = [`uid_${uidKey.replace(/\//g, '_')}`, ipKey(ip)];
    const limits = [this.limits.uid, this.limits.ip];
    const now = this.clock();
    let blocked: Extract<Verdict, { ok: false }> | undefined;
    try {
      blocked = await this.store.transact(keys, (states) => {
        const verdicts = states.map((s, i) => admit(s, limits[i]!, now));
        const worst = verdicts.filter((v): v is Extract<Verdict, { ok: false }> => !v.ok).sort((a, b) => b.retryAfterMs - a.retryAfterMs)[0];
        if (worst) return { writes: [null, null], result: worst };
        return { writes: verdicts.map((v) => v.state), result: undefined };
      });
    } catch (err) {
      log('ERROR', 'invite attempt store unavailable', errorFields(err));
      throw new HttpError(503, 'invite_unavailable', 'invitation store unavailable, retry shortly');
    }
    if (blocked) {
      const retryAfterSeconds = Math.ceil(blocked.retryAfterMs / 1000);
      log('WARNING', 'invite redeem throttled', { uidKey, reason: blocked.reason, retryAfterSeconds });
      throw new HttpError(
        429,
        'too_many_attempts',
        blocked.reason === 'locked' ? 'too many wrong invitation codes; try again later' : 'too many invitation attempts; wait a few minutes',
        { retryAfterSeconds },
        { 'Retry-After': String(retryAfterSeconds) },
      );
    }
    return async (succeeded: boolean) => {
      const at = this.clock();
      try {
        await this.store.transact(keys, (states) => {
          const outcomes = states.map((s, i) => settle(s, succeeded, limits[i]!, at));
          return { writes: outcomes.map((o) => o.state), result: outcomes.map((o) => o.lockedNow) };
        }).then((locked) => {
          locked.forEach((l, i) => { if (l) log('WARNING', 'invite lockout', { key: i === 0 ? 'uid' : 'ip', uidKey, lockoutMs: limits[i]!.lockoutMs }); });
        });
      } catch (err) {
        // The attempt was already counted in the window on admit; losing the failure tally is the lesser harm.
        log('ERROR', 'invite attempt settle failed', errorFields(err));
      }
    };
  }
}
