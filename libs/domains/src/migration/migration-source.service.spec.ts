import { S3Client } from '@aws-sdk/client-s3'

import { MigrationTypes } from './migration.types'
import { MigrationSourceService } from './migration-source.service'

const makeError = (name: string, status?: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } })

describe('MigrationSourceService', () => {
	let service: MigrationSourceService
	const mockSend = jest.fn()
	const client = { send: mockSend } as unknown as S3Client

	beforeEach(() => {
		jest.clearAllMocks()
		service = new MigrationSourceService()
	})

	describe('error mapping', () => {
		it.each([
			['refused connection', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })],
			['timeout', Object.assign(new Error('timed out'), { name: 'TimeoutError' })],
			['non-S3 answer', makeError('UnknownError', 200)],
		])('maps a %s to unreachable', async (_label, err) => {
			mockSend.mockRejectedValue(err)
			await expect(service.listBuckets(client)).rejects.toThrow(MigrationTypes.MigrationSourceUnreachableError)
		})

		it.each([
			['InvalidAccessKeyId', makeError('InvalidAccessKeyId', 403)],
			['SignatureDoesNotMatch', makeError('SignatureDoesNotMatch', 403)],
			['a bare 403', makeError('SomethingElse', 403)],
		])('maps %s to auth failed', async (_label, err) => {
			mockSend.mockRejectedValue(err)
			await expect(service.listBuckets(client)).rejects.toThrow(MigrationTypes.MigrationSourceAuthFailedError)
		})

		it('passes other S3 errors through untouched', async () => {
			const err = makeError('NoSuchKey', 404)
			mockSend.mockRejectedValue(err)
			await expect(service.getObject({ client, bucket: 'b', key: 'k' })).rejects.toBe(err)
		})
	})

	it('reads a missing bucket policy as null', async () => {
		mockSend.mockRejectedValue(makeError('NoSuchBucketPolicy', 404))
		await expect(service.getPolicy({ client, bucket: 'b' })).resolves.toBeNull()
	})

	it('reports the next token only while the listing is truncated', async () => {
		mockSend.mockResolvedValueOnce({ Contents: [{ Key: 'a', Size: 3, LastModified: new Date(0) }], IsTruncated: true, NextContinuationToken: 't1' })
		mockSend.mockResolvedValueOnce({ Contents: [], IsTruncated: false, NextContinuationToken: 'ignored' })

		expect((await service.listObjects({ client, bucket: 'b' })).nextToken).toBe('t1')
		expect((await service.listObjects({ client, bucket: 'b', token: 't1' })).nextToken).toBeUndefined()
	})

	it('maps the versioning status', async () => {
		mockSend.mockResolvedValueOnce({ Status: 'Enabled' })
		mockSend.mockResolvedValueOnce({})
		await expect(service.getVersioning({ client, bucket: 'b' })).resolves.toBe('Enabled')
		await expect(service.getVersioning({ client, bucket: 'b' })).resolves.toBeNull()
	})
})
