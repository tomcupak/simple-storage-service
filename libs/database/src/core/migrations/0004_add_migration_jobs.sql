CREATE TYPE "public"."migration_bucket_mode_type" AS ENUM('create', 'merge');--> statement-breakpoint
CREATE TYPE "public"."migration_bucket_status_type" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."migration_job_status_type" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."audit_action_type" ADD VALUE 'migration.start';--> statement-breakpoint
ALTER TYPE "public"."audit_action_type" ADD VALUE 'migration.cancel';--> statement-breakpoint
CREATE TABLE "migration_job" (
	"guid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "migration_job_status_type" DEFAULT 'queued' NOT NULL,
	"source_endpoint" varchar NOT NULL,
	"source_region" varchar NOT NULL,
	"source_access_key_id" varchar NOT NULL,
	"source_secret" varchar NOT NULL,
	"created_by_user_guid" uuid NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"error" varchar,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "migration_job_bucket" (
	"guid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_guid" uuid NOT NULL,
	"source_name" varchar NOT NULL,
	"target_bucket_guid" uuid,
	"mode" "migration_bucket_mode_type" NOT NULL,
	"overwrite" boolean DEFAULT false NOT NULL,
	"status" "migration_bucket_status_type" DEFAULT 'pending' NOT NULL,
	"objects_total" bigint DEFAULT 0 NOT NULL,
	"objects_done" bigint DEFAULT 0 NOT NULL,
	"objects_failed" bigint DEFAULT 0 NOT NULL,
	"objects_skipped" bigint DEFAULT 0 NOT NULL,
	"bytes_total" bigint DEFAULT 0 NOT NULL,
	"bytes_done" bigint DEFAULT 0 NOT NULL,
	"totals_computed" boolean DEFAULT false NOT NULL,
	"continuation_token" varchar,
	"policy_migrated" boolean DEFAULT false NOT NULL,
	"policy_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "migration_job_error" (
	"guid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_guid" uuid NOT NULL,
	"bucket_guid" uuid NOT NULL,
	"key" varchar NOT NULL,
	"code" varchar NOT NULL,
	"message" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "migration_job" ADD CONSTRAINT "migration_job_created_by_user_guid_user_guid_fk" FOREIGN KEY ("created_by_user_guid") REFERENCES "public"."user"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_job_bucket" ADD CONSTRAINT "migration_job_bucket_job_guid_migration_job_guid_fk" FOREIGN KEY ("job_guid") REFERENCES "public"."migration_job"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_job_bucket" ADD CONSTRAINT "migration_job_bucket_target_bucket_guid_bucket_guid_fk" FOREIGN KEY ("target_bucket_guid") REFERENCES "public"."bucket"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_job_error" ADD CONSTRAINT "migration_job_error_job_guid_migration_job_guid_fk" FOREIGN KEY ("job_guid") REFERENCES "public"."migration_job"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_job_error" ADD CONSTRAINT "migration_job_error_bucket_guid_migration_job_bucket_guid_fk" FOREIGN KEY ("bucket_guid") REFERENCES "public"."migration_job_bucket"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_migration_job_status" ON "migration_job" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_migration_job_bucket" ON "migration_job_bucket" USING btree ("job_guid","source_name");--> statement-breakpoint
CREATE INDEX "idx_migration_job_error_job" ON "migration_job_error" USING btree ("job_guid");