import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { MailService } from 'src/mail/mail.service';
import { AppException } from 'src/common/errors/app.exception';
import { ErrorCode } from 'src/common/errors/error-codes';

const selectMock = {
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn(),
};

jest.mock('src', () => ({
  db: {
    select: jest.fn(() => selectMock),
    insert: jest.fn(),
    transaction: jest.fn(),
  },
}));

jest.mock('shared/tools/tools', () => ({
  hashFunction: jest.fn((password: string) => `hashed:${password}`),
  unHashFunction: jest.fn(
    (password: string, hash: string) => hash === `hashed:${password}`,
  ),
}));

const baseUser = {
  id: 1,
  organizationId: 7,
  fullname: 'Test User',
  email: 'user@test.com',
  passwordHash: 'hashed:correct-password',
  pinHash: 'hashed:1234',
  role: 'OWNER',
  avatar: null,
  active: true,
};

describe('AuthService', () => {
  let service: AuthService;
  let signMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    signMock = jest.fn(() => 'signed.jwt.token');
    const jwtService = { sign: signMock } as unknown as JwtService;
    const mailService = {} as MailService;
    service = new AuthService(jwtService, mailService);
  });

  describe('login', () => {
    it('INVALID_CREDENTIALS, если пользователь не найден', async () => {
      selectMock.limit.mockResolvedValueOnce([]);
      await expect(
        service.login({ email: 'unknown@test.com', password: 'password123' }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    });

    it('INVALID_CREDENTIALS при неверном пароле (то же сообщение)', async () => {
      selectMock.limit.mockResolvedValueOnce([baseUser]);
      const err = await service
        .login({ email: 'user@test.com', password: 'wrong-password' })
        .catch((e: AppException) => e);
      expect(err).toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
      expect((err as AppException).message).toBe('Неверный email или пароль');
    });

    it('INVALID_CREDENTIALS для неактивного пользователя', async () => {
      selectMock.limit.mockResolvedValueOnce([{ ...baseUser, active: false }]);
      await expect(
        service.login({ email: 'user@test.com', password: 'correct-password' }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    });

    it('возвращает токен с organizationId и user без passwordHash', async () => {
      selectMock.limit.mockResolvedValueOnce([baseUser]);
      const result = await service.login({
        email: 'user@test.com',
        password: 'correct-password',
      });

      expect(result.token).toBe('signed.jwt.token');
      expect(result.user).toMatchObject({ id: 1, organizationId: 7 });
      expect(JSON.stringify(result.user)).not.toMatch(/password/i);
      expect(signMock).toHaveBeenCalledWith({
        id: 1,
        email: 'user@test.com',
        role: 'OWNER',
        organizationId: 7,
      });
    });
  });

  describe('loginWithPin', () => {
    it('возвращает сессию при правильном PIN', async () => {
      selectMock.limit.mockResolvedValueOnce([baseUser]);
      const result = await service.loginWithPin({
        email: 'user@test.com',
        pin: '1234',
      });

      expect(result.token).toBe('signed.jwt.token');
      expect(result.user).toMatchObject({ id: 1, email: 'user@test.com' });
    });

    it('не позволяет войти без PIN или с неверным PIN', async () => {
      selectMock.limit
        .mockResolvedValueOnce([{ ...baseUser, pinHash: null }])
        .mockResolvedValueOnce([baseUser]);

      await expect(
        service.loginWithPin({ email: 'user@test.com', pin: '1234' }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
      await expect(
        service.loginWithPin({ email: 'user@test.com', pin: '9999' }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    });
  });

  describe('register', () => {
    it('EMAIL_ALREADY_EXISTS, если email уже занят', async () => {
      selectMock.limit.mockResolvedValueOnce([{ id: 1 }]);
      await expect(
        service.register({
          organizationName: 'Org',
          fullname: 'Test',
          email: 'taken@test.com',
          password: 'password123',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.EMAIL_ALREADY_EXISTS });
    });
  });
});
