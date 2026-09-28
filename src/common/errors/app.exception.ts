import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

/** Доменная ошибка с машинным кодом. */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: string[],
  ) {
    super(message, status);
  }
}
