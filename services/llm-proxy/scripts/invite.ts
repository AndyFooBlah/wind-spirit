/**
 * Mint, list and withdraw invitation codes. Runs on a laptop with Application Default Credentials
 * (`gcloud auth application-default login`); never from the browser.
 *
 * Code format (since 2026-09-18): ten base32 characters in two groups, e.g. `7m3kq-x9d2t`, minted by
 * `mintCode` in src/invites.ts from 50 random bits (2^50 possibilities). Until then codes were
 * `word-word-NN` from a 30-word list here (81,000 possibilities), which was too few once the repo went
 * public; those codes are plain Firestore document ids and remain valid until disabled. `--code` still
 * lets you choose a code by hand.
 *
 *   pnpm invite create --label friends --uses 10 [--days 90] [--code 7m3kq-x9d2t]
 *   pnpm invite list
 *   pnpm invite disable 7m3kq-x9d2t
 *   pnpm invite players            # who has redeemed what
 *   pnpm invite revoke <uid>       # take a seat back
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { config } from '../src/config.js';
import { mintCode, normalizeCode } from '../src/invites.js';

const argv = process.argv.slice(2).filter(a => a !== '--');
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1]! : d; };
const cmd = argv[0];

if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId: config.project });
const db = getFirestore();
const invites = db.collection(config.invitesCollection);
const players = db.collection(config.playersCollection);

async function main(): Promise<void> {
  switch (cmd) {
    case 'create': {
      const label = arg('label', 'friends'); const maxUses = Number(arg('uses', '5')); const days = Number(arg('days', '0'));
      const code = normalizeCode(arg('code', mintCode()));
      if (!code) throw new Error('bad --code');
      if ((await invites.doc(code).get()).exists) throw new Error(`code ${code} already exists`);
      const doc: Record<string, unknown> = { label, maxUses, uses: 0, disabled: false, createdAt: FieldValue.serverTimestamp() };
      if (days > 0) doc.expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
      await invites.doc(code).set(doc);
      console.log(`${code}  label=${label} uses=0/${maxUses}${days > 0 ? ` expires in ${days} days` : ''}`);
      break;
    }
    case 'list': {
      const snap = await invites.orderBy('createdAt', 'desc').get();
      for (const d of snap.docs) { const v = d.data(); console.log(`${d.id.padEnd(24)} label=${v.label} uses=${v.uses}/${v.maxUses}${v.disabled ? ' DISABLED' : ''}${v.expiresAt ? ` expires ${v.expiresAt.slice(0, 10)}` : ''}`); }
      if (snap.empty) console.log('(no codes)');
      break;
    }
    case 'disable': {
      const code = normalizeCode(argv[1]); if (!code) throw new Error('usage: disable <code>');
      await invites.doc(code).update({ disabled: true });
      console.log(`${code} disabled (players who already redeemed it keep their seats; use revoke <uid> to remove one)`);
      break;
    }
    case 'players': {
      const snap = await players.orderBy('redeemedAt', 'desc').get();
      for (const d of snap.docs) { const v = d.data(); console.log(`${d.id}  code=${v.code} label=${v.label}${v.revoked ? ' REVOKED' : ''} ${v.redeemedAt?.toDate?.().toISOString().slice(0, 16) ?? ''}`); }
      if (snap.empty) console.log('(no players)');
      break;
    }
    case 'revoke': {
      const uid = argv[1]; if (!uid) throw new Error('usage: revoke <uid>');
      await players.doc(uid).update({ revoked: true, revokedAt: FieldValue.serverTimestamp() });
      console.log(`${uid} revoked (takes effect within five minutes)`);
      break;
    }
    default:
      console.log('usage: invite create|list|disable|players|revoke'); process.exitCode = 2;
  }
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
