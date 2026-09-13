/**
 * Mint, list and withdraw invitation codes. Runs on a laptop with Application Default Credentials
 * (`gcloud auth application-default login`); never from the browser.
 *
 *   pnpm invite create --label friends --uses 10 [--days 90] [--code amber-heron-42]
 *   pnpm invite list
 *   pnpm invite disable amber-heron-42
 *   pnpm invite players            # who has redeemed what
 *   pnpm invite revoke <uid>       # take a seat back
 */
import { randomInt } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { config } from '../src/config.js';
import { normalizeCode } from '../src/invites.js';

const WORDS = ['amber', 'heron', 'reed', 'cedar', 'ember', 'fjord', 'gale', 'harbor', 'ivory', 'juniper', 'kestrel', 'lantern', 'marsh', 'nettle', 'osprey', 'pebble', 'quill', 'rowan', 'saffron', 'thistle', 'umber', 'vale', 'willow', 'yarrow', 'zephyr', 'birch', 'copper', 'dusk', 'fern', 'gorse'];
const argv = process.argv.slice(2).filter(a => a !== '--');
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1]! : d; };
const cmd = argv[0];

if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId: config.project });
const db = getFirestore();
const invites = db.collection(config.invitesCollection);
const players = db.collection(config.playersCollection);

function mint(): string {
  const w = () => WORDS[randomInt(WORDS.length)]!;
  return `${w()}-${w()}-${randomInt(10, 100)}`;
}

async function main(): Promise<void> {
  switch (cmd) {
    case 'create': {
      const label = arg('label', 'friends'); const maxUses = Number(arg('uses', '5')); const days = Number(arg('days', '0'));
      const code = normalizeCode(arg('code', mint()));
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
