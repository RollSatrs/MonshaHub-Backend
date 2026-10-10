ALTER TABLE "bookings" ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "room_cleanings" ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "visit_items" ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "visits" ALTER COLUMN "branch_id" SET NOT NULL;