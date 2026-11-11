CREATE TYPE "public"."access_key_status_type" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."bucket_acl_type" AS ENUM('private', 'public-read', 'public-read-write', 'authenticated-read');--> statement-breakpoint
CREATE TYPE "public"."bucket_permission_type" AS ENUM('read', 'write', 'delete', 'manage');--> statement-breakpoint
CREATE TYPE "public"."bucket_versioning_type" AS ENUM('disabled', 'enabled', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."multipart_upload_status_type" AS ENUM('in-progress', 'completed', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."storage_class_type" AS ENUM('STANDARD');--> statement-breakpoint
CREATE TYPE "public"."user_role_type" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TABLE "access_key" (
	"access_key_id" varchar PRIMARY KEY NOT NULL,
	"user_guid" uuid NOT NULL,
	"secret_key_encrypted" varchar NOT NULL,
	"description" varchar,
	"status" "access_key_status_type" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bucket" (
	"guid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"owner_user_guid" uuid NOT NULL,
	"region" varchar DEFAULT 'us-east-1' NOT NULL,
	"acl" "bucket_acl_type" DEFAULT 'private' NOT NULL,
	"versioning" "bucket_versioning_type" DEFAULT 'disabled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bucket_access" (
	"bucket_guid" uuid NOT NULL,
	"user_guid" uuid NOT NULL,
	"permissions" "bucket_permission_type"[] DEFAULT '{}'::bucket_permission_type[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bucket_access_bucket_guid_user_guid_pk" PRIMARY KEY("bucket_guid","user_guid")
);
--> statement-breakpoint
CREATE TABLE "bucket_policy" (
	"bucket_guid" uuid PRIMARY KEY NOT NULL,
	"document" jsonb NOT NULL,
	"updated_by_user_guid" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "multipart_part" (
	"upload_guid" uuid NOT NULL,
	"part_number" integer NOT NULL,
	"size" bigint NOT NULL,
	"etag" varchar NOT NULL,
	"storage_path" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "multipart_part_upload_guid_part_number_pk" PRIMARY KEY("upload_guid","part_number")
);
--> statement-breakpoint
CREATE TABLE "multipart_upload" (
	"guid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" varchar NOT NULL,
	"bucket_guid" uuid NOT NULL,
	"key" varchar NOT NULL,
	"status" "multipart_upload_status_type" DEFAULT 'in-progress' NOT NULL,
	"content_type" varchar,
	"metadata" jsonb,
	"initiated_by_access_key_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "object" (
	"guid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket_guid" uuid NOT NULL,
	"key" varchar NOT NULL,
	"latest_version_guid" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "object_version" (
	"guid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_guid" uuid NOT NULL,
	"version_id" varchar NOT NULL,
	"is_delete_marker" boolean DEFAULT false NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"etag" varchar NOT NULL,
	"content_type" varchar,
	"content_encoding" varchar,
	"cache_control" varchar,
	"content_disposition" varchar,
	"storage_class" "storage_class_type" DEFAULT 'STANDARD' NOT NULL,
	"storage_path" varchar,
	"metadata" jsonb,
	"created_by_access_key_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user" (
	"guid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar NOT NULL,
	"name" varchar,
	"password_hash" varchar NOT NULL,
	"role" "user_role_type" DEFAULT 'user' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_session" (
	"guid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_guid" uuid NOT NULL,
	"refresh_token_hash" varchar NOT NULL,
	"user_agent" varchar,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_key" ADD CONSTRAINT "access_key_user_guid_user_guid_fk" FOREIGN KEY ("user_guid") REFERENCES "public"."user"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bucket" ADD CONSTRAINT "bucket_owner_user_guid_user_guid_fk" FOREIGN KEY ("owner_user_guid") REFERENCES "public"."user"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bucket_access" ADD CONSTRAINT "bucket_access_bucket_guid_bucket_guid_fk" FOREIGN KEY ("bucket_guid") REFERENCES "public"."bucket"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bucket_access" ADD CONSTRAINT "bucket_access_user_guid_user_guid_fk" FOREIGN KEY ("user_guid") REFERENCES "public"."user"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bucket_policy" ADD CONSTRAINT "bucket_policy_bucket_guid_bucket_guid_fk" FOREIGN KEY ("bucket_guid") REFERENCES "public"."bucket"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bucket_policy" ADD CONSTRAINT "bucket_policy_updated_by_user_guid_user_guid_fk" FOREIGN KEY ("updated_by_user_guid") REFERENCES "public"."user"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multipart_part" ADD CONSTRAINT "multipart_part_upload_guid_multipart_upload_guid_fk" FOREIGN KEY ("upload_guid") REFERENCES "public"."multipart_upload"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multipart_upload" ADD CONSTRAINT "multipart_upload_bucket_guid_bucket_guid_fk" FOREIGN KEY ("bucket_guid") REFERENCES "public"."bucket"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object" ADD CONSTRAINT "object_bucket_guid_bucket_guid_fk" FOREIGN KEY ("bucket_guid") REFERENCES "public"."bucket"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_version" ADD CONSTRAINT "object_version_object_guid_object_guid_fk" FOREIGN KEY ("object_guid") REFERENCES "public"."object"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_user_guid_user_guid_fk" FOREIGN KEY ("user_guid") REFERENCES "public"."user"("guid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_access_key_user" ON "access_key" USING btree ("user_guid");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_bucket_name" ON "bucket" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_bucket_owner" ON "bucket" USING btree ("owner_user_guid");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_multipart_upload_id" ON "multipart_upload" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "idx_multipart_upload_bucket_key" ON "multipart_upload" USING btree ("bucket_guid","key");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_object_bucket_key" ON "object" USING btree ("bucket_guid","key");--> statement-breakpoint
CREATE INDEX "idx_object_bucket_key_prefix" ON "object" USING btree ("bucket_guid","key");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_object_version" ON "object_version" USING btree ("object_guid","version_id");--> statement-breakpoint
CREATE INDEX "idx_object_version_object" ON "object_version" USING btree ("object_guid");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_user_email" ON "user" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_user_session_token" ON "user_session" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "idx_user_session_user" ON "user_session" USING btree ("user_guid");