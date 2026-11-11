CREATE TYPE "public"."audit_action_type" AS ENUM('user.login', 'user.create', 'user.update', 'user.set-password', 'user.set-status', 'user.set-quota', 'user.delete', 'bucket.create', 'bucket.delete', 'bucket.set-acl', 'bucket.set-versioning', 'bucket.set-quota', 'bucket.set-grant', 'bucket.remove-grant', 'bucket.set-policy', 'bucket.delete-policy', 'object.upload', 'object.download', 'object.delete', 'object.delete-prefix', 'object.create-folder', 'object.copy', 'object.move', 'object.presign', 'access-key.create', 'access-key.set-status', 'access-key.delete');--> statement-breakpoint
CREATE TYPE "public"."audit_result_type" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TYPE "public"."user_status_type" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"guid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" "audit_action_type" NOT NULL,
	"result" "audit_result_type" DEFAULT 'success' NOT NULL,
	"user_guid" uuid,
	"user_email" varchar,
	"bucket_name" varchar,
	"object_key" varchar,
	"target_guid" uuid,
	"source_ip" varchar,
	"user_agent" varchar,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bucket" ADD COLUMN "quota_bytes" bigint;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "status" "user_status_type" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "quota_bytes" bigint;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_guid_user_guid_fk" FOREIGN KEY ("user_guid") REFERENCES "public"."user"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_log_created_at" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_log_user" ON "audit_log" USING btree ("user_guid");--> statement-breakpoint
CREATE INDEX "idx_audit_log_bucket" ON "audit_log" USING btree ("bucket_name");