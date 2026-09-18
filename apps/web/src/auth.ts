/**
 * Firebase anonymous sign-in and App Check; the ID token authorises calls to the model proxy and the App Check token
 * attests that they come from this web app (reCAPTCHA Enterprise, invisible). Nothing secret lives here.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken, type AppCheck } from 'firebase/app-check';
import { firebaseConfig, APP_CHECK_SITE_KEY } from './firebase-config.ts';

let userPromise: Promise<User | undefined> | undefined;
let appCheck: AppCheck | undefined;

function initAppCheck(app: FirebaseApp): void {
  if (!APP_CHECK_SITE_KEY) return;
  try {
    // Local dev only: a debug token registered in the console stands in for reCAPTCHA, which will not run on localhost.
    // Never honoured in a production bundle, so it cannot become a bypass.
    const debug = import.meta.env.DEV ? (import.meta.env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined) : undefined;
    if (debug) (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = debug;
    appCheck = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
  } catch (e) { console.warn('app check init failed', e); }
}

/** The current App Check token (the SDK refreshes it), or undefined when App Check is off or attestation failed. */
export async function appCheckToken(): Promise<string | undefined> {
  if (!appCheck) return undefined;
  try { return (await getToken(appCheck)).token; } catch (e) { console.warn('app check token failed', e); return undefined; }
}

export function ensureUser(): Promise<User | undefined> {
  if (userPromise) return userPromise;
  userPromise = new Promise(resolve => {
    try {
      const app = initializeApp(firebaseConfig);
      initAppCheck(app);
      const auth = getAuth(app);
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

/** Everything a proxy call needs: the ID token plus the App Check token when there is one. */
export interface ProxyCredential { idToken: string; appCheckToken?: string }
export async function proxyCredential(): Promise<ProxyCredential | undefined> {
  const [id, ac] = await Promise.all([idToken(), appCheckToken()]);
  if (!id) return undefined;
  return ac ? { idToken: id, appCheckToken: ac } : { idToken: id };
}
