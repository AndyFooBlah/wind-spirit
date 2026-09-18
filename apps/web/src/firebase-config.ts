/** Public Firebase web config for project wind-spirit-prod (client config, not a secret; copied from services/llm-proxy/firebase-web-config.json). */
import cfg from './firebase-config.json';
export const firebaseConfig = { apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId, appId: cfg.appId, storageBucket: cfg.storageBucket, messagingSenderId: cfg.messagingSenderId };
export const PROXY_URL = 'https://llm-proxy-406179055859.us-central1.run.app';
/**
 * reCAPTCHA Enterprise site key for Firebase App Check (public, like the rest of this config). An empty value turns
 * App Check off in the client; VITE_APPCHECK_SITE_KEY overrides the committed key at build time.
 */
export const APP_CHECK_SITE_KEY: string = (import.meta.env.VITE_APPCHECK_SITE_KEY as string | undefined) ?? cfg.recaptchaEnterpriseSiteKey ?? '';
