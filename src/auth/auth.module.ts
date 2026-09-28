import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { MailModule } from 'src/mail/mail.module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.SECRET_KEY || 'SECRET_KEY',
      signOptions: {
        expiresIn: 7 * 24 * 60 * 60,
      },
    }),
    MailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [JwtModule],
})
export class AuthModule {}
