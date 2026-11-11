DROP INDEX "idx_multipart_upload_bucket_key";--> statement-breakpoint
DROP INDEX "idx_object_bucket_key_prefix";--> statement-breakpoint
CREATE INDEX "idx_multipart_upload_bucket_key_c" ON "multipart_upload" USING btree ("bucket_guid","key" COLLATE "C");--> statement-breakpoint
CREATE INDEX "idx_object_bucket_key_c" ON "object" USING btree ("bucket_guid","key" COLLATE "C");