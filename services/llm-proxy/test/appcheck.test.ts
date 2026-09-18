import { describe, expect, it } from 'vitest';
import { appCheckDecision, appCheckHeader, classify, requireAppCheck, type AppCheckVerifier } from '../src/appcheck.js';

const APP = '1:406179055859:web:c8e690b638cdd7e7944f86';
const verifier: AppCheckVerifier = {
  async verify(token) {
    if (token === 'good') return { appId: APP };
    if (token === 'other-app') return { appId: '1:1:web:other' };
    throw new Error('bad token');
  },
};
const req = (token?: string) => ({ headers: token === undefined ? {} : { 'x-firebase-appcheck': token } });

describe('appCheckDecision', () => {
  it('off allows everything; ok always allows', () => {
    for (const o of ['ok', 'missing', 'invalid', 'foreign_app'] as const) expect(appCheckDecision('off', o)).toBe('allow');
    expect(appCheckDecision('enforce', 'ok')).toBe('allow');
  });
  it('log warns and enforce denies for every non-ok outcome', () => {
    for (const o of ['missing', 'invalid', 'foreign_app'] as const) {
      expect(appCheckDecision('log', o)).toBe('warn');
      expect(appCheckDecision('enforce', o)).toBe('deny');
    }
  });
});

describe('classify', () => {
  it('reads the header case-insensitively and maps outcomes', async () => {
    expect(appCheckHeader({ headers: { 'x-firebase-appcheck': ' good ' } })).toBe('good');
    expect(await classify(req(), verifier, [APP])).toBe('missing');
    expect(await classify(req(''), verifier, [APP])).toBe('missing');
    expect(await classify(req('garbage'), verifier, [APP])).toBe('invalid');
    expect(await classify(req('other-app'), verifier, [APP])).toBe('foreign_app');
    expect(await classify(req('good'), verifier, [APP])).toBe('ok');
  });
});

describe('requireAppCheck', () => {
  it('off: no verification, nothing recorded', async () => {
    const entry: { appCheck?: string } = {};
    await requireAppCheck(req(), entry, { mode: 'off', verifier, allowedAppIds: [APP] });
    expect(entry.appCheck).toBeUndefined();
  });
  it('log: records the outcome and never throws', async () => {
    const entry: { appCheck?: string } = {};
    await requireAppCheck(req(), entry, { mode: 'log', verifier, allowedAppIds: [APP] });
    expect(entry.appCheck).toBe('missing');
    await requireAppCheck(req('garbage'), entry, { mode: 'log', verifier, allowedAppIds: [APP] });
    expect(entry.appCheck).toBe('invalid');
  });
  it('enforce: 401 app_check without a valid token from an allowed app', async () => {
    const opts = { mode: 'enforce' as const, verifier, allowedAppIds: [APP] };
    await expect(requireAppCheck(req(), {}, opts)).rejects.toMatchObject({ status: 401, code: 'app_check', extra: { outcome: 'missing' } });
    await expect(requireAppCheck(req('garbage'), {}, opts)).rejects.toMatchObject({ status: 401, extra: { outcome: 'invalid' } });
    await expect(requireAppCheck(req('other-app'), {}, opts)).rejects.toMatchObject({ status: 401, extra: { outcome: 'foreign_app' } });
    const entry: { appCheck?: string } = {};
    await expect(requireAppCheck(req('good'), entry, opts)).resolves.toBeUndefined();
    expect(entry.appCheck).toBe('ok');
  });
  it('enforce: a verifier that blows up counts as invalid, not as a 500', async () => {
    const exploding: AppCheckVerifier = { verify: async () => { throw new TypeError('network'); } };
    await expect(requireAppCheck(req('x'), {}, { mode: 'enforce', verifier: exploding, allowedAppIds: [APP] })).rejects.toMatchObject({ status: 401 });
  });
});
