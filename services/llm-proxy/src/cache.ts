import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from './config.js';
import { errorFields, log } from './log.js';

/**
 * Registry of explicit Gemini context caches, keyed by the client's `cache.key`.
 *
 * A record is only reused when the model and the content hash match, so a changed system prompt
 * (or a different model for the same key) transparently creates a fresh cache. Records are kept
 * in memory (per instance) and mirrored to Firestore `caches/{key}` so other instances and later
 * cold starts find them. Prefixes below the provider minimum are remembered as "too short" for
 * an hour so we do not pay a failed create call per request.
 */
export interface CacheRecord {
  name: string;
  model: string;
  contentHash: string;
  expiresAt: number; // epoch ms
  tokens: number;
}

const memory = new Map<string, CacheRecord>();
const tooShort = new Map<string, number>(); // key|hash -> until epoch ms

export function contentHash(model: string, parts: unknown): string {
  return createHash('sha256').update(JSON.stringify({ model, parts })).digest('hex');
}

function fresh(rec: CacheRecord | undefined, model: string, hash: string, now: number): rec is CacheRecord {
  // 30 s of slack so a cache that expires mid-request is not handed out.
  return !!rec && rec.model === model && rec.contentHash === hash && rec.expiresAt - 30_000 > now;
}

export async function lookup(key: string, model: string, hash: string, now = Date.now()): Promise<CacheRecord | undefined> {
  const m = memory.get(key);
  if (fresh(m, model, hash, now)) return m;
  try {
    const snap = await getFirestore().collection(config.cacheCollection).doc(key).get();
    if (snap.exists) {
      const d = snap.data() as Partial<CacheRecord>;
      const rec: CacheRecord = {
        name: String(d.name ?? ''),
        model: String(d.model ?? ''),
        contentHash: String(d.contentHash ?? ''),
        expiresAt: Number(d.expiresAt ?? 0),
        tokens: Number(d.tokens ?? 0),
      };
      if (fresh(rec, model, hash, now)) {
        memory.set(key, rec);
        return rec;
      }
    }
  } catch (err) {
    log('WARNING', 'cache registry read failed', { key, ...errorFields(err) });
  }
  return undefined;
}

export async function remember(key: string, rec: CacheRecord): Promise<void> {
  memory.set(key, rec);
  try {
    await getFirestore().collection(config.cacheCollection).doc(key).set({ ...rec, updatedAt: Date.now() });
  } catch (err) {
    log('WARNING', 'cache registry write failed', { key, ...errorFields(err) });
  }
}

export function forget(key: string): void {
  memory.delete(key);
}

export function markTooShort(key: string, hash: string, now = Date.now()): void {
  tooShort.set(`${key}|${hash}`, now + 3_600_000);
  if (tooShort.size > 5000) tooShort.clear();
}

export function isTooShort(key: string, hash: string, now = Date.now()): boolean {
  const until = tooShort.get(`${key}|${hash}`);
  return until !== undefined && until > now;
}

/** Test hook. */
export function resetCacheRegistry(): void {
  memory.clear();
  tooShort.clear();
}
