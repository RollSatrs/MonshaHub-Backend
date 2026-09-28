# MonshaHub Backend

Backend системы управления общественными банями и банными комплексами.
Центр продукта — реальная работа бани во время посещения клиента (`Visit`).

## Стек

- **NestJS 11** (Express)
- **Drizzle ORM** + PostgreSQL 16
- **JWT-авторизация** через httpOnly-cookie `monshahub_token` (`shared/constants/auth.ts`) (`@nestjs/jwt`)
- **class-validator / class-transformer** — валидация DTO (строгий `ValidationPipe`)
- **@nestjs/throttler** — rate-limiting
- **@nestjs/swagger** — OpenAPI-контракт для frontend
- **Nodemailer** — письма (сброс пароля)
- **Jest** — unit и e2e тесты

## Модель доступа

**Organization** — конкретная баня / банный комплекс. Все бизнес-данные принадлежат организации,
пользователь одной организации не имеет доступа к данным другой. `organizationId` всегда берётся
из JWT (`@CurrentUser()`), а не из тела запроса.

| Роль      | Что может                                                                      |
| --------- | ------------------------------------------------------------------------------ |
| `OWNER`   | Владелец: полный доступ к своей организации, сотрудники, настройки, аналитика  |
| `CASHIER` | Касса: работа с посещениями, бронированиями, оплатой                            |

- Публичная регистрация (`POST /auth/register`) создаёт **новую организацию и её OWNER**. Роль выбрать нельзя.
- Кассиров создаёт OWNER: `POST /staff/cashiers`.
- Все эндпоинты закрыты по умолчанию (глобальный `JwtAuthGuard`); публичные помечаются `@Public()`.
  Ограничение по ролям — `@Roles('OWNER')` + глобальный `RolesGuard`.

## Быстрый старт

### 1. Переменные окружения

```bash
cp .env.example .env
```

| Переменная                             | Описание                                                       |
| -------------------------------------- | -------------------------------------------------------------- |
| `PORT`                                 | Порт сервера (по умолчанию `3001`)                             |
| `DATABASE_URL`                         | Строка подключения к PostgreSQL                                |
| `FRONT_URL`                            | URL фронтенда (CORS + ссылки в письмах)                        |
| `SECRET_KEY`                           | Секрет подписи JWT, **минимум 32 символа**                     |
| `SMTP_HOST/PORT/SECURE/USER/PASS/FROM` | Почта для сброса пароля                                        |
| `NODE_ENV`                             | `development` / `production` / `test`                          |
| `TEST_DATABASE_URL`                    | Только для e2e: отдельная БД с применёнными миграциями         |

Переменные валидируются при старте (`src/config/env.validation.ts`).

### 2. Локальный запуск

```bash
pnpm install
pnpm db:migrate    # применить миграции
pnpm db:seed       # демо-данные (только не в production)
pnpm start:dev
```

Seed идемпотентно создаёт организацию «MonshaHub Demo», владельца `owner@monshahub.demo` и кассира
`cashier@monshahub.demo` (публичный демо-пароль `demo12345`, только для локальной разработки), а также
каталог: 5 помещений с тарифами (VIP №1–3, Семейный зал — почасовые; Общий мужской зал — вход Adult/Child),
5 товаров (с начальным остатком в журнале движений) и 2 услуги.

### 3. Docker

```bash
docker compose up --build
```

Поднимает Postgres, **применяет миграции** (одноразовый сервис `migrate`) и только после этого запускает backend.

## Команды

| Команда                | Назначение                                                        |
| ---------------------- | ----------------------------------------------------------------- |
| `pnpm start:dev`       | Запуск в watch-режиме                                             |
| `pnpm build`           | Сборка в `dist/`                                                  |
| `pnpm start:prod`      | Запуск собранного приложения (`dist/src/main`)                    |
| `pnpm lint`            | ESLint с автофиксом                                               |
| `pnpm test`            | Unit-тесты                                                        |
| `pnpm test:e2e`        | E2E-тесты (нужна PostgreSQL, см. ниже)                            |
| `pnpm db:generate`     | Сгенерировать миграцию из `src/db/schema.ts`                      |
| `pnpm db:migrate`      | Применить миграции (dev, через drizzle-kit)                       |
| `pnpm db:migrate:prod` | Применить миграции из собранного кода (production, без drizzle-kit) |
| `pnpm db:seed`         | Demo-данные для разработки                                        |
| `pnpm db:studio`       | Drizzle Studio                                                    |
| `pnpm openapi:export`  | Экспортировать OpenAPI-контракт в `openapi.json` (без БД)         |
| `pnpm openapi:check`   | Проверить, что закоммиченный `openapi.json` актуален (запускается в CI) |

### Изменения схемы БД

Только через миграции:

```bash
# правим src/db/schema.ts
pnpm db:generate   # создаёт файл в drizzle/
pnpm db:migrate    # применяет
```

`db:push` для рабочих изменений **не используется**. Сгенерированные миграции и `drizzle/meta`
вручную не редактируются и не удаляются.

### E2E-тесты

E2E работают с реальной PostgreSQL. Создайте отдельную БД, примените миграции и задайте `TEST_DATABASE_URL`:

```bash
createdb monshahub_test
DATABASE_URL=postgresql://localhost:5432/monshahub_test pnpm db:migrate
TEST_DATABASE_URL=postgresql://localhost:5432/monshahub_test pnpm test:e2e
```

Тесты создают данные с email-доменом `@e2e.monshahub.test` и удаляют их после прогона.
Rate-limit в тестах отключён (`NODE_ENV=test`).

## Production: миграции

Production-образ не содержит `drizzle-kit`. Миграции применяются встроенным мигратором
`drizzle-orm` (`src/db/migrate.ts`) из папки `drizzle/`, которая копируется в образ. Журнал
(`drizzle.__drizzle_migrations`) общий с `drizzle-kit migrate`, поэтому оба способа взаимозаменяемы.

- Docker Compose: сервис `migrate` запускается перед backend автоматически.
- Отдельный деплой: выполнить **до** старта новой версии `node dist/src/db/migrate`
  (в образе, с теми же `DATABASE_URL`, что и у backend), например как pre-deploy шаг / init-контейнер.
- Миграции выполняются один раз на релиз, не на каждый экземпляр приложения.

## API-документация и контракт

- Swagger UI: `/api/docs`, JSON: `/api/docs-json` (вне `production`).
- `pnpm openapi:export` пишет `openapi.json`. Frontend генерирует из него типы (`pnpm api:types`
  в репозитории frontend) — это единственный источник истины по формам запросов/ответов.

### Справочники бани (Phase 1)

| Ресурс | Endpoints | Права |
| ------ | --------- | ----- |
| Organization | `GET/PATCH /organization` | чтение — все, PATCH — OWNER (меняется только название) |
| Rooms | `/rooms` (+ `/:id`) | чтение — все (CASHIER только активные), запись — OWNER |
| Tariffs | `/tariffs` | то же; `kind` определяет backend по типу помещения |
| Products | `/products`, `POST/GET /products/:id/stock-movements` | то же; журнал движений — только OWNER |
| Services | `/services` | то же |
| Staff | `GET /staff`, `POST /staff/cashiers`, `PATCH /staff/:id` | OWNER; деактивация кассира закрывает доступ сразу |

- **Деньги:** `numeric(12,2)` в БД, в API — decimal-строка (`"10000.00"`); арифметика на backend через `Money`-хелпер
  (целые minor-единицы, без float). Frontend деньги только форматирует.
- **Тарифы:** привязаны к помещению. PRIVATE → `HOURLY`, PUBLIC → `PER_ENTRY` + `guestCategory` (`ADULT`/`CHILD`).
  Не более одного активного тарифа на вид (partial unique index). Правило расчёта часа определится в Phase 2.
- **Остаток товара** меняется только через `stock-movements` (RESTOCK / WRITE_OFF / ADJUSTMENT; SALE — Phase 2):
  один условный `UPDATE` + запись журнала в одной транзакции, ниже нуля не уйдёт даже при параллельных запросах.
- **Жизненный цикл:** основной путь — архивация (`active=false`). `DELETE` — техническая операция только для
  никогда не использованных записей; иначе `409 ENTITY_IN_USE` (FK на историю — `NO ACTION`).
- **Tenant isolation:** чужая запись → `404`; тарифы привязываются к помещению композитным FK
  `(room_id, organization_id)`.

### Формат ошибок

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Ошибка валидации",
  "details": ["email must be an email"],
  "path": "/auth/login",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

`message` — всегда строка; `details` есть у ошибок валидации. Frontend различает ошибки по `code`
(`src/common/errors/error-codes.ts`), а не по тексту.

## Структура проекта

```
src/
  auth/       # регистрация (Organization + OWNER), логин, сброс пароля, JwtAuthGuard
  staff/      # сотрудники организации (создание/деактивация кассиров, только OWNER)
  organization/  rooms/  tariffs/  products/  bath-services/   # справочники бани (Phase 1)
  mail/       # отправка писем
  db/         # схема Drizzle, seed.ts, migrate.ts
  config/     # валидация переменных окружения
  common/     # декораторы (@Public/@Roles/@CurrentUser), RolesGuard, exception filter, коды ошибок
  health/     # health-check
shared/       # константы (роли) и утилиты
drizzle/      # сгенерированные SQL-миграции (не править вручную)
test/         # e2e-тесты
scripts/      # экспорт OpenAPI
```

## Безопасность

- Пароли хешируются (bcrypt), JWT в httpOnly-cookie (`secure` в `production`).
- Rate-limiting на auth-эндпоинтах, `helmet`, строгая валидация (`whitelist` + `forbidNonWhitelisted`).
- Вход не раскрывает, существует ли email; `passwordHash` никогда не попадает в ответы API.
- Глобальный exception filter скрывает внутренние детали ошибок.

## CI

`.github/workflows/ci.yml`: install → lint → test → build на push/PR в `main`.
E2E в CI пока не запускаются (нужен сервис PostgreSQL).

## Лицензия

Приватный проект, см. [LICENSE](./LICENSE).
