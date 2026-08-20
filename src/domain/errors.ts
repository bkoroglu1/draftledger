/** Typed application errors. Every API surface maps failures onto these codes. */
export const ERROR_CODES = [
  'not_found',
  'not_synced',
  'sync_in_progress',
  'upstream_unavailable',
  'parse_failed',
  'invalid_slug',
  'conflict',
  'forbidden',
  'unauthenticated',
  'stale_approval',
  'unresolved_gate',
  'immutable_revision',
  'publish_failed',
  'notification_policy_invalid',
  'recipient_expansion_failed',
  'event_not_supported',
  'validation_failed',
  'rate_limited',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  not_found: 404,
  not_synced: 409,
  sync_in_progress: 202,
  upstream_unavailable: 502,
  parse_failed: 422,
  invalid_slug: 400,
  conflict: 409,
  forbidden: 403,
  unauthenticated: 401,
  stale_approval: 409,
  unresolved_gate: 409,
  immutable_revision: 409,
  publish_failed: 500,
  notification_policy_invalid: 400,
  recipient_expansion_failed: 500,
  event_not_supported: 400,
  validation_failed: 422,
  rate_limited: 429,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  get httpStatus(): number {
    return STATUS_BY_CODE[this.code];
  }

  toJSON() {
    return { error: this.code, message: this.message, details: this.details ?? null };
  }
}

export function appError(code: ErrorCode, message?: string, details?: unknown): AppError {
  return new AppError(code, message, details);
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export function httpStatusFor(e: unknown): number {
  return isAppError(e) ? e.httpStatus : 500;
}
