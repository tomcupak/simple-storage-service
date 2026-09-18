import { getAccessKeys } from './schema/access-keys/access-keys'
import { getAudit } from './schema/audit/audit'
import { getAuth } from './schema/auth/auth'
import { getBuckets } from './schema/buckets/buckets'
import type {
	AccessKeyItem,
	AccessKeysControllerV1ListV1Params,
	AuditControllerV1ListV1Params,
	AuditEntry,
	BucketDetail,
	BucketGrantItem,
	BucketItem,
	BucketUsageItem,
	CopyObjectBody,
	CreateAccessKeyBody,
	CreateBucketBody,
	CreatedAccessKey,
	CreateFolderBody,
	CreateUserBody,
	IdentityResponse,
	ListObjectsResponse,
	LoginBody,
	ObjectItem,
	ObjectsControllerV1DeleteV1Params,
	ObjectsControllerV1ListV1Params,
	ObjectVersionItem,
	PolicyResponse,
	PresignObjectBody,
	RefreshBody,
	SetAccessKeyStatusBody,
	SetBucketAclBody,
	SetBucketGrantBody,
	SetBucketVersioningBody,
	SetPolicyBodyDocument,
	SetQuotaBody,
	SetUserStatusBody,
	TokensResponse,
	UpdateUserBody,
	UsageItem,
	UserItem,
	UsersControllerV1ListV1Params,
	UserUsageItem,
} from './schema/models'
import { AccessKeyItemStatus, BucketGrantItemPermissionsItem, BucketItemAcl, BucketItemVersioning, UserItemRole, UserItemStatus } from './schema/models'
import { getObjects } from './schema/objects/objects'
import { getPolicies } from './schema/policies/policies'
import { getUsage } from './schema/usage/usage'
import { getUsers } from './schema/users/users'

/** Facade over the Orval-generated client (`npm run orval:web-storage`). The generated
 *  operation names carry the controller/version prefix, so the UI calls them through these
 *  short aliases instead; the request/response types come from the generated schema. */

const auth = getAuth()
const users = getUsers()
const buckets = getBuckets()
const objects = getObjects()
const policies = getPolicies()
const accessKeys = getAccessKeys()
const usage = getUsage()
const audit = getAudit()

export const UserRole = UserItemRole
export const UserStatus = UserItemStatus
export const BucketPermission = BucketGrantItemPermissionsItem
export const BucketAcl = BucketItemAcl
export const BucketVersioning = BucketItemVersioning
export const AccessKeyStatus = AccessKeyItemStatus

export type UserRole = UserItemRole
export type UserStatus = UserItemStatus
export type BucketPermission = BucketGrantItemPermissionsItem
export type BucketAcl = BucketItemAcl
export type BucketVersioning = BucketItemVersioning
export type AccessKeyStatus = AccessKeyItemStatus

export type Identity = IdentityResponse
export type Tokens = TokensResponse
export type {
	AccessKeyItem,
	AuditEntry,
	BucketDetail,
	BucketGrantItem,
	BucketItem,
	BucketUsageItem,
	CreatedAccessKey,
	ListObjectsResponse,
	ObjectItem,
	ObjectVersionItem,
	PolicyResponse,
	UsageItem,
	UserItem,
	UserUsageItem,
}

export const api = {
	login: (body: LoginBody) => auth.authControllerV1LoginV1(body),
	refresh: (body: RefreshBody) => auth.authControllerV1RefreshV1(body),
	logout: (body: RefreshBody) => auth.authControllerV1LogoutV1(body),
	me: () => auth.authControllerV1MeV1(),

	listUsers: (params?: UsersControllerV1ListV1Params) => users.usersControllerV1ListV1(params),
	createUser: (body: CreateUserBody) => users.usersControllerV1CreateV1(body),
	updateUser: (userGuid: string, body: UpdateUserBody) => users.usersControllerV1UpdateV1(userGuid, body),
	setUserStatus: (userGuid: string, body: SetUserStatusBody) => users.usersControllerV1SetStatusV1(userGuid, body),
	setUserQuota: (userGuid: string, body: SetQuotaBody) => users.usersControllerV1SetQuotaV1(userGuid, body),
	setUserPassword: (userGuid: string, password: string) => users.usersControllerV1SetPasswordV1(userGuid, { password }),
	userUsage: (userGuid: string) => users.usersControllerV1UsageV1(userGuid),
	deleteUser: (userGuid: string) => users.usersControllerV1DeleteV1(userGuid),

	listBuckets: () => buckets.bucketsControllerV1ListV1(),
	getBucket: (bucketName: string) => buckets.bucketsControllerV1GetV1(bucketName),
	createBucket: (body: CreateBucketBody) => buckets.bucketsControllerV1CreateV1(body),
	deleteBucket: (bucketName: string) => buckets.bucketsControllerV1DeleteV1(bucketName),
	setBucketAcl: (bucketName: string, body: SetBucketAclBody) => buckets.bucketsControllerV1SetAclV1(bucketName, body),
	setBucketVersioning: (bucketName: string, body: SetBucketVersioningBody) => buckets.bucketsControllerV1SetVersioningV1(bucketName, body),
	setBucketQuota: (bucketName: string, body: SetQuotaBody) => buckets.bucketsControllerV1SetQuotaV1(bucketName, body),
	bucketUsage: (bucketName: string) => buckets.bucketsControllerV1UsageV1(bucketName),
	listBucketGrants: (bucketName: string) => buckets.bucketsControllerV1ListGrantsV1(bucketName),
	setBucketGrant: (bucketName: string, body: SetBucketGrantBody) => buckets.bucketsControllerV1SetGrantV1(bucketName, body),
	removeBucketGrant: (bucketName: string, userGuid: string) => buckets.bucketsControllerV1RemoveGrantV1(bucketName, userGuid),

	getBucketPolicy: (bucketName: string) => policies.policiesControllerV1GetV1(bucketName),
	setBucketPolicy: (bucketName: string, document: SetPolicyBodyDocument) => policies.policiesControllerV1SetV1(bucketName, { document }),
	deleteBucketPolicy: (bucketName: string) => policies.policiesControllerV1DeleteV1(bucketName),

	listObjects: (bucketName: string, params: ObjectsControllerV1ListV1Params) => objects.objectsControllerV1ListV1(bucketName, params),
	listObjectVersions: (bucketName: string, key: string) => objects.objectsControllerV1ListVersionsV1(bucketName, { key }),
	uploadObject: (bucketName: string, key: string, payload: Blob) => objects.objectsControllerV1UploadV1(bucketName, payload, { key }),
	downloadObject: (bucketName: string, key: string, versionId?: string) => objects.objectsControllerV1DownloadV1(bucketName, { key, versionId }),
	deleteObject: (bucketName: string, params: ObjectsControllerV1DeleteV1Params) => objects.objectsControllerV1DeleteV1(bucketName, params),
	createFolder: (bucketName: string, body: CreateFolderBody) => objects.objectsControllerV1CreateFolderV1(bucketName, body),
	copyObject: (bucketName: string, body: CopyObjectBody) => objects.objectsControllerV1CopyV1(bucketName, body),
	presignObject: (bucketName: string, body: PresignObjectBody) => objects.objectsControllerV1PresignV1(bucketName, body),

	listAccessKeys: (params?: AccessKeysControllerV1ListV1Params) => accessKeys.accessKeysControllerV1ListV1(params),
	createAccessKey: (body: CreateAccessKeyBody) => accessKeys.accessKeysControllerV1CreateV1(body),
	setAccessKeyStatus: (accessKeyId: string, body: SetAccessKeyStatusBody) => accessKeys.accessKeysControllerV1SetStatusV1(accessKeyId, body),
	deleteAccessKey: (accessKeyId: string) => accessKeys.accessKeysControllerV1DeleteV1(accessKeyId),

	bucketsUsage: () => usage.usageControllerV1BucketsV1(),
	usersUsage: () => usage.usageControllerV1UsersV1(),

	listAudit: (params?: AuditControllerV1ListV1Params) => audit.auditControllerV1ListV1(params),
	auditActions: () => audit.auditControllerV1ActionsV1(),
}
