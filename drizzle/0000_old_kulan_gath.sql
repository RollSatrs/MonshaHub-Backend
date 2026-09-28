CREATE TYPE "public"."role" AS ENUM('admin', 'teacher', 'student', 'schoolkid');--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fullname" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" "role" DEFAULT 'student' NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
