/** Firebase anonymous sign-in; the ID token authorises calls to the model proxy. Nothing secret lives here. */
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth';
import { firebaseConfig } from './firebase-config.ts';

let userPromise: Promise<User | undefined> | undefined;

export function ensureUser(): Promise<User | undefined> {
  if (userPromise) return userPromise;
  userPromise = new Promise(resolve => {
    try {
      const auth = getAuth(initializeApp(firebaseConfig));
      let settled = false;
      onAuthStateChanged(auth, u => { if (u && !settled) { settled = true; resolve(u); } });
      signInAnonymously(auth).then(c => { if (!settled) { settled = true; resolve(c.user); } }).catch(e => { console.warn('anonymous sign-in failed', e); if (!settled) { settled = true; resolve(undefined); } });
      setTimeout(() => { if (!settled) { settled = true; resolve(undefined); } }, 20_000);
    } catch (e) { console.warn('firebase init failed', e); resolve(undefined); }
  });
  return userPromise;
}

/** A fresh ID token (the SDK refreshes it as needed), or undefined when sign-in failed. */
export async function idToken(): Promise<string | undefined> {
  const u = await ensureUser(); if (!u) return undefined;
  try { return await u.getIdToken(); } catch (e) { console.warn('getIdToken failed', e); return undefined; }
}
