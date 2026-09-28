/**
 * Стабильные machine-readable коды ошибок API.
 * Frontend определяет тип ошибки по `code`, а не по тексту `message`.
 */
export const ErrorCode = {
  // общие
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // auth
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  INVALID_RESET_TOKEN: 'INVALID_RESET_TOKEN',
  // домен бани (используются начиная с Phase 1)
  ROOM_NOT_AVAILABLE: 'ROOM_NOT_AVAILABLE',
  BOOKING_CONFLICT: 'BOOKING_CONFLICT',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  VISIT_ALREADY_COMPLETED: 'VISIT_ALREADY_COMPLETED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_CODES = Object.values(ErrorCode);
