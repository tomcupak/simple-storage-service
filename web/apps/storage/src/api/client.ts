import { getAccessKeys } from './schema/access-keys/access-keys'
import { getAuth } from './schema/auth/auth'
import { getBuckets } from './schema/buckets/buckets'
import type {
	AccessKeyItem,
	BucketGrantItem,
	BucketItem,
	CreateAccessKeyBody,
	CreateBucketBody,
	CreatedAccessKey,
	CreateUserBody,
	IdentityResponse,
	ListObjectsResponse,
	LoginBody,
	ObjectItem,
	ObjectsControllerV1ListV1Params,
	PolicyResponse,
	RefreshBody,
	SetBucketGrantBody,
	SetPolicyBodyDocument,
	TokensResponse,
	UserItem,
} from './schema/models'
import { AccessKeyItemStatus, BucketGrantItemPermissionsItem, UserItemRole } from './schema/models'
import { getObjects } from './schema/objects/objects'
import { getPolicies } from './schema/policies/policies'
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

export const UserRole = UserItemRole
export const BucketPermission = BucketGrantItemPermissionsItem
export const AccessKeyStatus = AccessKeyItemStatus

export type UserRole = UserItemRole
export type BucketPermission = BucketGrantItemPermissionsItem
export type AccessKeyStatus = AccessKeyItemStatus

export type Identity = IdentityResponse
export type Tokens = TokensResponse
export type {
	AccessKeyItem,
	BucketGrantItem,
	BucketItem,
	CreatedAccessKey,
	ListObjectsResponse,
	ObjectItem,
	PolicyResponse,
	UserItem,
}

export const api = {
	login: (body: LoginBody) => auth.authControllerV1LoginV1(body),
	refresh: (body: RefreshBody) => auth.authControllerV1RefreshV1(body),
	logout: (body: RefreshBody) => auth.authControllerV1LogoutV1(body),
	me: () => auth.authControllerV1MeV1(),

	listUsers: () => users.usersControllerV1ListV1(),
	createUser: (body: CreateUserBody) => users.usersControllerV1CreateV1(body),
	deleteUser: (userGuid: string) => users.usersControllerV1DeleteV1(userGuid),

	listBuckets: () => buckets.bucketsControllerV1ListV1(),
	createBucket: (body: CreateBucketBody) => buckets.bucketsControllerV1CreateV1(body),
	deleteBucket: (bucketName: string) => buckets.bucketsControllerV1DeleteV1(bucketName),
	listBucketGrants: (bucketName: string) => buckets.bucketsControllerV1ListGrantsV1(bucketName),
	setBucketGrant: (bucketName: string, body: SetBucketGrantBody) => buckets.bucketsControllerV1SetGrantV1(bucketName, body),
	removeBucketGrant: (bucketName: string, userGuid: string) => buckets.bucketsControllerV1RemoveGrantV1(bucketName, userGuid),

	getBucketPolicy: (bucketName: string) => policies.policiesControllerV1GetV1(bucketName),
	setBucketPolicy: (bucketName: string, document: SetPolicyBodyDocument) => policies.policiesControllerV1SetV1(bucketName, { document }),
	deleteBucketPolicy: (bucketName: string) => policies.policiesControllerV1DeleteV1(bucketName),

	listObjects: (bucketName: string, params: ObjectsControllerV1ListV1Params) => objects.objectsControllerV1ListV1(bucketName, params),
	listObjectVersions: (bucketName: string, key: string) => objects.objectsControllerV1ListVersionsV1(bucketName, { key }),

	listAccessKeys: () => accessKeys.accessKeysControllerV1ListV1(),
	createAccessKey: (body: CreateAccessKeyBody) => accessKeys.accessKeysControllerV1CreateV1(body),
	deleteAccessKey: (accessKeyId: string) => accessKeys.accessKeysControllerV1DeleteV1(accessKeyId),
}
