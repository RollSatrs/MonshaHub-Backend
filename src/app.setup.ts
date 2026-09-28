import {
  HttpStatus,
  INestApplication,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AUTH_COOKIE } from '../shared/constants/auth';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { AppException } from './common/errors/app.exception';
import { ErrorCode } from './common/errors/error-codes';

function flattenErrors(errors: ValidationError[]): string[] {
  return errors.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...flattenErrors(e.children ?? []),
  ]);
}

/** Общая настройка приложения — используется и в main.ts, и в e2e-тестах. */
export function configureApp(app: INestApplication) {
  app.use(helmet());

  app.enableCors({
    origin: process.env.FRONT_URL!,
    credentials: true,
  });

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Ошибка валидации',
          HttpStatus.BAD_REQUEST,
          flattenErrors(errors),
        ),
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
}

export function buildSwaggerDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('MonshaHub API')
    .setDescription('API системы управления общественными банями')
    .setVersion('1.0')
    .addCookieAuth(AUTH_COOKIE, undefined, 'access_token')
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: INestApplication) {
  SwaggerModule.setup('api/docs', app, buildSwaggerDocument(app), {
    jsonDocumentUrl: 'api/docs-json',
  });
}
