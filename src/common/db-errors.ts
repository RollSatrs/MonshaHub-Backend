interface PgErrorLike {
  code?: string;
  constraint?: string;
  cause?: PgErrorLike;
}

/** drizzle оборачивает ошибки драйвера в `cause`. */
function pg(err: unknown): PgErrorLike {
  const e = err as PgErrorLike;
  return e?.cause?.code ? e.cause : e;
}

/** Нарушение UNIQUE. Возвращает имя ограничения или undefined, если ошибка другая. */
export function uniqueViolation(err: unknown): string | undefined {
  const e = pg(err);
  return e?.code === '23505' ? (e.constraint ?? '') : undefined;
}

/** Нарушение FOREIGN KEY (запись используется — удалить нельзя). */
export function isForeignKeyViolation(err: unknown): boolean {
  return pg(err)?.code === '23503';
}
