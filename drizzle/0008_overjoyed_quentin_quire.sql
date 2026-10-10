CREATE TABLE "branches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "branches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"address" varchar(500),
	"phone" varchar(32),
	"timezone" varchar(64) DEFAULT 'Asia/Almaty' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_id_organization_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "workplaces" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workplaces_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workplaces_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
DROP INDEX "products_organization_name_unique";--> statement-breakpoint
DROP INDEX "rooms_organization_name_unique";--> statement-breakpoint
DROP INDEX "services_organization_name_unique";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "room_cleanings" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "visit_items" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workplaces" ADD CONSTRAINT "workplaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workplaces" ADD CONSTRAINT "workplaces_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_organization_name_unique" ON "branches" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "branches_organization_active_idx" ON "branches" USING btree ("organization_id","active");--> statement-breakpoint
CREATE INDEX "workplaces_organization_idx" ON "workplaces" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workplaces_branch_idx" ON "workplaces" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workplaces_branch_name_unique" ON "workplaces" USING btree ("branch_id",lower("name"));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_cleanings" ADD CONSTRAINT "room_cleanings_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_items" ADD CONSTRAINT "visit_items_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_branch_name_unique" ON "products" USING btree ("organization_id","branch_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_branch_name_unique" ON "rooms" USING btree ("organization_id","branch_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "services_branch_name_unique" ON "services" USING btree ("organization_id","branch_id",lower("name"));--> statement-breakpoint
CREATE INDEX "users_branch_id_idx" ON "users" USING btree ("branch_id");