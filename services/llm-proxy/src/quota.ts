/**
 * The daily spend ceiling, per principal per UTC day.
 *
 * Two counters live in one document. **Dollars are the real limit**: `estimateCost` prices every call from
 * the catalog in `models.ts`, and that is what the owner's budget is actually denominated in. Tokens stay as
 * a backstop, because an unpriced model (one absent from the catalog) estimates at zero and would otherwise
 * slip past a spend-only cap for ever. Whichever ceiling is reached first stops the caller.
 */
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

/**
 * Spend accumulates as integer micro-dollars. A single cheap call costs a few millionths of a dollar, so
 * holding dollars as a float and incrementing it all day would drift; integers increment exactly.
 */
export function toMicroUsd(usd: number): number {
  return Number.isFinite(usd) && usd > 0 ? Math.round(usd * 1_000_000) : 0;
}

export function fromMicroUsd(micro: number): number {
  return Math.round(micro) / 1_000_000;
}

export interface QuotaState {
  /** Tokens spent today (the backstop counter). */
  used: number;
  limit: number;
  /** Dollars spent today, priced from the catalog. */
  usedUsd: number;
  limitUsd: number;
  resetAt: string;
}

function dollars(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Pure decision: why this principal may not spend any more today, or undefined when they may. Separated from
 * the store read so the ceiling can be tested without Firestore, as `inviteProblem` is for the invitation gate.
 *
 * Spend is checked first because it is the limit the budget is written in; the token count is only consulted
 * when spend is still under, which is where an unpriced model shows up.
 */
export function quotaProblem(
  usedMicro: number,
  usedTokens: number,
  limitUsd: number,
  limitTokens: number,
): { code: string; message: string } | undefined {
  const limitMicro = toMicroUsd(limitUsd);
  if (limitMicro > 0 && usedMicro >= limitMicro) {
    return { code: 'quota', message: `daily spend limit of ${dollars(limitUsd)} reached` };
  }
  if (limitTokens > 0 && usedTokens >= limitTokens) {
    return { code: 'quota', message: 'daily token quota exhausted' };
  }
  return undefined;
}

/** Throws 429 when the principal has already spent today's allowance, 503 if the store is unreachable. */
export async function checkQuota(p: Principal, now: Date = new Date()): Promise<QuotaState> {
  const ref = getFirestore().collection(config.quotaCollection).doc(quotaDocId(p, utcDay(now)));
  let used = 0;
  let usedMicro = 0;
  try {
    const snap = await ref.get();
    used = Number(snap.get('tokens') ?? 0);
    // Documents written before the spend cap existed carry tokens only.
    usedMicro = Number(snap.get('microUsd') ?? 0);
  } catch (err) {
    log('ERROR', 'quota store unavailable', errorFields(err));
    // Fail closed: the quota is the cost backstop, so an unreadable store blocks rather than opens.
    throw new HttpError(503, 'quota_unavailable', 'quota store unavailable, retry shortly');
  }
  const state: QuotaState = {
    used,
    limit: config.dailyTokenQuota,
    usedUsd: fromMicroUsd(usedMicro),
    limitUsd: config.dailyUsdQuota,
    resetAt: nextUtcMidnight(now).toISOString(),
  };
  const problem = quotaProblem(usedMicro, used, config.dailyUsdQuota, config.dailyTokenQuota);
  if (problem) {
    throw new HttpError(429, problem.code, problem.message, {
      resetAt: state.resetAt,
      usedUsd: state.usedUsd,
      limitUsd: state.limitUsd,
      used,
      limit: state.limit,
    });
  }
  return state;
}

/**
 * Adds a call's tokens and cost to today's counters. Best-effort; a failure is logged, not surfaced, because
 * the request has already been served by the time this runs.
 */
export async function recordUsage(p: Principal, tokens: number, costUsd = 0, now: Date = new Date()): Promise<void> {
  const micro = toMicroUsd(costUsd);
  if (!(tokens > 0) && micro <= 0) return;
  const ref = getFirestore().collection(config.quotaCollection).doc(quotaDocId(p, utcDay(now)));
  try {
    await ref.set(
      {
        ...(tokens > 0 ? { tokens: FieldValue.increment(tokens) } : {}),
        ...(micro > 0 ? { microUsd: FieldValue.increment(micro) } : {}),
        principal: p.kind,
        day: utcDay(now),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    log('ERROR', 'quota record failed', errorFields(err));
  }
}
