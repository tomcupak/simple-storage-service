CREATE TYPE "public"."server_side_encryption_type" AS ENUM('none', 'AES256');--> statement-breakpoint
ALTER TABLE "multipart_part" ADD COLUMN "encryption" "server_side_encryption_type" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "multipart_part" ADD COLUMN "encryption_key" varchar;--> statement-breakpoint
ALTER TABLE "object_version" ADD COLUMN "encryption" "server_side_encryption_type" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "object_version" ADD COLUMN "encryption_key" varchar;