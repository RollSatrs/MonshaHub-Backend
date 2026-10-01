import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

/** Доменная ошибка с машинным кодом. `meta` — структурированные подробности для клиента (не для показа как есть). */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: string[],
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message, status);
  }
}
