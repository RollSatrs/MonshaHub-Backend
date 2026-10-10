-- Каждая организация из однофилиальной версии получает филиал «Основной».
INSERT INTO "branches" ("organization_id", "name", "timezone")
SELECT o."id", 'Основной', o."timezone"
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "branches" b WHERE b."organization_id" = o."id"
);

UPDATE "users" t SET "branch_id" = b."id"
FROM "branches" b
WHERE t."organization_id" = b."organization_id"
  AND t."user_role" = 'CASHIER'
  AND t."branch_id" IS NULL
  AND b."id" = (SELECT min(x."id") FROM "branches" x WHERE x."organization_id" = t."organization_id");

UPDATE "rooms" t SET "branch_id" = b."id" FROM "branches" b
WHERE t."organization_id" = b."organization_id" AND t."branch_id" IS NULL
  AND b."id" = (SELECT min(x."id") FROM "branches" x WHERE x."organization_id" = t."organization_id");
UPDATE "products" t SET "branch_id" = b."id" FROM "branches" b
WHERE t."organization_id" = b."organization_id" AND t."branch_id" IS NULL
  AND b."id" = (SELECT min(x."id") FROM "branches" x WHERE x."organization_id" = t."organization_id");
UPDATE "services" t SET "branch_id" = b."id" FROM "branches" b
WHERE t."organization_id" = b."organization_id" AND t."branch_id" IS NULL
  AND b."id" = (SELECT min(x."id") FROM "branches" x WHERE x."organization_id" = t."organization_id");
UPDATE "bookings" t SET "branch_id" = b."id" FROM "branches" b
WHERE t."organization_id" = b."organization_id" AND t."branch_id" IS NULL
  AND b."id" = (SELECT min(x."id") FROM "branches" x WHERE x."organization_id" = t."organization_id");
UPDATE "visits" t SET "branch_id" = b."id" FROM "branches" b
WHERE t."organization_id" = b."organization_id" AND t."branch_id" IS NULL
  AND b."id" = (SELECT min(x."id") FROM "branches" x WHERE x."organization_id" = t."organization_id");
UPDATE "visit_items" t SET "branch_id" = b."id" FROM "branches" b
WHERE t."organization_id" = b."organization_id" AND t."branch_id" IS NULL
  AND b."id" = (SELECT min(x."id") FROM "branches" x WHERE x."organization_id" = t."organization_id");
UPDATE "payments" t SET "branch_id" = b."id" FROM "branches" b
WHERE t."organization_id" = b."organization_id" AND t."branch_id" IS NULL
  AND b."id" = (SELECT min(x."id") FROM "branches" x WHERE x."organization_id" = t."organization_id");
UPDATE "room_cleanings" t SET "branch_id" = b."id" FROM "branches" b
WHERE t."organization_id" = b."organization_id" AND t."branch_id" IS NULL
  AND b."id" = (SELECT min(x."id") FROM "branches" x WHERE x."organization_id" = t."organization_id");
UPDATE "stock_movements" t SET "branch_id" = b."id" FROM "branches" b
WHERE t."organization_id" = b."organization_id" AND t."branch_id" IS NULL
  AND b."id" = (SELECT min(x."id") FROM "branches" x WHERE x."organization_id" = t."organization_id");
