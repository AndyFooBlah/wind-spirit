import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { config } from './config.js';
import { HttpError } from './errors.js';

export function initFirebase(): void {
  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId: config.project });
  }
}

/** Who is calling: a verified Firebase user, or (only when REQUIRE_AUTH=false) an IP address. */
export type Principal = { kind: 'user'; id: string } | { kind: 'ip'; id: string };

export function clientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1]?.trim();
}

export async function authenticate(req: IncomingMessage): Promise<Principal> {
  const token = bearer(req);
  if (token) {
    try {
      const decoded = await getAuth().verifyIdToken(token);
      return { kind: 'user', id: decoded.uid };
    } catch (err) {
      if (config.requireAuth) {
        throw new HttpError(401, 'unauthorized', 'invalid or expired Firebase ID token');
      }
      // Auth optional: a bad token degrades to IP keying rather than failing the request.
    }
  } else if (config.requireAuth) {
    throw new HttpError(401, 'unauthorized', 'missing Authorization: Bearer <Firebase ID token>');
  }
  return { kind: 'ip', id: clientIp(req) };
}

/** Log-safe form of a principal: uids are fine, raw IPs are hashed. */
export function principalLabel(p: Principal): string {
  if (p.kind === 'user') return `uid:${p.id}`;
  return `ip:${createHash('sha256').update(p.id).digest('hex').slice(0, 16)}`;
}
