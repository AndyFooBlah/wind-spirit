/**
 * Firebase App Check for the proxy. The web app attests with reCAPTCHA Enterprise and sends the resulting token in
 * `X-Firebase-AppCheck`; scripts exchange a registered debug token for one (see packages/agents/src/evals/token.ts).
 * Modes (APP_CHECK): `off` ignores the header, `log` verifies and records the outcome without blocking, so a rollout
 * can be watched in the logs first, and `enforce` answers 401 without a valid token from an allowed app id.
 */
import type { IncomingMessage } from 'node:http';
import { getAppCheck } from 'firebase-admin/app-check';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { errorFields, log } from './log.js';

export type AppCheckMode = 'off' | 'log' | 'enforce';
export type AppCheckOutcome = 'ok' | 'missing' | 'invalid' | 'foreign_app';

export interface AppCheckVerifier {
  /** Resolves with the attested app id, rejects on a bad token. */
  verify(token: string): Promise<{ appId: string }>;
}

export const HEADER = 'x-firebase-appcheck';

export function appCheckHeader(req: Pick<IncomingMessage, 'headers'>): string | undefined {
  const h = req.headers[HEADER];
  const v = Array.isArray(h) ? h[0] : h;
  return v?.trim() || undefined;
}

/** Pure: what a mode does with an outcome. */
export function appCheckDecision(mode: AppCheckMode, outcome: AppCheckOutcome): 'allow' | 'warn' | 'deny' {
  if (mode === 'off' || outcome === 'ok') return 'allow';
  return mode === 'enforce' ? 'deny' : 'warn';
}

export async function classify(req: Pick<IncomingMessage, 'headers'>, verifier: AppCheckVerifier, allowedAppIds: readonly string[]): Promise<AppCheckOutcome> {
  const token = appCheckHeader(req);
  if (!token) return 'missing';
  try {
    const { appId } = await verifier.verify(token);
    return allowedAppIds.includes(appId) ? 'ok' : 'foreign_app';
  } catch {
    return 'invalid';
  }
}

const adminVerifier: AppCheckVerifier = {
  async verify(token) {
    const r = await getAppCheck().verifyToken(token);
    return { appId: r.appId };
  },
};

/**
 * Gate a request on App Check per the configured mode. `entry` receives the outcome for the request log.
 * Throws 401 `app_check` in enforce mode; never throws in log mode.
 */
export async function requireAppCheck(
  req: Pick<IncomingMessage, 'headers'>,
  entry: { appCheck?: string },
  opts: { mode?: AppCheckMode; verifier?: AppCheckVerifier; allowedAppIds?: readonly string[] } = {},
): Promise<void> {
  const mode = opts.mode ?? config.appCheck;
  if (mode === 'off') return;
  let outcome: AppCheckOutcome;
  try {
    outcome = await classify(req, opts.verifier ?? adminVerifier, opts.allowedAppIds ?? config.appCheckAppIds);
  } catch (err) {
    // Only the verifier's own plumbing can land here (classify swallows bad tokens); treat as invalid.
    log('ERROR', 'app check verifier failed', errorFields(err));
    outcome = 'invalid';
  }
  entry.appCheck = outcome;
  const decision = appCheckDecision(mode, outcome);
  if (decision === 'allow') return;
  if (decision === 'warn') {
    log('WARNING', 'app check would reject', { outcome });
    return;
  }
  throw new HttpError(401, 'app_check', 'a valid Firebase App Check token is required (X-Firebase-AppCheck)', { outcome });
}
