ALTER TABLE "bucket" ADD COLUMN "cors" jsonb;--> statement-breakpoint
ALTER TABLE "multipart_upload" ADD COLUMN "content_encoding" varchar;--> statement-breakpoint
ALTER TABLE "multipart_upload" ADD COLUMN "cache_control" varchar;--> statement-breakpoint
ALTER TABLE "multipart_upload" ADD COLUMN "content_disposition" varchar;--> statement-breakpoint
ALTER TABLE "multipart_upload" ADD COLUMN "storage_class" "storage_class_type" DEFAULT 'STANDARD' NOT NULL;