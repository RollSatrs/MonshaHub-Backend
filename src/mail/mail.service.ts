import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendPasswordReset(to: string, token: string) {
    const resetUrl = `${process.env.FRONT_URL}/reset-password?token=${token}`;

    await this.transporter.sendMail({
      from: process.env.SMTP_FROM || `"Поддержка" <${process.env.SMTP_USER}>`,
      to,
      subject: 'Сброс пароля',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #f9f9f9; border-radius: 8px;">
          <h2 style="color: #111; margin-bottom: 16px;">Сброс пароля</h2>
          <p style="color: #444; margin-bottom: 24px;">
            Вы запросили сброс пароля. Нажмите на кнопку ниже, чтобы задать новый пароль.
            Ссылка действует <strong>1 час</strong>.
          </p>
          <a href="${resetUrl}"
            style="display: inline-block; padding: 12px 24px; background: #111; color: #fff; text-decoration: none; border-radius: 6px; font-size: 15px;">
            Сбросить пароль
          </a>
          <p style="color: #888; font-size: 12px; margin-top: 24px;">
            Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо.
          </p>
        </div>
      `,
    });
  }
}
