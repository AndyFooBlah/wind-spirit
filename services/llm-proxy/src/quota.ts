import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { errorFields, log } from './log.js';
import type { Principal } from './auth.js';

/** UTC day key, e.g. 2026-09-12. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Start of the next UTC day, when the quota resets. */
export function nextUtcMidnight(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/** Firestore document id for a principal on a day. Slashes are the only illegal char in ids. */
export function quotaDocId(p: Principal, day: string): string {
  return `${day}_${p.kind}_${p.id.replace(/\//g, '_')}`;
}

export interface QuotaState {
  used: number;
  limit: number;
  resetAt: string;
}

/** Throws 429 when the principal has already consumed today's quota, 503 if the store is unreachable. */
export async function checkQuota(p: Principal, now: Date = new Date()): Promise<QuotaState> {
  const ref = getFirestore().collection(config.quotaCollection).doc(quotaDocId(p, utcDay(now)));
  let used = 0;
  try {
    const snap = await ref.get();
    used = Number(snap.get('tokens') ?? 0);
  } catch (err) {
    log('ERROR', 'quota store unavailable', errorFields(err));
    // Fail closed: the quota is the cost backstop, so an unreadable store blocks rather than opens.
    throw new HttpError(503, 'quota_unavailable', 'quota store unavailable, retry shortly');
  }
  const state = { used, limit: config.dailyTokenQuota, resetAt: nextUtcMidnight(now).toISOString() };
  if (used >= config.dailyTokenQuota) {
    throw new HttpError(429, 'quota', 'daily token quota exhausted', { resetAt: state.resetAt, used, limit: state.limit });
  }
  return state;
}

/** Adds tokens to today's counter. Best-effort; a failure is logged, not surfaced. */
export async function recordUsage(p: Principal, tokens: number, now: Date = new Date()): Promise<void> {
  if (!(tokens > 0)) return;
  const ref = getFirestore().collection(config.quotaCollection).doc(quotaDocId(p, utcDay(now)));
  try {
    await ref.set(
      { tokens: FieldValue.increment(tokens), principal: p.kind, day: utcDay(now), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  } catch (err) {
    log('ERROR', 'quota record failed', errorFields(err));
  }
}
