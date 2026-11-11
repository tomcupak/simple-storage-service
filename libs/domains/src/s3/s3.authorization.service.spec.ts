import { BucketAcl, BucketPermission, BucketVersioning } from '@storage/database'
import { Request } from 'express'

import { BucketsService } from '../buckets/buckets.service'
import { BucketsTypes } from '../buckets/buckets.types'
import { ObjectsService } from '../objects/objects.service'
import { PoliciesService } from '../policies/policies.service'
import { PoliciesTypes } from '../policies/policies.types'
import { S3AuthorizationService } from './s3.authorization.service'
import { S3Exception } from './s3.exception'
import { S3RequestService } from './s3.request.service'
import { S3Types } from './s3.types'

const mockBucketsService = { getByName: jest.fn(), hasPermission: jest.fn() }
const mockObjectsService = { getVersion: jest.fn() }
const mockRequestService = { policyContext: jest.fn() }

describe('S3AuthorizationService', () => {
	let service: S3AuthorizationService
	// The real evaluator is used: what is under test is the request it gets and what is done
	// with its verdict, both of which only mean anything against the actual matching rules.
	let policiesService: PoliciesService

	beforeEach(() => {
		jest.clearAllMocks()
		policiesService = new PoliciesService({ core: {} } as never)
		service = new S3AuthorizationService(
			mockBucketsService as unknown as BucketsService,
			policiesService,
			mockObjectsService as unknown as ObjectsService,
			mockRequestService as unknown as S3RequestService,
		)
		mockRequestService.policyContext.mockReturnValue({})
		mockBucketsService.hasPermission.mockResolvedValue(false)
	})

	const makeBucket = (overrides?: Partial<BucketsTypes.BucketItem>): BucketsTypes.BucketItem => ({
		guid: 'bucket-guid',
		name: 'photos',
		ownerUserGuid: 'owner-guid',
		region: 'us-east-1',
		acl: BucketAcl.private,
		versioning: BucketVersioning.disabled,
		quotaBytes: null,
		cors: null,
		createdAt: new Date(),
		...overrides,
	})

	const makeIdentity = (overrides?: Partial<S3Types.RequestIdentity>): S3Types.RequestIdentity => ({
		accessKeyId: 'STKEY',
		userGuid: 'user-guid',
		anonymous: false,
		...overrides,
	})

	const anonymous: S3Types.RequestIdentity = { accessKeyId: '', userGuid: '', anonymous: true }

	const withPolicy = (document: PoliciesTypes.PolicyDocument | null) => {
		jest.spyOn(policiesService, 'get').mockResolvedValue(document)
	}

	describe('authorize', () => {
		it('lets the owner through when no policy applies', async () => {
			withPolicy(null)

			await expect(service.authorize({
				identity: makeIdentity({ userGuid: 'owner-guid' }),
				bucket: makeBucket(),
				action: S3Types.Action.putObject,
			})).resolves.toBeUndefined()
		})

		it('denies a stranger on a private bucket', async () => {
			withPolicy(null)

			await expect(service.authorize({
				identity: makeIdentity(),
				bucket: makeBucket(),
				action: S3Types.Action.getObject,
				key: 'cat.jpg',
			})).rejects.toThrow(S3Exception)
		})

		it('falls back to a bucket_access grant', async () => {
			withPolicy(null)
			mockBucketsService.hasPermission.mockResolvedValue(true)

			await expect(service.authorize({
				identity: makeIdentity(),
				bucket: makeBucket(),
				action: S3Types.Action.getObject,
				key: 'cat.jpg',
			})).resolves.toBeUndefined()
			expect(mockBucketsService.hasPermission).toHaveBeenCalledWith(expect.objectContaining({ permission: BucketPermission.read }))
		})

		it('lets an anonymous read through a public-read ACL but not a write', async () => {
			withPolicy(null)

			await expect(service.authorize({
				identity: anonymous,
				bucket: makeBucket({ acl: BucketAcl.publicRead }),
				action: S3Types.Action.getObject,
				key: 'cat.jpg',
			})).resolves.toBeUndefined()

			await expect(service.authorize({
				identity: anonymous,
				bucket: makeBucket({ acl: BucketAcl.publicRead }),
				action: S3Types.Action.putObject,
				key: 'cat.jpg',
			})).rejects.toThrow(S3Exception)
		})

		it('never opens bucket management through an ACL', async () => {
			withPolicy(null)

			await expect(service.authorize({
				identity: anonymous,
				bucket: makeBucket({ acl: BucketAcl.publicReadWrite }),
				action: S3Types.Action.putBucketAcl,
			})).rejects.toThrow(S3Exception)
		})

		it('stops even the owner on an explicit policy Deny', async () => {
			withPolicy({
				Version: '2012-10-17',
				Statement: [{ Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: 'arn:aws:s3:::photos/secret/*' }],
			})

			await expect(service.authorize({
				identity: makeIdentity({ userGuid: 'owner-guid' }),
				bucket: makeBucket(),
				action: S3Types.Action.getObject,
				key: 'secret/keys.txt',
			})).rejects.toThrow(S3Exception)
		})

		it('evaluates a Condition against the request context', async () => {
			withPolicy({
				Version: '2012-10-17',
				Statement: [{
					Effect: 'Allow',
					Principal: '*',
					Action: 's3:GetObject',
					Resource: 'arn:aws:s3:::photos/*',
					Condition: { IpAddress: { 'aws:SourceIp': '10.0.0.0/8' } },
				}],
			})

			mockRequestService.policyContext.mockReturnValue({ 'aws:SourceIp': '10.1.2.3' })
			await expect(service.authorize({
				req: {} as Request,
				identity: anonymous,
				bucket: makeBucket(),
				action: S3Types.Action.getObject,
				key: 'cat.jpg',
			})).resolves.toBeUndefined()

			mockRequestService.policyContext.mockReturnValue({ 'aws:SourceIp': '192.168.0.1' })
			await expect(service.authorize({
				req: {} as Request,
				identity: anonymous,
				bucket: makeBucket(),
				action: S3Types.Action.getObject,
				key: 'cat.jpg',
			})).rejects.toThrow(S3Exception)
		})

		it('resolves aws:username and aws:userid from the identity, not the request', async () => {
			withPolicy({
				Version: '2012-10-17',
				Statement: [{
					Effect: 'Allow',
					Principal: '*',
					Action: 's3:GetObject',
					Resource: 'arn:aws:s3:::photos/*',
					Condition: { StringEquals: { 'aws:username': 'user-guid' } },
				}],
			})

			await expect(service.authorize({
				identity: makeIdentity(),
				bucket: makeBucket(),
				action: S3Types.Action.getObject,
				key: 'cat.jpg',
			})).resolves.toBeUndefined()

			await expect(service.authorize({
				identity: anonymous,
				bucket: makeBucket(),
				action: S3Types.Action.getObject,
				key: 'cat.jpg',
			})).rejects.toThrow(S3Exception)
		})
	})

	describe('resourceArn', () => {
		it('distinguishes a bucket from a key', () => {
			expect(service.resourceArn({ bucket: 'photos' })).toBe('arn:aws:s3:::photos')
			expect(service.resourceArn({ bucket: 'photos', key: 'a/b.jpg' })).toBe('arn:aws:s3:::photos/a/b.jpg')
		})
	})
})
