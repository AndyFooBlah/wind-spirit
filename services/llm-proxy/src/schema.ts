import { Ajv, type ErrorObject } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';

/**
 * JSON-schema validation of model output. Providers that enforce a schema natively still get
 * validated here so every model is held to the same bar; those that only follow instructions rely
 * on it entirely. Compiled validators are memoised by schema text.
 */
const cache = new Map<string, { validate: (v: unknown) => boolean; errors: () => string }>();

function compile(schema: Record<string, unknown>): { validate: (v: unknown) => boolean; errors: () => string } {
  const key = JSON.stringify(schema);
  const hit = cache.get(key);
  if (hit) return hit;
  const opts = { strict: false, allErrors: false, validateFormats: false } as const;
  const uses2020 = typeof schema.$schema === 'string' && /2020-12/.test(schema.$schema);
  const ajv = uses2020 ? new Ajv2020(opts) : new Ajv(opts);
  let fn: ReturnType<typeof ajv.compile>;
  try {
    fn = ajv.compile(schema);
  } catch (err) {
    // An uncompilable schema (e.g. Gemini-only keywords) degrades to "parses as JSON" rather than failing every call.
    const msg = err instanceof Error ? err.message : String(err);
    const entry = { validate: () => true, errors: () => `schema not compiled: ${msg}` };
    cache.set(key, entry);
    return entry;
  }
  const entry = {
    validate: (v: unknown) => fn(v) as boolean,
    errors: () => (fn.errors ?? []).map((e: ErrorObject) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim()).join('; '),
  };
  if (cache.size > 200) cache.clear();
  cache.set(key, entry);
  return entry;
}

/** Returns undefined when valid, else a short reason. */
export function validateAgainst(schema: Record<string, unknown>, value: unknown): string | undefined {
  const v = compile(schema);
  if (v.validate(value)) return undefined;
  return v.errors() || 'does not match schema';
}
