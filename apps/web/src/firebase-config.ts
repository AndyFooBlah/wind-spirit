/** Public Firebase web config for project wind-spirit-prod (client config, not a secret; copied from services/llm-proxy/firebase-web-config.json). */
import cfg from './firebase-config.json';
export const firebaseConfig = { apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId, appId: cfg.appId, storageBucket: cfg.storageBucket, messagingSenderId: cfg.messagingSenderId };
export const PROXY_URL = 'https://llm-proxy-406179055859.us-central1.run.app';
