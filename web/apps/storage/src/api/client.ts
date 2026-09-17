import { customInstance } from './customInstance'

/** Hand-written client covering the endpoints the UI uses today.
 *  Replace with the Orval-generated client (`npm run orval:web-storage`) once the
 *  management API can be reached at build time - see TODO.MD. */

export enum UserRole {
	admin = 'admin',
	user = 'user',
}

export enum BucketPermission {
	read = 'read',
	write = 'write',
	delete = 'delete',
	manage = 'manage',
}

export enum AccessKeyStatus {
	active = 'active',
	inactive = 'inactive',
}

export interface Tokens {
	accessToken: string
	refreshToken: string
	expiresIn: number
}

export interface Identity {
	guid: string
	email: string
	role: UserRole
}

export interface UserItem {
	guid: string
	email: string
	name: string | null
	role: UserRole
	lastLoginAt: string | null
	createdAt: string
}

export interface BucketItem {
	guid: string
	name: string
	ownerUserGuid: string
	region: string
	acl: string
	versioning: string
	createdAt: string
}

export interface BucketGrantItem {
	userGuid: string
	permissions: BucketPermission[]
}

export interface AccessKeyItem {
	accessKeyId: string
	userGuid: string
	description: string | null
	status: AccessKeyStatus
	expiresAt: string | null
	lastUsedAt: string | null
	createdAt: string
}

export interface CreatedAccessKey extends AccessKeyItem {
	secretAccessKey: string
}

export interface ObjectItem {
	key: string
	size: number
	etag: string
	contentType: string | null
	versionId: string
	lastModified: string
}

export interface ListObjectsResponse {
	objects: ObjectItem[]
	commonPrefixes: string[]
	isTruncated: boolean
	nextContinuationToken?: string
}

export const api = {
	login: (body: { email: string, password: string }) =>
		customInstance<Tokens>({ url: '/v1/auth/login', method: 'POST', data: body }),

	refresh: (body: { refreshToken: string }) =>
		customInstance<Tokens>({ url: '/v1/auth/refresh', method: 'POST', data: body }),

	logout: (body: { refreshToken: string }) =>
		customInstance<void>({ url: '/v1/auth/logout', method: 'POST', data: body }),

	me: () =>
		customInstance<Identity>({ url: '/v1/auth/me', method: 'GET' }),

	listUsers: () =>
		customInstance<UserItem[]>({ url: '/v1/users', method: 'GET' }),

	createUser: (body: { email: string, password: string, name?: string, role: UserRole }) =>
		customInstance<UserItem>({ url: '/v1/users', method: 'POST', data: body }),

	deleteUser: (userGuid: string) =>
		customInstance<void>({ url: `/v1/users/${userGuid}`, method: 'DELETE' }),

	listBuckets: () =>
		customInstance<BucketItem[]>({ url: '/v1/buckets', method: 'GET' }),

	createBucket: (body: { name: string, region?: string }) =>
		customInstance<BucketItem>({ url: '/v1/buckets', method: 'POST', data: body }),

	deleteBucket: (bucketName: string) =>
		customInstance<void>({ url: `/v1/buckets/${bucketName}`, method: 'DELETE' }),

	listBucketGrants: (bucketName: string) =>
		customInstance<BucketGrantItem[]>({ url: `/v1/buckets/${bucketName}/grants`, method: 'GET' }),

	setBucketGrant: (bucketName: string, body: BucketGrantItem) =>
		customInstance<void>({ url: `/v1/buckets/${bucketName}/grants`, method: 'PUT', data: body }),

	removeBucketGrant: (bucketName: string, userGuid: string) =>
		customInstance<void>({ url: `/v1/buckets/${bucketName}/grants/${userGuid}`, method: 'DELETE' }),

	getBucketPolicy: (bucketName: string) =>
		customInstance<{ document: unknown | null }>({ url: `/v1/buckets/${bucketName}/policy`, method: 'GET' }),

	setBucketPolicy: (bucketName: string, document: unknown) =>
		customInstance<void>({ url: `/v1/buckets/${bucketName}/policy`, method: 'PUT', data: { document } }),

	listObjects: (bucketName: string, params: { prefix?: string, delimiter?: string, continuationToken?: string }) =>
		customInstance<ListObjectsResponse>({ url: `/v1/buckets/${bucketName}/objects`, method: 'GET', params }),

	listAccessKeys: () =>
		customInstance<AccessKeyItem[]>({ url: '/v1/access-keys', method: 'GET' }),

	createAccessKey: (body: { description?: string }) =>
		customInstance<CreatedAccessKey>({ url: '/v1/access-keys', method: 'POST', data: body }),

	deleteAccessKey: (accessKeyId: string) =>
		customInstance<void>({ url: `/v1/access-keys/${accessKeyId}`, method: 'DELETE' }),
}
