import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { StaffModule } from './staff/staff.module';
import { HealthController } from './health/health.controller';
import { validateEnv } from './config/env.validation';
import { JwtAuthGuard } from './auth/jwt.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
      // в тестах лимиты отключены, чтобы e2e не упирался в 429
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    AuthModule,
    StaffModule,
  ],
  controllers: [HealthController],
  providers: [
    // порядок важен: throttler → аутентификация → роли
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
