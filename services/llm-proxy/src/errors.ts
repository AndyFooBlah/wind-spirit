/** An error that maps directly to an HTTP response. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly extra: Record<string, unknown> = {},
    /** Response headers to send with the error, e.g. `Retry-After` on a 429. */
    public readonly headers: Record<string, string> = {},
  ) {
    super(message ?? code);
    this.name = 'HttpError';
  }
  body(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...this.extra };
  }
}
