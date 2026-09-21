/** Global role of a management (UI) user. Bucket-level rights are granted separately. */
export enum UserRole {
	/** Full access to every bucket, user and access key. */
	admin = 'admin',
	/** Sees only what an explicit bucket grant (`bucket_access`) allows. */
	user = 'user',
}

/** UI/management-level rights on a single bucket. Distinct from S3 bucket policies,
 *  which are evaluated per S3 request by the policy engine. */
export enum BucketPermission {
	read = 'read',
	write = 'write',
	delete = 'delete',
	/** Manage the bucket itself: settings, policy document, grants. */
	manage = 'manage',
}

/** Whether a management user may still sign in. Deactivating keeps the account, its buckets
 *  and its access keys intact - unlike a delete, which soft-deletes the row. */
export enum UserStatus {
	active = 'active',
	disabled = 'disabled',
}

export enum AccessKeyStatus {
	active = 'active',
	inactive = 'inactive',
}

/** S3 `x-amz-acl` canned ACLs supported on buckets. */
export enum BucketAcl {
	private = 'private',
	publicRead = 'public-read',
	publicReadWrite = 'public-read-write',
	authenticatedRead = 'authenticated-read',
}

export enum BucketVersioning {
	disabled = 'disabled',
	enabled = 'enabled',
	suspended = 'suspended',
}

/** Storage class reported back on S3 responses. Only `standard` is materialised today. */
export enum StorageClass {
	standard = 'STANDARD',
}

/** How an object version's payload is stored on disk. `AES256` is the one algorithm SSE-S3
 *  uses, and the value S3 reports in `x-amz-server-side-encryption`; `none` means the blob is
 *  stored in the clear, which is what every object written before encryption was switched on is. */
export enum ServerSideEncryption {
	none = 'none',
	aes256 = 'AES256',
}

export enum MultipartUploadStatus {
	inProgress = 'in-progress',
	completed = 'completed',
	aborted = 'aborted',
}

/** Management operations recorded in the audit log, one value per mutating endpoint. */
export enum AuditAction {
	userLogin = 'user.login',
	userCreate = 'user.create',
	userUpdate = 'user.update',
	userSetPassword = 'user.set-password',
	userSetStatus = 'user.set-status',
	userSetQuota = 'user.set-quota',
	userDelete = 'user.delete',
	bucketCreate = 'bucket.create',
	bucketDelete = 'bucket.delete',
	bucketSetAcl = 'bucket.set-acl',
	bucketSetVersioning = 'bucket.set-versioning',
	bucketSetQuota = 'bucket.set-quota',
	bucketSetGrant = 'bucket.set-grant',
	bucketRemoveGrant = 'bucket.remove-grant',
	bucketSetPolicy = 'bucket.set-policy',
	bucketDeletePolicy = 'bucket.delete-policy',
	objectUpload = 'object.upload',
	objectDownload = 'object.download',
	objectDelete = 'object.delete',
	objectDeletePrefix = 'object.delete-prefix',
	objectCreateFolder = 'object.create-folder',
	objectCopy = 'object.copy',
	objectMove = 'object.move',
	objectPresign = 'object.presign',
	accessKeyCreate = 'access-key.create',
	accessKeySetStatus = 'access-key.set-status',
	accessKeyDelete = 'access-key.delete',
}

/** Whether the audited operation completed or was rejected. */
export enum AuditResult {
	success = 'success',
	failure = 'failure',
}
