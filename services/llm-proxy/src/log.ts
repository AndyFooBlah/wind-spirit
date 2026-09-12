/** One structured JSON line per event. Cloud Logging reads `severity`. Never log prompt bodies. */
export type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export function log(severity: Severity, message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ severity, message, time: new Date().toISOString(), ...fields });
  if (severity === 'ERROR' || severity === 'WARNING') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { error: err.message, errorName: err.name };
  return { error: String(err) };
}
