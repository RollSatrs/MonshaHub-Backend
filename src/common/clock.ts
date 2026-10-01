import { Global, Injectable, Module } from '@nestjs/common';

/**
 * Источник времени приложения. Все «сейчас» в бизнес-логике (старт посещения, просрочка,
 * ближайшая бронь) берутся отсюда, а не из Date.now()/now() БД — поэтому e2e и demo-seed
 * управляют временем.
 */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class ClockModule {}
