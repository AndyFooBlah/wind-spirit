/** Invitation gate client. The proxy enforces it; this only remembers that this browser's player has a seat. */
import { proxyCredential } from './auth.ts';
import { PROXY_URL } from './firebase-config.ts';

const KEY = 'ws.invite';
export interface InviteState { label: string; at: number }

export function storedInvite(): InviteState | undefined {
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as InviteState) : undefined; } catch { return undefined; }
}
function remember(s: InviteState | undefined): void {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* private mode */ }
}

async function call(path: string, init: RequestInit): Promise<Response> {
  const c = await proxyCredential(); if (!c) throw new Error('Could not sign in. Check your connection and reload.');
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${c.idToken}` };
  if (c.appCheckToken) headers['x-firebase-appcheck'] = c.appCheckToken;
  return fetch(`${PROXY_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
}

/** Redeem a code for this browser's (anonymous) Firebase user. Throws with a human message on refusal. */
export async function redeemInvite(code: string): Promise<InviteState> {
  const res = await call('/v1/invite/redeem', { method: 'POST', body: JSON.stringify({ code }) });
  const body = (await res.json().catch(() => ({}))) as { label?: string; message?: string; error?: string };
  if (!res.ok) throw new Error(body.message ?? `The proxy said ${res.status}.`);
  const s = { label: body.label ?? '', at: Date.now() }; remember(s); return s;
}

export function forgetInvite(): void { remember(undefined); }

/** Ask the proxy whether this player still has a seat; forgets the stored invite when not. */
export async function checkInvite(): Promise<boolean> {
  try {
    const res = await call('/v1/invite/status', { method: 'GET' });
    if (!res.ok) return storedInvite() !== undefined; // proxy hiccup: keep what we know
    const body = (await res.json()) as { invited: boolean; required: boolean };
    if (!body.required) { remember({ label: 'open', at: Date.now() }); return true; }
    if (!body.invited) remember(undefined);
    else if (!storedInvite()) remember({ label: '', at: Date.now() });
    return body.invited;
  } catch { return storedInvite() !== undefined; }
}
