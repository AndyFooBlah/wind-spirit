/**
 * A Firebase ID token for scripts that call the proxy: a throwaway anonymous user, plus the invitation
 * code from WS_INVITE_CODE redeemed for it (the proxy refuses model calls without one). The Firebase web
 * API key is public client config, not a secret.
 */
import { readFileSync } from 'node:fs';

export async function anonToken(proxy?: string): Promise<string> {
  const cfg = JSON.parse(readFileSync(new URL('../../../../services/llm-proxy/firebase-web-config.json', import.meta.url), 'utf8')) as { apiKey: string };
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const token = ((await res.json()) as { idToken: string }).idToken;
  const code = process.env.WS_INVITE_CODE;
  if (proxy && code) {
    const r = await fetch(`${proxy}/v1/invite/redeem`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ code }) });
    if (!r.ok) throw new Error(`invite redeem failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  } else if (proxy && !code) {
    console.warn('WS_INVITE_CODE not set: the proxy will refuse model calls unless REQUIRE_INVITE=false');
  }
  return token;
}
