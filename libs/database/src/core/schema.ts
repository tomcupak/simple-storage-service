import { sql } from 'drizzle-orm'
import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'

import { AccessKeyStatus, BucketAcl, BucketPermission, BucketVersioning, MultipartUploadStatus, StorageClass, UserRole } from './types'

export const userRoleType = pgEnum('user_role_type', UserRole)
export const bucketPermissionType = pgEnum('bucket_permission_type', BucketPermission)
export const accessKeyStatusType = pgEnum('access_key_status_type', AccessKeyStatus)
export const bucketAclType = pgEnum('bucket_acl_type', BucketAcl)
export const bucketVersioningType = pgEnum('bucket_versioning_type', BucketVersioning)
export const storageClassType = pgEnum('storage_class_type', StorageClass)
export const multipartUploadStatusType = pgEnum('multipart_upload_status_type', MultipartUploadStatus)

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = timestamp('updated_at', { withTimezone: true })
const deletedAt = timestamp('deleted_at', { withTimezone: true })

export const user = pgTable('user', {
	guid: uuid('guid').primaryKey().defaultRandom(),
	email: varchar('email').notNull(),
	name: varchar('name'),
	passwordHash: varchar('password_hash').notNull(),
	role: userRoleType('role').notNull().default(UserRole.user),
	lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
	createdAt,
	updatedAt,
	deletedAt,
}, (t) => [
	uniqueIndex('unique_user_email').on(t.email),
])

/** Refresh-token sessions for the management UI. Only the token hash is stored. */
export const userSession = pgTable('user_session', {
	guid: uuid('guid').primaryKey().defaultRandom(),
	userGuid: uuid('user_guid').references(() => user.guid).notNull(),
	refreshTokenHash: varchar('refresh_token_hash').notNull(),
	userAgent: varchar('user_agent'),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	revokedAt: timestamp('revoked_at', { withTimezone: true }),
	createdAt,
}, (t) => [
	uniqueIndex('unique_user_session_token').on(t.refreshTokenHash),
	index('idx_user_session_user').on(t.userGuid),
])

/** S3 credentials (SigV4). The secret is stored encrypted, never in plain text. */
export const accessKey = pgTable('access_key', {
	accessKeyId: varchar('access_key_id').primaryKey(),
	userGuid: uuid('user_guid').references(() => user.guid).notNull(),
	secretKeyEncrypted: varchar('secret_key_encrypted').notNull(),
	description: varchar('description'),
	status: accessKeyStatusType('status').notNull().default(AccessKeyStatus.active),
	expiresAt: timestamp('expires_at', { withTimezone: true }),
	lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
	createdAt,
	deletedAt,
}, (t) => [
	index('idx_access_key_user').on(t.userGuid),
])

export const bucket = pgTable('bucket', {
	guid: uuid('guid').primaryKey().defaultRandom(),
	/** S3 bucket name - globally unique within this deployment, DNS-compatible. */
	name: varchar('name').notNull(),
	ownerUserGuid: uuid('owner_user_guid').references(() => user.guid).notNull(),
	region: varchar('region').notNull().default('us-east-1'),
	acl: bucketAclType('acl').notNull().default(BucketAcl.private),
	versioning: bucketVersioningType('versioning').notNull().default(BucketVersioning.disabled),
	createdAt,
	updatedAt,
	deletedAt,
}, (t) => [
	uniqueIndex('unique_bucket_name').on(t.name),
	index('idx_bucket_owner').on(t.ownerUserGuid),
])

/** AWS-shaped bucket policy document (Version/Statement). Evaluated by the policy engine
 *  on every S3 request; one row per bucket. */
export const bucketPolicy = pgTable('bucket_policy', {
	bucketGuid: uuid('bucket_guid').references(() => bucket.guid).primaryKey(),
	document: jsonb('document').notNull(),
	updatedByUserGuid: uuid('updated_by_user_guid').references(() => user.guid),
	createdAt,
	updatedAt,
})

/** Management-level grants: which UI user may do what with a bucket. */
export const bucketAccess = pgTable('bucket_access', {
	bucketGuid: uuid('bucket_guid').references(() => bucket.guid).notNull(),
	userGuid: uuid('user_guid').references(() => user.guid).notNull(),
	permissions: bucketPermissionType('permissions').array().notNull().default(sql`'{}'::bucket_permission_type[]`),
	createdAt,
}, (t) => [
	primaryKey({ columns: [t.bucketGuid, t.userGuid] }),
])

/** One row per (bucket, key) - points at the newest version. Version rows hold the data. */
export const object = pgTable('object', {
	guid: uuid('guid').primaryKey().defaultRandom(),
	bucketGuid: uuid('bucket_guid').references(() => bucket.guid).notNull(),
	key: varchar('key').notNull(),
	latestVersionGuid: uuid('latest_version_guid'),
	createdAt,
	updatedAt,
}, (t) => [
	uniqueIndex('unique_object_bucket_key').on(t.bucketGuid, t.key),
	index('idx_object_bucket_key_prefix').on(t.bucketGuid, t.key),
])

export const objectVersion = pgTable('object_version', {
	guid: uuid('guid').primaryKey().defaultRandom(),
	objectGuid: uuid('object_guid').references(() => object.guid).notNull(),
	/** S3 version id handed out to clients ('null' for unversioned buckets). */
	versionId: varchar('version_id').notNull(),
	/** A delete marker carries no data - it only hides older versions. */
	isDeleteMarker: boolean('is_delete_marker').notNull().default(false),
	size: bigint('size', { mode: 'number' }).notNull().default(0),
	etag: varchar('etag').notNull(),
	contentType: varchar('content_type'),
	contentEncoding: varchar('content_encoding'),
	cacheControl: varchar('cache_control'),
	contentDisposition: varchar('content_disposition'),
	storageClass: storageClassType('storage_class').notNull().default(StorageClass.standard),
	/** Path of the blob on disk, relative to `STORAGE_DATA_PATH`. */
	storagePath: varchar('storage_path'),
	/** `x-amz-meta-*` user metadata. */
	metadata: jsonb('metadata'),
	createdByAccessKeyId: varchar('created_by_access_key_id'),
	createdAt,
	deletedAt,
}, (t) => [
	uniqueIndex('unique_object_version').on(t.objectGuid, t.versionId),
	index('idx_object_version_object').on(t.objectGuid),
])

export const multipartUpload = pgTable('multipart_upload', {
	guid: uuid('guid').primaryKey().defaultRandom(),
	/** S3 uploadId handed out to clients. */
	uploadId: varchar('upload_id').notNull(),
	bucketGuid: uuid('bucket_guid').references(() => bucket.guid).notNull(),
	key: varchar('key').notNull(),
	status: multipartUploadStatusType('status').notNull().default(MultipartUploadStatus.inProgress),
	contentType: varchar('content_type'),
	metadata: jsonb('metadata'),
	initiatedByAccessKeyId: varchar('initiated_by_access_key_id'),
	createdAt,
	updatedAt,
}, (t) => [
	uniqueIndex('unique_multipart_upload_id').on(t.uploadId),
	index('idx_multipart_upload_bucket_key').on(t.bucketGuid, t.key),
])

export const multipartPart = pgTable('multipart_part', {
	uploadGuid: uuid('upload_guid').references(() => multipartUpload.guid).notNull(),
	partNumber: integer('part_number').notNull(),
	size: bigint('size', { mode: 'number' }).notNull(),
	etag: varchar('etag').notNull(),
	storagePath: varchar('storage_path').notNull(),
	createdAt,
}, (t) => [
	primaryKey({ columns: [t.uploadGuid, t.partNumber] }),
])
