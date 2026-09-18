/**
 * Credentials for scripts that call the proxy (the eval runner, run-chief, eval-chief, first-turn):
 *
 *  - a throwaway anonymous Firebase user, with the invitation code from WS_INVITE_CODE redeemed for it
 *    (the proxy refuses model calls without one);
 *  - when the proxy checks Firebase App Check, an App Check token exchanged from a debug token that is
 *    registered under the web app in the Firebase console (App Check > Apps > Manage debug tokens).
 *
 * Both need a server-side API key: the browser key in firebase-web-config.json is HTTP-referrer restricted
 * and no longer works from Node. Configuration comes from the environment or from `.env.harness` at the
 * repository root (gitignored):
 *
 *   FIREBASE_HARNESS_API_KEY       key restricted to identitytoolkit, securetoken and firebaseappcheck
 *   FIREBASE_APPCHECK_DEBUG_TOKEN  the registered debug token (a UUID); omit to send no App Check token
 *   WS_INVITE_CODE                 an invitation code with a spare seat
 *
 * There is no bypass: without a debug token the proxy in enforce mode answers 401 like any other caller.
 */
import { readFileSync } from 'node:fs';
import type { ProxyCredential } from '../client.js';

const ROOT = new URL('../../../../', import.meta.url);

function loadEnvFile(): void {
  try { process.loadEnvFile(new URL('.env.harness', ROOT).pathname); } catch { /* absent: rely on the environment */ }
}

interface WebConfig { apiKey: string; projectId: string; appId: string }

function webConfig(): WebConfig {
  return JSON.parse(readFileSync(new URL('services/llm-proxy/firebase-web-config.json', ROOT), 'utf8')) as WebConfig;
}

async function anonIdToken(key: string): Promise<string> {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  const body = (await res.json()) as { idToken?: string; error?: { message?: string } };
  if (!res.ok || !body.idToken) {
    throw new Error(`anonymous sign-in failed (${res.status} ${body.error?.message ?? ''}): set FIREBASE_HARNESS_API_KEY to the server-side harness key; the browser key is referrer-restricted`);
  }
  return body.idToken;
}

/** Exchange a registered App Check debug token for an App Check token (what the web SDK's debug provider does). */
export async function exchangeDebugToken(cfg: WebConfig, key: string, debugToken: string): Promise<string> {
  const url = `https://firebaseappcheck.googleapis.com/v1/projects/${cfg.projectId}/apps/${cfg.appId}:exchangeDebugToken?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ debugToken }) });
  const body = (await res.json()) as { token?: string; error?: { message?: string } };
  if (!res.ok || !body.token) throw new Error(`App Check debug token exchange failed (${res.status} ${body.error?.message ?? ''}); is the token registered for the web app?`);
  return body.token;
}

/**
 * The credential for one script run. Kept under its historical name: callers pass it straight to
 * `HttpLlmClient`/`ProxySystemOne`, which accept the richer shape.
 */
export async function anonToken(proxy?: string): Promise<ProxyCredential> {
  loadEnvFile();
  const cfg = webConfig();
  const key = process.env.FIREBASE_HARNESS_API_KEY ?? cfg.apiKey;
  const idToken = await anonIdToken(key);
  const debug = process.env.FIREBASE_APPCHECK_DEBUG_TOKEN;
  const appCheckToken = debug ? await exchangeDebugToken(cfg, key, debug) : undefined;
  if (!debug) console.warn('FIREBASE_APPCHECK_DEBUG_TOKEN not set: the proxy will refuse calls if APP_CHECK=enforce');
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${idToken}` };
  if (appCheckToken) headers['x-firebase-appcheck'] = appCheckToken;
  const code = process.env.WS_INVITE_CODE;
  if (proxy && code) {
    const r = await fetch(`${proxy}/v1/invite/redeem`, { method: 'POST', headers, body: JSON.stringify({ code }) });
    if (!r.ok) throw new Error(`invite redeem failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  } else if (proxy && !code) {
    console.warn('WS_INVITE_CODE not set: the proxy will refuse model calls unless REQUIRE_INVITE=false');
  }
  return { idToken, ...(appCheckToken ? { appCheckToken } : {}) };
}
