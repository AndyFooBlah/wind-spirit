/** An error that maps directly to an HTTP response. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message ?? code);
    this.name = 'HttpError';
  }
  body(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...this.extra };
  }
}
