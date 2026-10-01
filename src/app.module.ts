import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { StaffModule } from './staff/staff.module';
import { OrganizationModule } from './organization/organization.module';
import { RoomsModule } from './rooms/rooms.module';
import { TariffsModule } from './tariffs/tariffs.module';
import { ProductsModule } from './products/products.module';
import { BathServicesModule } from './bath-services/bath-services.module';
import { BookingsModule } from './bookings/bookings.module';
import { VisitsModule } from './visits/visits.module';
import { LiveModule } from './live/live.module';
import { ClockModule } from './common/clock';
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
      // 300/мин на IP: кассиры одной бани сидят за одним IP, а «Баня сейчас» опрашивает backend.
      // Строгие лимиты остаются на auth-эндпоинтах (@Throttle).
      throttlers: [{ ttl: 60_000, limit: 300 }],
      // в тестах лимиты отключены, чтобы e2e не упирался в 429
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    AuthModule,
    StaffModule,
    OrganizationModule,
    RoomsModule,
    TariffsModule,
    ProductsModule,
    BathServicesModule,
    ClockModule,
    BookingsModule,
    VisitsModule,
    LiveModule,
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
