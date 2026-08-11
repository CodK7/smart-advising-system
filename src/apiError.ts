/**
 * The error type both API modes throw.
 *
 * Lives in its own module so request failures have a stable status/code shape.
 */
export class ApiError extends Error {
  status: number;
  /**
   * Stable, language-independent error identifier (e.g. 'INVALID_CREDENTIALS').
   * Components translate this rather than displaying `message`, which is
   * English-only.
   */
  code: string;
  retryAfter?: number;

  constructor(status: number, message: string, code = '', retryAfter?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
