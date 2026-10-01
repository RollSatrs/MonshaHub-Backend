CREATE TYPE "public"."booking_status" AS ENUM('BOOKED', 'STARTED', 'CANCELLED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'CARD', 'KASPI', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."visit_item_kind" AS ENUM('ROOM_TIME', 'ENTRY', 'PRODUCT', 'SERVICE');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('ACTIVE', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."stock_movement_type" ADD VALUE 'SALE_RETURN';--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bookings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"room_id" integer NOT NULL,
	"customer_name" varchar(255) NOT NULL,
	"customer_phone" varchar(32) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "booking_status" DEFAULT 'BOOKED' NOT NULL,
	"notes" varchar(500),
	"created_by" integer NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" integer,
	"close_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_id_organization_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "bookings_interval_check" CHECK ("bookings"."ends_at" > "bookings"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"visit_id" integer NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" "payment_method" NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "room_cleanings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "room_cleanings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"room_id" integer NOT NULL,
	"visit_id" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"finished_by" integer,
	CONSTRAINT "room_cleanings_visit_unique" UNIQUE("visit_id")
);
--> statement-breakpoint
CREATE TABLE "visit_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "visit_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"visit_id" integer NOT NULL,
	"kind" "visit_item_kind" NOT NULL,
	"product_id" integer,
	"service_id" integer,
	"tariff_id" integer,
	"name_snapshot" varchar(255) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"minutes" integer,
	"guest_category" "guest_category",
	"line_total" numeric(12, 2) NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" integer,
	"void_reason" varchar(500),
	CONSTRAINT "visit_items_id_organization_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "visit_items_quantity_check" CHECK ("visit_items"."quantity" > 0),
	CONSTRAINT "visit_items_amounts_check" CHECK ("visit_items"."unit_price" >= 0 AND "visit_items"."line_total" >= 0),
	CONSTRAINT "visit_items_kind_check" CHECK (("visit_items"."kind" = 'PRODUCT' AND "visit_items"."product_id" IS NOT NULL) OR ("visit_items"."kind" = 'SERVICE' AND "visit_items"."service_id" IS NOT NULL) OR ("visit_items"."kind" = 'ENTRY' AND "visit_items"."guest_category" IS NOT NULL) OR ("visit_items"."kind" = 'ROOM_TIME' AND "visit_items"."minutes" IS NOT NULL AND "visit_items"."minutes" > 0)),
	CONSTRAINT "visit_items_void_check" CHECK (("visit_items"."voided_at" IS NULL) = ("visit_items"."voided_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "visits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"room_id" integer NOT NULL,
	"kind" "room_type" NOT NULL,
	"status" "visit_status" DEFAULT 'ACTIVE' NOT NULL,
	"booking_id" integer,
	"customer_name" varchar(255),
	"customer_phone" varchar(32),
	"guests_count" integer,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"completed_by" integer,
	"room_name" varchar(255) NOT NULL,
	"tariff_id" integer,
	"tariff_name" varchar(255),
	"hourly_rate" numeric(12, 2),
	"time_step_minutes" integer,
	"currency" char(3) NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" integer,
	"cancel_reason" varchar(500),
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_id_organization_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "visits_private_fields_check" CHECK (("visits"."kind" = 'PRIVATE' AND "visits"."ends_at" IS NOT NULL AND "visits"."hourly_rate" IS NOT NULL AND "visits"."time_step_minutes" IS NOT NULL) OR ("visits"."kind" = 'PUBLIC' AND "visits"."ends_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_type_sign_check";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "time_step_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "visit_item_id" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_room_organization_fk" FOREIGN KEY ("room_id","organization_id") REFERENCES "public"."rooms"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_visit_organization_fk" FOREIGN KEY ("visit_id","organization_id") REFERENCES "public"."visits"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_cleanings" ADD CONSTRAINT "room_cleanings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_cleanings" ADD CONSTRAINT "room_cleanings_finished_by_users_id_fk" FOREIGN KEY ("finished_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_cleanings" ADD CONSTRAINT "room_cleanings_room_organization_fk" FOREIGN KEY ("room_id","organization_id") REFERENCES "public"."rooms"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_cleanings" ADD CONSTRAINT "room_cleanings_visit_organization_fk" FOREIGN KEY ("visit_id","organization_id") REFERENCES "public"."visits"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_items" ADD CONSTRAINT "visit_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_items" ADD CONSTRAINT "visit_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_items" ADD CONSTRAINT "visit_items_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_items" ADD CONSTRAINT "visit_items_visit_organization_fk" FOREIGN KEY ("visit_id","organization_id") REFERENCES "public"."visits"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_items" ADD CONSTRAINT "visit_items_product_organization_fk" FOREIGN KEY ("product_id","organization_id") REFERENCES "public"."products"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_items" ADD CONSTRAINT "visit_items_service_organization_fk" FOREIGN KEY ("service_id","organization_id") REFERENCES "public"."services"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_items" ADD CONSTRAINT "visit_items_tariff_organization_fk" FOREIGN KEY ("tariff_id","organization_id") REFERENCES "public"."tariffs"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_room_organization_fk" FOREIGN KEY ("room_id","organization_id") REFERENCES "public"."rooms"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_booking_organization_fk" FOREIGN KEY ("booking_id","organization_id") REFERENCES "public"."bookings"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_tariff_organization_fk" FOREIGN KEY ("tariff_id","organization_id") REFERENCES "public"."tariffs"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_room_starts_idx" ON "bookings" USING btree ("room_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_organization_starts_idx" ON "bookings" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX "payments_visit_idx" ON "payments" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "payments_organization_created_idx" ON "payments" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "room_cleanings_open_room_unique" ON "room_cleanings" USING btree ("room_id") WHERE "room_cleanings"."finished_at" IS NULL;--> statement-breakpoint
CREATE INDEX "room_cleanings_organization_started_idx" ON "room_cleanings" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "visit_items_visit_idx" ON "visit_items" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "visit_items_organization_kind_created_idx" ON "visit_items" USING btree ("organization_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_active_private_room_unique" ON "visits" USING btree ("room_id") WHERE "visits"."status" = 'ACTIVE' AND "visits"."kind" = 'PRIVATE';--> statement-breakpoint
CREATE UNIQUE INDEX "visits_booking_unique" ON "visits" USING btree ("booking_id") WHERE "visits"."booking_id" IS NOT NULL AND "visits"."status" <> 'CANCELLED';--> statement-breakpoint
CREATE INDEX "visits_organization_status_idx" ON "visits" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "visits_room_status_idx" ON "visits" USING btree ("room_id","status");--> statement-breakpoint
CREATE INDEX "visits_organization_started_idx" ON "visits" USING btree ("organization_id","started_at");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_visit_item_fk" FOREIGN KEY ("visit_item_id","organization_id") REFERENCES "public"."visit_items"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_visit_item_idx" ON "stock_movements" USING btree ("visit_item_id");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_time_step_check" CHECK ("organizations"."time_step_minutes" IN (15, 30, 60));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_type_sign_check" CHECK (("stock_movements"."type"::text IN ('RESTOCK', 'SALE_RETURN') AND "stock_movements"."quantity_delta" > 0) OR ("stock_movements"."type"::text IN ('WRITE_OFF', 'SALE') AND "stock_movements"."quantity_delta" < 0) OR "stock_movements"."type"::text = 'ADJUSTMENT');