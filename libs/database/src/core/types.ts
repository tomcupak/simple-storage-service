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

export enum MultipartUploadStatus {
	inProgress = 'in-progress',
	completed = 'completed',
	aborted = 'aborted',
}
