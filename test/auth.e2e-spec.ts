import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../src';
import { usersTable } from '../src/db/schema';
import {
  cleanup,
  closeDb,
  createApp,
  PASSWORD,
  registerOwner,
  sentResetTokens,
  uniqueEmail,
} from './helpers';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
    await closeDb();
  });

  const http = () => request(app.getHttpServer());

  it('регистрация создаёт OWNER и организацию и не отдаёт passwordHash', async () => {
    const email = uniqueEmail('reg');
    const res = await http()
      .post('/auth/register')
      .send({
        organizationName: 'E2E Reg',
        fullname: 'Reg',
        email,
        password: PASSWORD,
      })
      .expect(201);

    const body = res.body as { user: Record<string, unknown> };
    expect(body.user.role).toBe('OWNER');
    expect(body.user.organizationId).toEqual(expect.any(Number));
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('нельзя выбрать роль или организацию при регистрации (forbidNonWhitelisted)', async () => {
    const res = await http()
      .post('/auth/register')
      .send({
        organizationName: 'X',
        fullname: 'X',
        email: uniqueEmail('evil'),
        password: PASSWORD,
        role: 'OWNER',
        organizationId: 1,
      })
      .expect(400);
    expect((res.body as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('дубликат email → 409 EMAIL_ALREADY_EXISTS', async () => {
    const owner = await registerOwner(app);
    const res = await http()
      .post('/auth/register')
      .send({
        organizationName: 'Dup',
        fullname: 'Dup',
        email: owner.email,
        password: PASSWORD,
      })
      .expect(409);
    expect((res.body as { code: string }).code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('ошибка валидации: message — строка, details — массив', async () => {
    const res = await http()
      .post('/auth/login')
      .send({ email: 'not-an-email', password: '1' })
      .expect(400);
    const body = res.body as {
      code: string;
      message: string;
      details: string[];
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(typeof body.message).toBe('string');
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBeGreaterThan(0);
  });

  it('одинаковая ошибка для неверного email и неверного пароля', async () => {
    const owner = await registerOwner(app);
    const wrongPass = await http()
      .post('/auth/login')
      .send({ email: owner.email, password: 'wrong-password' })
      .expect(401);
    const noUser = await http()
      .post('/auth/login')
      .send({ email: uniqueEmail('nobody'), password: PASSWORD })
      .expect(401);
    expect((wrongPass.body as { code: string }).code).toBe(
      'INVALID_CREDENTIALS',
    );
    expect((noUser.body as { message: string }).message).toBe(
      (wrongPass.body as { message: string }).message,
    );
  });

  it('login ставит httpOnly cookie, /auth/me работает, logout очищает cookie', async () => {
    const owner = await registerOwner(app);
    const me = await owner.agent.get('/auth/me').expect(200);
    const meBody = me.body as Record<string, unknown>;
    expect(meBody.email).toBe(owner.email);
    expect(meBody).not.toHaveProperty('passwordHash');

    await owner.agent.post('/auth/logout').expect(200);
    await owner.agent.get('/auth/me').expect(401);
  });

  it('login выставляет cookie с HttpOnly', async () => {
    const owner = await registerOwner(app);
    const res = await http()
      .post('/auth/login')
      .send({ email: owner.email, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(
      cookies.some((c) => c.startsWith('access_token=') && /HttpOnly/i.test(c)),
    ).toBe(true);
  });

  it('защищённый эндпоинт без cookie → 401 UNAUTHORIZED', async () => {
    const res = await http().get('/auth/me').expect(401);
    expect((res.body as { code: string }).code).toBe('UNAUTHORIZED');
  });

  it('/health публичный', async () => {
    await http().get('/health').expect(200);
  });

  it('неактивный пользователь не может войти', async () => {
    const owner = await registerOwner(app);
    await db
      .update(usersTable)
      .set({ active: false })
      .where(eq(usersTable.email, owner.email));
    await http()
      .post('/auth/login')
      .send({ email: owner.email, password: PASSWORD })
      .expect(401);
  });

  describe('сброс пароля', () => {
    it('forgot-password не раскрывает существование email', async () => {
      const unknown = await http()
        .post('/auth/forgot-password')
        .send({ email: uniqueEmail('ghost') })
        .expect(200);
      const owner = await registerOwner(app);
      const known = await http()
        .post('/auth/forgot-password')
        .send({ email: owner.email })
        .expect(200);
      expect(unknown.body).toEqual(known.body);
    });

    it('reset-password меняет пароль, токен одноразовый', async () => {
      const owner = await registerOwner(app);
      await http()
        .post('/auth/forgot-password')
        .send({ email: owner.email })
        .expect(200);
      const { token } = sentResetTokens
        .filter((t) => t.to === owner.email)
        .pop()!;

      await http()
        .post('/auth/reset-password')
        .send({ token, password: 'new-password-1' })
        .expect(200);
      await http()
        .post('/auth/login')
        .send({ email: owner.email, password: 'new-password-1' })
        .expect(200);

      const again = await http()
        .post('/auth/reset-password')
        .send({ token, password: 'new-password-2' })
        .expect(400);
      expect((again.body as { code: string }).code).toBe('INVALID_RESET_TOKEN');
    });
  });
});
