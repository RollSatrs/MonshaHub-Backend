# MonshaHub

Система управления общественными банями и банными комплексами. Центр продукта —
реальная работа бани во время посещения клиента (`Visit`), а не бронирование само по себе.

## Repositories

- **Backend** (this repo): [RollSatrs/MonshaHub-Backend](https://github.com/RollSatrs/MonshaHub-Backend)
  NestJS 11 + Drizzle ORM + PostgreSQL. Источник истины по бизнес-логике: ценам, остаткам,
  состоянию помещений, правам доступа. Frontend ничего из этого не пересчитывает сам.
- **Frontend**: [RollSatrs/MonshaHub-Frontend](https://github.com/RollSatrs/MonshaHub-Frontend)
  Next.js 16 (App Router) + React 19 + Tailwind 4 + shadcn/ui. Типы запросов/ответов
  генерируются из OpenAPI backend (`pnpm api:types`) — не описываются вручную.

## Active team

- **Роллан** — backend
- **Асанали** — see assigned Issues for current scope

Roles are per-feature, not permanent — check Issue assignments rather than assuming.

## Project state

- Phase 0 (foundation: auth, roles OWNER/CASHIER, organizations) — merged to `main`.
- Phase 1 (rooms, tariffs, products with stock journal, services, staff) — merged to `main`.
- Phase 2 (bookings, visits, live cashier board, payments) — in progress, not yet merged.

## Collaboration

- **GitHub Issues** are the source of truth for tasks. Don't rely on chat history between
  agents — if it matters to someone else's work, it belongs in an Issue or PR comment.
- A **GitHub Project** spanning both repos should be used for overall status once created;
  check for one before creating a duplicate.
- Development happens in feature branches, never directly on `main`.
  Suggested format: `agent/<developer>/<issue-number>-<short-name>`.
- Finished work goes through a **Pull Request** referencing its Issue (`Closes #N`).
- Changes that affect the other repository (API contract, auth cookie, error format) must
  be called out in the Issue or PR description — don't let them surface only as a silent
  frontend/backend mismatch.

## Conventions that must not break

See each repo's `CLAUDE.md` for the full list enforced by Claude Code. Key points relevant
to any contributor:

- Schema changes: `pnpm db:generate` → `pnpm db:migrate`. Never `db:push` for real changes;
  never hand-edit generated files under `drizzle/`.
- Auth: httpOnly cookie session (`shared/constants/auth.ts`), not a bearer token in JS.
- Errors: `{ statusCode, code, message, details?, meta?, path, timestamp }` — frontend
  branches on `code`, never on `message` text.
- Catalog entities (rooms, tariffs, products, services) are archived (`active=false`), not
  deleted, once they've been used anywhere. Physical `DELETE` only works pre-use.
- `pnpm openapi:export` must be re-run (and the frontend's `pnpm api:types` after it)
  whenever a DTO changes — `pnpm openapi:check` enforces this in CI.
