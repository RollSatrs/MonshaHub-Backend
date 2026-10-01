import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
};

interface HttpExceptionBody {
  message?: string | string[];
  code?: ErrorCode;
  details?: string[];
}

/**
 * Формат ответа: { statusCode, code, message: string, details?: string[], path, timestamp }.
 * `message` — всегда строка; список ошибок валидации лежит в `details`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = ErrorCode.INTERNAL_ERROR;
    let message = 'Внутренняя ошибка сервера';
    let details: string[] | undefined;
    let meta: Record<string, unknown> | undefined;

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
      meta = exception.meta;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = CODE_BY_STATUS[status] ?? ErrorCode.INTERNAL_ERROR;
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const parsed = body as HttpExceptionBody;
        if (parsed.code) code = parsed.code;
        if (Array.isArray(parsed.message)) {
          details = parsed.message;
          message = 'Ошибка валидации';
        } else {
          message = parsed.message ?? exception.message;
        }
        if (parsed.details) details = parsed.details;
      }
    } else {
      this.logger.error(
        exception instanceof Error ? exception.stack : exception,
      );
    }

    response.status(status).json({
      statusCode: status,
      code,
      message,
      ...(details ? { details } : {}),
      ...(meta ? { meta } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
