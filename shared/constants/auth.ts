/**
 * Имя httpOnly-cookie с JWT. Специально не `access_token`: cookie не привязаны к порту,
 * и другие локальные проекты на localhost с тем же именем перезаписывали бы сессию друг друга.
 * Frontend читает это же имя в proxy.ts (lib/auth-cookie.ts) — менять синхронно.
 */
export const AUTH_COOKIE = 'monshahub_token';
