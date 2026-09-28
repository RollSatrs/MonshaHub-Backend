CREATE TYPE "public"."guest_category" AS ENUM('ADULT', 'CHILD');--> statement-breakpoint
CREATE TYPE "public"."room_type" AS ENUM('PRIVATE', 'PUBLIC');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_type" AS ENUM('RESTOCK', 'WRITE_OFF', 'ADJUSTMENT', 'SALE');--> statement-breakpoint
CREATE TYPE "public"."tariff_kind" AS ENUM('HOURLY', 'PER_ENTRY');--> statement-breakpoint
CREATE TABLE "products" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "products_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "products_id_organization_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "products_price_check" CHECK ("products"."price" >= 0),
	CONSTRAINT "products_stock_check" CHECK ("products"."stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rooms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "room_type" NOT NULL,
	"capacity" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_id_organization_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "rooms_capacity_check" CHECK ("rooms"."capacity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "services_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "services_id_organization_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "services_price_check" CHECK ("services"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_movements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"type" "stock_movement_type" NOT NULL,
	"quantity_delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" varchar(500),
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_delta_check" CHECK ("stock_movements"."quantity_delta" <> 0),
	CONSTRAINT "stock_movements_balance_check" CHECK ("stock_movements"."balance_after" >= 0),
	CONSTRAINT "stock_movements_type_sign_check" CHECK (("stock_movements"."type" = 'RESTOCK' AND "stock_movements"."quantity_delta" > 0) OR ("stock_movements"."type" IN ('WRITE_OFF', 'SALE') AND "stock_movements"."quantity_delta" < 0) OR "stock_movements"."type" = 'ADJUSTMENT')
);
--> statement-breakpoint
CREATE TABLE "tariffs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tariffs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"room_id" integer NOT NULL,
	"kind" "tariff_kind" NOT NULL,
	"guest_category" "guest_category",
	"name" varchar(255) NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tariffs_id_organization_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "tariffs_price_check" CHECK ("tariffs"."price" >= 0),
	CONSTRAINT "tariffs_kind_category_check" CHECK (("tariffs"."kind" = 'HOURLY' AND "tariffs"."guest_category" IS NULL) OR ("tariffs"."kind" = 'PER_ENTRY' AND "tariffs"."guest_category" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "currency" char(3) DEFAULT 'KZT' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "timezone" varchar(64) DEFAULT 'Asia/Almaty' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_organization_fk" FOREIGN KEY ("product_id","organization_id") REFERENCES "public"."products"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariffs" ADD CONSTRAINT "tariffs_room_organization_fk" FOREIGN KEY ("room_id","organization_id") REFERENCES "public"."rooms"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_organization_name_unique" ON "products" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "products_organization_active_idx" ON "products" USING btree ("organization_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_organization_name_unique" ON "rooms" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "rooms_organization_active_sort_idx" ON "rooms" USING btree ("organization_id","active","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "services_organization_name_unique" ON "services" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "services_organization_active_idx" ON "services" USING btree ("organization_id","active");--> statement-breakpoint
CREATE INDEX "stock_movements_product_created_idx" ON "stock_movements" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_organization_created_idx" ON "stock_movements" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "tariffs_organization_room_idx" ON "tariffs" USING btree ("organization_id","room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tariffs_active_hourly_unique" ON "tariffs" USING btree ("room_id") WHERE "tariffs"."kind" = 'HOURLY' AND "tariffs"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "tariffs_active_entry_unique" ON "tariffs" USING btree ("room_id","guest_category") WHERE "tariffs"."kind" = 'PER_ENTRY' AND "tariffs"."active";