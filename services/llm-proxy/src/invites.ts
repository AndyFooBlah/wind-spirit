/**
 * Invitation gate. Every model call costs money, so a caller must have redeemed an invitation code
 * before /v1/generate or /v1/stream will serve them. Codes live in Firestore (`invites/{code}`), and
 * a redeemed code records the caller (`players/{uid}`). Codes are minted with `scripts/invite.ts`.
 */
import { randomBytes } from 'node:crypto';
import { FieldValue, getFirestore, type Transaction } from 'firebase-admin/firestore';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { errorFields, log } from './log.js';
import type { Principal } from './auth.js';

export interface InviteDoc {
  label: string;
  maxUses: number;
  uses: number;
  disabled?: boolean;
  /** ISO timestamp; absent means no expiry. */
  expiresAt?: string;
}

/**
 * Mint a fresh code: 50 random bits as ten base32 characters (`0-9 a-h j-k m-n p-t v-z`; no i, l, o or u, which read
 * as digits) in two groups, e.g. `7m3kq-x9d2t`. 32^10 = 2^50 possibilities, so guessing through the throttled
 * redeem endpoint is hopeless. Older `word-word-NN` codes are ordinary document ids and stay valid.
 */
export const CODE_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export function mintCode(chars = 10, group = 5): string {
  const bytes = randomBytes(chars);
  let out = '';
  for (let i = 0; i < chars; i++) {
    if (i > 0 && i % group === 0) out += '-';
    out += CODE_ALPHABET[bytes[i]! % 32];
  }
  return out;
}

/** Codes are typed by people: case, spaces and dashes are forgiven. Stored form is lowercase with dashes. */
export function normalizeCode(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const code = raw.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
  return /^[a-z0-9-]{4,64}$/.test(code) ? code : undefined;
}

/** Pure decision: why a code cannot be redeemed right now, or undefined when it can. */
export function inviteProblem(doc: InviteDoc | undefined, now: Date = new Date()): { status: number; code: string; message: string } | undefined {
  if (!doc) return { status: 404, code: 'invalid_code', message: 'that invitation code is not known' };
  if (doc.disabled) return { status: 410, code: 'code_disabled', message: 'that invitation has been withdrawn' };
  if (doc.expiresAt && Date.parse(doc.expiresAt) < now.getTime()) return { status: 410, code: 'code_expired', message: 'that invitation has expired' };
  if (doc.uses >= doc.maxUses) return { status: 410, code: 'code_exhausted', message: 'that invitation has been used up' };
  return undefined;
}

/**
 * How many gated requests an uninvited uid may make per window before it is refused without a store lookup.
 * In memory, per instance: it protects Firestore reads and log volume, not spend, which the gate already blocks.
 */
export class UninvitedCap {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();
  constructor(private readonly max: number, private readonly windowMs: number) {}
  /** Milliseconds until this uid may try again, or undefined when it is under the cap. */
  blockedFor(uid: string, now: number): number | undefined {
    const h = this.hits.get(uid);
    if (!h) return undefined;
    if (now - h.windowStart >= this.windowMs) { this.hits.delete(uid); return undefined; }
    return h.count >= this.max ? h.windowStart + this.windowMs - now : undefined;
  }
  strike(uid: string, now: number): void {
    const h = this.hits.get(uid);
    if (h && now - h.windowStart < this.windowMs) h.count += 1;
    else this.hits.set(uid, { count: 1, windowStart: now });
    if (this.hits.size > 10_000) this.hits.clear(); // bounded memory; a flood simply starts counting again
  }
  clear(uid: string): void { this.hits.delete(uid); }
}

const uninvitedCap = new UninvitedCap(config.invite.uninvitedRequests, config.invite.windowMs);

/** Recently confirmed players, so a season of chief calls costs one Firestore read, not one per call. */
const known = new Map<string, number>();
const KNOWN_TTL_MS = 5 * 60_000;

export function forgetPlayer(uid: string): void {
  known.delete(uid);
  uninvitedCap.clear(uid);
}

async function playerExists(uid: string): Promise<boolean> {
  const until = known.get(uid);
  if (until && until > Date.now()) return true;
  const snap = await getFirestore().collection(config.playersCollection).doc(uid).get();
  if (snap.exists && !snap.get('revoked')) {
    known.set(uid, Date.now() + KNOWN_TTL_MS);
    return true;
  }
  return false;
}

/** Throws 403 unless the caller has redeemed an invitation. Off when REQUIRE_INVITE=false (local dev). */
export async function requireInvite(p: Principal): Promise<void> {
  if (!config.requireInvite) return;
  if (p.kind !== 'user') throw new HttpError(403, 'not_invited', 'sign in and redeem an invitation code first');
  const now = Date.now();
  const wait = uninvitedCap.blockedFor(p.id, now);
  if (wait !== undefined) {
    const retryAfterSeconds = Math.ceil(wait / 1000);
    throw new HttpError(429, 'not_invited', 'this player has not redeemed an invitation code; stop retrying', { retryAfterSeconds }, { 'Retry-After': String(retryAfterSeconds) });
  }
  let ok = false;
  try {
    ok = await playerExists(p.id);
  } catch (err) {
    log('ERROR', 'players store unavailable', errorFields(err));
    // Fail closed: the gate is the cost backstop.
    throw new HttpError(503, 'invite_unavailable', 'invitation store unavailable, retry shortly');
  }
  if (!ok) {
    uninvitedCap.strike(p.id, now);
    throw new HttpError(403, 'not_invited', 'this player has not redeemed an invitation code');
  }
  uninvitedCap.clear(p.id);
}

export async function isInvited(p: Principal): Promise<boolean> {
  if (!config.requireInvite) return true;
  if (p.kind !== 'user') return false;
  return playerExists(p.id);
}

/**
 * Redeem a code for a user. Idempotent for a player who already holds a seat (any code): nothing is
 * consumed. Otherwise the code's use count goes up inside a transaction so a shared code cannot be
 * over-redeemed by a burst of friends clicking at once.
 */
export async function redeemInvite(p: Principal, rawCode: unknown, now: Date = new Date()): Promise<{ label: string; alreadyPlayer: boolean }> {
  if (!config.requireInvite) return { label: 'open', alreadyPlayer: true };
  if (p.kind !== 'user') throw new HttpError(401, 'unauthorized', 'sign in before redeeming an invitation');
  const code = normalizeCode(rawCode);
  if (!code) throw new HttpError(400, 'invalid_code', 'an invitation code is letters, digits and dashes, like 7m3kq-x9d2t');
  const db = getFirestore();
  const inviteRef = db.collection(config.invitesCollection).doc(code);
  const playerRef = db.collection(config.playersCollection).doc(p.id);
  try {
    const result = await db.runTransaction(async (tx: Transaction) => {
      const [player, invite] = await Promise.all([tx.get(playerRef), tx.get(inviteRef)]);
      if (player.exists && !player.get('revoked')) return { label: String(player.get('label') ?? ''), alreadyPlayer: true };
      const doc = invite.exists ? (invite.data() as InviteDoc) : undefined;
      const problem = inviteProblem(doc, now);
      if (problem) throw new HttpError(problem.status, problem.code, problem.message);
      tx.update(inviteRef, { uses: FieldValue.increment(1), lastRedeemedAt: FieldValue.serverTimestamp() });
      tx.set(playerRef, { code, label: doc!.label, redeemedAt: FieldValue.serverTimestamp(), revoked: false });
      return { label: doc!.label, alreadyPlayer: false };
    });
    known.set(p.id, Date.now() + KNOWN_TTL_MS);
    uninvitedCap.clear(p.id);
    log('INFO', result.alreadyPlayer ? 'invite: already a player' : 'invite redeemed', { uid: p.id, code, label: result.label });
    return result;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    log('ERROR', 'invite redeem failed', errorFields(err));
    throw new HttpError(503, 'invite_unavailable', 'invitation store unavailable, retry shortly');
  }
}
