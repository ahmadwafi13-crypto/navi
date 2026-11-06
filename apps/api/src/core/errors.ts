/**
 * Deterministic errors used across the API.
 *
 * The gateway maps every error to a stable `reason_code` so that tests and the
 * audit trail can assert on the exact denial reason (AC09).
 */
export class NaviError extends Error {
  readonly statusCode: number;
  readonly reasonCode: string;
  readonly details: Record<string, unknown>;

  constructor(
    statusCode: number,
    reasonCode: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'NaviError';
    this.statusCode = statusCode;
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

export const DenyReason = {
  MISSING_APPROVAL: 'MISSING_APPROVAL',
  INVALID_APPROVAL: 'INVALID_APPROVAL',
  EXPIRED_APPROVAL: 'EXPIRED_APPROVAL',
  PAYLOAD_HASH_MISMATCH: 'PAYLOAD_HASH_MISMATCH',
  STALE_VERSION: 'STALE_VERSION',
  INVALID_STATE: 'INVALID_STATE',
  UNAUTHORIZED_APPROVER: 'UNAUTHORIZED_APPROVER',
  HIGH_RISK_REQUIRES_MANAGER: 'HIGH_RISK_REQUIRES_MANAGER',
  HIGH_RISK_CONFIRMATION_MISSING: 'HIGH_RISK_CONFIRMATION_MISSING',
  UNSUPPORTED_ACTION: 'UNSUPPORTED_ACTION',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  CSRF_FAILED: 'CSRF_FAILED',
  CROSS_TENANT: 'CROSS_TENANT',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
} as const;

export type DenyReasonCode = (typeof DenyReason)[keyof typeof DenyReason];
