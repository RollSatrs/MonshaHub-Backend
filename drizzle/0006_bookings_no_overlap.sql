-- Custom SQL migration (drizzle-kit generate --custom): exclusion constraint не выражается в схеме Drizzle.
-- Запрещает пересечение активных (BOOKED) броней одного помещения. Основная защита — блокировка
-- помещения в сервисе; это страховка на уровне БД.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist ("room_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("status" = 'BOOKED');
